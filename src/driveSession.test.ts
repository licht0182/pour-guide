import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDriveSession, driveWasEnabled, forgetDrive, loadDriveReceipt, loadDriveSession, saveDriveReceipt, saveDriveSession } from './driveSession';

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
    expect(loadDriveSession('backup')).toBeNull();
    expect(driveWasEnabled('sync')).toBe(true);
    expect(localStorage.getItem('pour-guide.drive.sync.session.v1')).not.toBeNull();
    sessionStorage.removeItem('pour-guide.drive.sync.session.v1');
    expect(loadDriveSession('sync')).toEqual(session);
  });
  it('remembers the enabled preference but discards expired credentials', () => {
    saveDriveSession('sync', { token: 'expired', expiresAt: Date.now() - 1 });
    expect(loadDriveSession('sync')).toBeNull();
    expect(driveWasEnabled('sync')).toBe(true);
    expect(sessionStorage.getItem('pour-guide.drive.sync.session.v1')).toBeNull();
    expect(localStorage.getItem('pour-guide.drive.sync.session.v1')).toBeNull();
  });
  it('does not discard a token before its actual Google expiry', () => {
    const session = { token: 'still-valid', expiresAt: Date.now() + 15000 };
    saveDriveSession('sync', session);
    expect(loadDriveSession('sync')).toEqual(session);
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
    saveDriveSession('backup', session);
    const name = 'pour-guide.drive.backup.session.v1';
    localStorage.removeItem(name);
    const legacy = JSON.parse(sessionStorage.getItem(name)!);
    delete legacy.savedAt;
    sessionStorage.setItem(name, JSON.stringify(legacy));
    expect(loadDriveSession('backup')).toEqual(session);
    expect(JSON.parse(localStorage.getItem(name)!).token).toBe('legacy');
  });
  it('selects the newest valid session if the storage copies differ', () => {
    saveDriveSession('sync', { token: 'older', expiresAt: Date.now() + 3600000 });
    const name = 'pour-guide.drive.sync.session.v1';
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
});
