import { driveClientId } from './googleDrive';

export type DriveMode = 'sync' | 'backup';
export interface DriveSession { token: string; expiresAt: number; verifiedAt?: number }
export interface DriveReceipt { confirmedAt: number; recipeCount: number }
const key = (mode: DriveMode, suffix: string) => `pour-guide.drive.${mode}.${suffix}.v1`;
const SESSION_KEY = 'pour-guide.drive.session.v2';
const modes: DriveMode[] = ['sync', 'backup'];
const listeners = new Set<() => void>();
function changed() { for (const listener of listeners) listener(); }
export function subscribeDriveSession(listener: () => void): () => void {
  listeners.add(listener);
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || event.key === SESSION_KEY) {
      try {
        if (event.newValue === null) sessionStorage.removeItem(SESSION_KEY);
        else sessionStorage.setItem(SESSION_KEY, event.newValue);
        for (const mode of modes) sessionStorage.removeItem(key(mode, 'session'));
      } catch { /* The persistent copy remains authoritative. */ }
      listener();
    }
  };
  window.addEventListener('storage', storageChanged);
  return () => { listeners.delete(listener); window.removeEventListener('storage', storageChanged); };
}

function stores(): { storage: Storage; durable: boolean }[] {
  const result: { storage: Storage; durable: boolean }[] = [];
  try { result.push({ storage: localStorage, durable: true }); } catch { /* Unavailable storage. */ }
  try { result.push({ storage: sessionStorage, durable: false }); } catch { /* Unavailable storage. */ }
  return result;
}

function read(storage: Storage, name: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(storage.getItem(name) ?? 'null');
    return data && typeof data === 'object' ? data : null;
  } catch { return null; }
}

function write(name: string, value: string | null): boolean {
  let durable = false;
  for (const item of stores()) {
    try {
      if (value === null) item.storage.removeItem(name);
      else item.storage.setItem(name, value);
      if (item.durable && item.storage.getItem(name) === value) durable = true;
    } catch { /* Try the other storage independently. */ }
  }
  return durable;
}

// Keep only Google's short-lived token and its real expiry. Device storage also
// survives mobile web-view recreation; session storage is a compatible fallback.
export function loadDriveSession(_mode: DriveMode): DriveSession | null {
  const shared: (DriveSession & { savedAt: number })[] = [];
  const legacy: (DriveSession & { savedAt: number })[] = [];
  for (const item of stores()) {
    for (const name of [SESSION_KEY, ...modes.map(mode => key(mode, 'session'))]) {
      const data = read(item.storage, name);
      if (data && data.clientId === driveClientId && typeof data.token === 'string' && data.token.length > 0 && typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now()) {
        const verifiedAt = typeof data.verifiedAt === 'number' && Number.isFinite(data.verifiedAt) && data.verifiedAt > 0 && data.verifiedAt <= Date.now() ? data.verifiedAt : undefined;
        (name === SESSION_KEY ? shared : legacy).push({ token: data.token, expiresAt: data.expiresAt, savedAt: typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : 0, ...(verifiedAt === undefined ? {} : { verifiedAt }) });
      }
    }
  }
  const saved = (shared.length ? shared : legacy).sort((a, b) => b.savedAt - a.savedAt || b.expiresAt - a.expiresAt)[0];
  // Loading never broadcasts: React may read twice while mounting.
  if (!saved) {
    write(SESSION_KEY, null);
    for (const mode of modes) write(key(mode, 'session'), null);
    return null;
  }
  if (!shared.length && new Set(legacy.map(session => session.token)).size > 1) {
    // The two legacy connections may be different accounts: require sync start.
    write(key('sync', 'enabled'), null);
    for (const mode of modes) write(key(mode, 'receipt'), null);
  }
  write(SESSION_KEY, JSON.stringify({ ...saved, clientId: driveClientId }));
  for (const mode of modes) write(key(mode, 'session'), null);
  return saved.verifiedAt === undefined
    ? { token: saved.token, expiresAt: saved.expiresAt }
    : { token: saved.token, expiresAt: saved.expiresAt, verifiedAt: saved.verifiedAt };
}

