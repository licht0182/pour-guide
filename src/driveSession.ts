import { driveClientId } from './googleDrive';

export type DriveMode = 'sync' | 'backup';
export interface DriveSession { token: string; expiresAt: number }
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
        (name === SESSION_KEY ? shared : legacy).push({ token: data.token, expiresAt: data.expiresAt, savedAt: typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : 0 });
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
  return { token: saved.token, expiresAt: saved.expiresAt };
}

export function saveDriveSession(mode: DriveMode, session: DriveSession): boolean {
  const durable = write(SESSION_KEY, JSON.stringify({ ...session, clientId: driveClientId, savedAt: Date.now() }));
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

export function driveWasEnabled(mode: DriveMode): boolean {
  return stores().some(item => {
    try { return item.storage.getItem(key(mode, 'enabled')) === 'on'; } catch { return false; }
  });
}

export function forgetDrive(_mode: DriveMode): void {
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
