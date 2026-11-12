import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDriveSession, driveWasEnabled, enableDriveSync, forgetDrive, loadDriveReceipt, loadDriveSession, markDriveSessionVerified, saveDriveReceipt, saveDriveSession, subscribeDriveSession } from './driveSession';
import { driveClientId } from './googleDrive';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
beforeEach(() => { vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Drive reload persistence', () => {
  it('restores a device session even when tab storage is reset', () => {
    const session = { token: 'valid', expiresAt: Date.now() + 3600000 };
    expect(saveDriveSession('sync', session)).toBe(true);
    expect(loadDriveSession('sync')).toEqual(session);
    expect(loadDriveSession('backup')).toEqual(session);
    expect(driveWasEnabled('sync')).toBe(true);
    expect(localStorage.getItem('pour-guide.drive.session.v2')).not.toBeNull();
    sessionStorage.removeItem('pour-guide.drive.session.v2');
    expect(loadDriveSession('sync')).toEqual(session);
  });
  it('remembers the enabled preference but discards expired credentials', () => {
    saveDriveSession('sync', { token: 'expired', expiresAt: Date.now() - 1 });
    expect(loadDriveSession('sync')).toBeNull();
    expect(driveWasEnabled('sync')).toBe(true);
    expect(sessionStorage.getItem('pour-guide.drive.session.v2')).toBeNull();
    expect(localStorage.getItem('pour-guide.drive.session.v2')).toBeNull();
  });
  it('does not discard a token before its actual Google expiry', () => {
    const session = { token: 'still-valid', expiresAt: Date.now() + 15000 };
    saveDriveSession('sync', session);
    expect(loadDriveSession('sync')).toEqual(session);
  });
  it('does not restore malformed data or another OAuth client', () => {
    for (const value of ['{', 'null', JSON.stringify({ clientId: 'another-client', token: 'token', expiresAt: Date.now() + 3600000 })]) {
      sessionStorage.setItem('pour-guide.drive.session.v2', value);
      expect(loadDriveSession('sync')).toBeNull();
    }
  });
  it('restores the last proven Drive state with the credential after a reload', () => {
    const session = { token: 'proven', expiresAt: Date.now() + 3600000 };
    saveDriveSession('sync', session);
    expect(loadDriveSession('backup')).toEqual(session);
    const verified = Date.now() - 5000;
    markDriveSessionVerified();
    const restored = loadDriveSession('backup');
    expect(restored?.token).toBe('proven');
    expect(restored?.verifiedAt).toBeGreaterThanOrEqual(verified);
    sessionStorage.removeItem('pour-guide.drive.session.v2');
    expect(loadDriveSession('sync')?.verifiedAt).toBe(restored?.verifiedAt);
  });
  it('never attaches an old verification to a newly authorized credential', () => {
    saveDriveSession('sync', { token: 'first', expiresAt: Date.now() + 3600000 });
    markDriveSessionVerified();
    saveDriveSession('sync', { token: 'second', expiresAt: Date.now() + 3600000 });
    expect(loadDriveSession('sync')).toEqual({ token: 'second', expiresAt: expect.any(Number) });
  });
  it('ignores a future-dated or forged verification and unverified legacy copies', () => {
    localStorage.setItem('pour-guide.drive.session.v2', JSON.stringify({ clientId: driveClientId, token: 'forged', expiresAt: Date.now() + 3600000, verifiedAt: Date.now() + 3600000 }));
    expect(loadDriveSession('sync')).toEqual({ token: 'forged', expiresAt: expect.any(Number) });
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
  it('persists the device connection when tab storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    vi.stubGlobal('sessionStorage', blocked);
    const session = { token: 'valid', expiresAt: Date.now() + 3600000 };
    expect(saveDriveSession('sync', session)).toBe(true);
    expect(loadDriveSession('sync')).toEqual(session);
    vi.stubGlobal('localStorage', blocked);
    expect(loadDriveSession('sync')).toBeNull();
    expect(saveDriveSession('sync', session)).toBe(false);
  });
  it('migrates the old tab-only session without another login', () => {
    const session = { token: 'legacy', expiresAt: Date.now() + 3600000 };
    const name = 'pour-guide.drive.backup.session.v1';
    const legacy = { ...session, clientId: driveClientId };
    sessionStorage.setItem(name, JSON.stringify(legacy));
    expect(loadDriveSession('backup')).toEqual(session);
    expect(JSON.parse(localStorage.getItem('pour-guide.drive.session.v2')!).token).toBe('legacy');
    expect(sessionStorage.getItem(name)).toBeNull();
  });
  it('selects the newest valid session if the storage copies differ', () => {
    saveDriveSession('sync', { token: 'older', expiresAt: Date.now() + 3600000 });
    const name = 'pour-guide.drive.session.v2';
    const newer = JSON.parse(sessionStorage.getItem(name)!);
    newer.token = 'newer';
    newer.savedAt += 1;
    sessionStorage.setItem(name, JSON.stringify(newer));
    expect(loadDriveSession('sync')?.token).toBe('newer');
    expect(JSON.parse(localStorage.getItem(name)!).token).toBe('newer');
  });
  it('reports missing device persistence while retaining a temporary tab session', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    const session = { token: 'temporary', expiresAt: Date.now() + 3600000 };
    expect(saveDriveSession('sync', session)).toBe(false);
    expect(loadDriveSession('sync')).toEqual(session);
  });
  it('notifies both consumers and clears the shared credential from either panel', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const changes = vi.fn();
    const unsubscribe = subscribeDriveSession(changes);
    try {
      saveDriveSession('backup', { token: 'shared', expiresAt: Date.now() + 3600000 });
      expect(loadDriveSession('sync')?.token).toBe('shared');
      expect(driveWasEnabled('sync')).toBe(false);
      enableDriveSync();
      expect(driveWasEnabled('sync')).toBe(true);
      clearDriveSession('sync');
      expect(loadDriveSession('backup')).toBeNull();
      expect(changes).toHaveBeenCalledTimes(2);
      forgetDrive('backup');
      expect(driveWasEnabled('sync')).toBe(false);
      expect(driveWasEnabled('backup')).toBe(false);
    } finally { unsubscribe(); }
  });
  it('migrates independent legacy accounts conservatively and never revives them after disconnect', () => {
    const expiresAt = Date.now() + 3600000;
    localStorage.setItem('pour-guide.drive.sync.session.v1', JSON.stringify({ token: 'older-account', expiresAt, savedAt: 1, clientId: driveClientId }));
    localStorage.setItem('pour-guide.drive.backup.session.v1', JSON.stringify({ token: 'newer-account', expiresAt, savedAt: 2, clientId: driveClientId }));
    enableDriveSync();
    expect(loadDriveSession('sync')?.token).toBe('newer-account');
    expect(driveWasEnabled('sync')).toBe(false);
    forgetDrive('backup');
    expect(loadDriveSession('sync')).toBeNull();
    expect(localStorage.getItem('pour-guide.drive.sync.session.v1')).toBeNull();
  });
  it('discards a tab copy when another tab disconnects', () => {
    let onStorage: ((event: { key: string; newValue: null }) => void) | undefined;
    vi.stubGlobal('window', { addEventListener: (_: string, callback: typeof onStorage) => { onStorage = callback; }, removeEventListener: vi.fn() });
    const unsubscribe = subscribeDriveSession(() => { loadDriveSession('sync'); });
    try {
      saveDriveSession('sync', { token: 'shared', expiresAt: Date.now() + 3600000 });
      localStorage.removeItem('pour-guide.drive.session.v2');
      onStorage?.({ key: 'pour-guide.drive.session.v2', newValue: null });
      expect(loadDriveSession('sync')).toBeNull();
    } finally { unsubscribe(); }
  });
});
