import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDriveSession, driveWasEnabled, forgetDrive, loadDriveReceipt, loadDriveSession, saveDriveReceipt, saveDriveSession } from './driveSession';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
beforeEach(() => { vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Drive reload persistence', () => {
  it('restores a valid tab session, separately for sync and backups', () => {
    const session = { token: 'valid', expiresAt: Date.now() + 3600000 };
    expect(saveDriveSession('sync', session)).toBe(true);
    expect(loadDriveSession('sync')).toEqual(session);
    expect(loadDriveSession('backup')).toBeNull();
    expect(driveWasEnabled('sync')).toBe(true);
    expect(localStorage.getItem('pour-guide.drive.sync.session.v1')).toBeNull();
  });
  it('remembers the enabled preference but discards expired credentials', () => {
    saveDriveSession('sync', { token: 'expired', expiresAt: Date.now() - 1 });
    expect(loadDriveSession('sync')).toBeNull();
    expect(driveWasEnabled('sync')).toBe(true);
    expect(sessionStorage.getItem('pour-guide.drive.sync.session.v1')).toBeNull();
  });
  it('does not restore malformed data or another OAuth client', () => {
    for (const value of ['{', 'null', JSON.stringify({ clientId: 'another-client', token: 'token', expiresAt: Date.now() + 3600000 })]) {
      sessionStorage.setItem('pour-guide.drive.sync.session.v1', value);
      expect(loadDriveSession('sync')).toBeNull();
    }
  });
  it('retains verified receipt history until the user disconnects', () => {
    saveDriveSession('backup', { token: 'valid', expiresAt: Date.now() + 3600000 });
    const receipt = { confirmedAt: Date.now(), recipeCount: 3 };
    saveDriveReceipt('backup', receipt);
    clearDriveSession('backup');
    expect(loadDriveReceipt('backup')).toEqual(receipt);
    forgetDrive('backup');
    expect(loadDriveReceipt('backup')).toBeNull();
    expect(driveWasEnabled('backup')).toBe(false);
  });
  it('still permits temporary connection when browser persistence is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(loadDriveSession('sync')).toBeNull();
    expect(saveDriveSession('sync', { token: 'valid', expiresAt: Date.now() + 3600000 })).toBe(false);
  });
});