// Record a real Drive response against the stored credential so a reload can
// show the connection it already proved instead of falling back to "미연결".
export function markDriveSessionVerified(): void {
  const verifiedAt = Date.now();
  for (const item of stores()) {
    const data = read(item.storage, SESSION_KEY);
    if (!data || data.clientId !== driveClientId || typeof data.token !== 'string' || typeof data.expiresAt !== 'number' || data.expiresAt <= verifiedAt) continue;
    try { item.storage.setItem(SESSION_KEY, JSON.stringify({ ...data, verifiedAt })); } catch { /* Try the other storage independently. */ }
  }
}

export function saveDriveSession(mode: DriveMode, session: DriveSession): boolean {
  const durable = write(SESSION_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt, clientId: driveClientId, savedAt: Date.now() }));
  for (const entry of modes) {
    write(key(entry, 'session'), null);
    write(key(entry, 'receipt'), null);
  }
  write(key(mode, 'enabled'), 'on');
  changed();
  return durable;
}

export function clearDriveSession(_mode: DriveMode): void {
  write(SESSION_KEY, null);
  for (const mode of modes) write(key(mode, 'session'), null);
  changed();
}

export function enableDriveSync(): void { write(key('sync', 'enabled'), 'on'); }

// Google access tokens live about an hour, but the user's approval does not
// expire. This marker records the approval itself so a reload can renew the
// token silently instead of asking for consent again.
const GRANT_KEY = 'pour-guide.drive.grant.v1';
export function grantDrive(): void { write(GRANT_KEY, 'on'); }
/** Records that Google no longer honors the approval, so (re)loads stop renewing. */
export function withdrawDriveGrant(): void { write(GRANT_KEY, 'off'); }
// A device that enabled Drive before this marker existed still holds an
// approval, so a missing marker falls back to the saved preference. An explicit
// 'off' or disconnect is authoritative and never renews again.
export function driveHasGrant(): boolean {
  let granted = false;
  let refused = false;
  let legacy = false;
  for (const item of stores()) {
    try {
      const marker = item.storage.getItem(GRANT_KEY);
      if (marker === 'on') granted = true;
      else if (marker === 'off') refused = true;
      else if (item.storage.getItem(key('sync', 'enabled')) === 'on' || item.storage.getItem(key('backup', 'enabled')) === 'on') legacy = true;
    } catch { /* Unavailable storage. */ }
  }
  // A refusal anywhere stops silent renewal; it must not be overridden by an
  // older enabled preference in the other storage.
  if (refused) return false;
  return granted || legacy;
}

export function driveWasEnabled(mode: DriveMode): boolean {
  return stores().some(item => {
    try { return item.storage.getItem(key(mode, 'enabled')) === 'on'; } catch { return false; }
  });
}

export function forgetDrive(_mode: DriveMode): void {
  write(GRANT_KEY, null);
  write(SESSION_KEY, null);
  for (const mode of modes) {
    write(key(mode, 'session'), null);
    write(key(mode, 'enabled'), null);
    write(key(mode, 'receipt'), null);
  }
  changed();
}

export function loadDriveReceipt(mode: DriveMode): DriveReceipt | null {
  const candidates: DriveReceipt[] = [];
  for (const item of stores()) {
    const data = read(item.storage, key(mode, 'receipt'));
    if (data && data.clientId === driveClientId && typeof data.confirmedAt === 'number' && Number.isFinite(data.confirmedAt) && typeof data.recipeCount === 'number' && Number.isInteger(data.recipeCount) && data.recipeCount >= 0) candidates.push({ confirmedAt: data.confirmedAt, recipeCount: data.recipeCount });
  }
  const receipt = candidates.sort((a, b) => b.confirmedAt - a.confirmedAt)[0] ?? null;
  if (receipt) saveDriveReceipt(mode, receipt);
  return receipt;
}

export function saveDriveReceipt(mode: DriveMode, receipt: DriveReceipt | null): void {
  write(key(mode, 'receipt'), receipt ? JSON.stringify({ ...receipt, clientId: driveClientId }) : null);
}
