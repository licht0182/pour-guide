import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDrive, DriveAuthError, listDriveBackups, readDriveBackup, saveDriveBackup } from './googleDrive';
import { PRESETS } from './recipe';
import { encodeBackup } from './driveBackup';

const library = { recipes: PRESETS, activeId: PRESETS[0].id };
afterEach(() => { vi.unstubAllGlobals(); });

function mockNetwork(responses: Response[]) {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const network = vi.fn();
  for (const response of responses) network.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', network);
  return network;
}

describe('Google Drive requests', () => {
  it('uploads a new app-private backup and reads it back', async () => {
    const network = mockNetwork([Response.json({ id: 'new' }), new Response(encodeBackup(library)), new Response(encodeBackup(library))]);
    await saveDriveBackup('token', library);
    const [url, options] = network.mock.calls[0];
    expect(url).toContain('uploadType=multipart');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer token');
    expect(options.body).toContain('"parents":["appDataFolder"]');
    expect(options.body).toContain('"format":"pour-guide"');
    expect(await readDriveBackup('token', 'new')).toEqual(library);
  });
  it('limits the list to app backups and reports expired and denied access', async () => {
    const network = mockNetwork([Response.json({ files: [{ id: 'a' }] }), new Response('', { status: 401 }), new Response('', { status: 403 })]);
    expect(await listDriveBackups('token')).toEqual([{ id: 'a' }]);
    const url = new URL(network.mock.calls[0][0]);
    expect(url.searchParams.get('spaces')).toBe('appDataFolder');
    expect(url.searchParams.get('q')).toContain('pour-guide');
    await expect(listDriveBackups('expired')).rejects.toBeInstanceOf(DriveAuthError);
    await expect(listDriveBackups('denied')).rejects.toThrow(/거부/);
  });
  it('does not import malformed remote data', async () => {
    mockNetwork([new Response('{"format":"other"}')]);
    await expect(readDriveBackup('token', 'bad')).rejects.toThrow(/백업/);
  });
  it('does not report a successful save when Drive returns different contents', async () => {
    mockNetwork([Response.json({ id: 'wrong' }), new Response(encodeBackup({ ...library, recipes: [{ ...PRESETS[0], name: '다른 내용' }] }))]);
    await expect(saveDriveBackup('token', library)).rejects.toThrow(/일치하지/);
  });
  it('rejects closed popups and missing consent', async () => {
    vi.stubGlobal('window', { google: { accounts: { oauth2: {
      initTokenClient: (config: { error_callback: () => void }) => ({ requestAccessToken: () => config.error_callback() }),
    } } } });
    await expect(connectDrive()).rejects.toThrow(/로그인 창/);
    vi.stubGlobal('window', { google: { accounts: { oauth2: {
      initTokenClient: (config: { callback: (value: object) => void }) => ({ requestAccessToken: () => config.callback({ error: 'access_denied' }) }),
    } } } });
    await expect(connectDrive()).rejects.toThrow(/권한/);
  });
  it('requires the requested scope and returns a temporary session', async () => {
    const consent = vi.fn(() => true);
    const initialize = vi.fn((config: { callback: (value: object) => void }) => ({ requestAccessToken: () => config.callback({ access_token: 'temporary', expires_in: 120 }) }));
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient: initialize, hasGrantedAllScopes: consent } } } });
    const before = Date.now();
    const connection = await connectDrive();
    expect(connection.token).toBe('temporary');
    expect(connection.expiresAt).toBeGreaterThanOrEqual(before + 120000);
    expect(initialize.mock.calls[0][0]).toMatchObject({ scope: 'https://www.googleapis.com/auth/drive.appdata', include_granted_scopes: false });
    consent.mockReturnValueOnce(false);
    await expect(connectDrive()).rejects.toThrow(/권한/);
  });
  it('opens one authorization flow when both features connect concurrently', async () => {
    let respond: ((value: object) => void) | undefined;
    const initialize = vi.fn((config: { callback: (value: object) => void }) => ({ requestAccessToken: () => { respond = config.callback; } }));
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient: initialize, hasGrantedAllScopes: () => true } } } });
    const sync = connectDrive();
    const backup = connectDrive();
    expect(backup).toBe(sync);
    expect(initialize).toHaveBeenCalledTimes(1);
    respond?.({ access_token: 'one-shared-token', expires_in: 120 });
    expect((await Promise.all([sync, backup])).every(session => session.token === 'one-shared-token')).toBe(true);
  });
});
