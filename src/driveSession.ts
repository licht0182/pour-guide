import { driveClientId } from './googleDrive';

export type DriveMode = 'sync' | 'backup';
export interface DriveSession { token: string; expiresAt: number }
export interface DriveReceipt { confirmedAt: number; recipeCount: number }
const key = (mode: DriveMode, suffix: string) => `pour-guide.drive.${mode}.${suffix}.v1`;

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
export function loadDriveSession(mode: DriveMode): DriveSession | null {
  const candidates: (DriveSession & { savedAt: number })[] = [];
  for (const item of stores()) {
    const data = read(item.storage, key(mode, 'session'));
    if (data && data.clientId === driveClientId && typeof data.token === 'string' && data.token.length > 0 && typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now()) {
      candidates.push({ token: data.token, expiresAt: data.expiresAt, savedAt: typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : 0 });
    }
  }
  const saved = candidates.sort((a, b) => b.savedAt - a.savedAt)[0];
  if (!saved) { clearDriveSession(mode); return null; }
  // Migrate the previous tab-only format without requiring another login.
  write(key(mode, 'session'), JSON.stringify({ ...saved, clientId: driveClientId }));
  write(key(mode, 'enabled'), 'on');
  return { token: saved.token, expiresAt: saved.expiresAt };
}

export function saveDriveSession(mode: DriveMode, session: DriveSession): boolean {
  const durable = write(key(mode, 'session'), JSON.stringify({ ...session, clientId: driveClientId, savedAt: Date.now() }));
  write(key(mode, 'enabled'), 'on');
  return durable;
}

export function clearDriveSession(mode: DriveMode): void {
  write(key(mode, 'session'), null);
}

export function driveWasEnabled(mode: DriveMode): boolean {
  return stores().some(item => {
    try { return item.storage.getItem(key(mode, 'enabled')) === 'on'; } catch { return false; }
  });
}

export function forgetDrive(mode: DriveMode): void {
  clearDriveSession(mode);
  write(key(mode, 'enabled'), null);
  write(key(mode, 'receipt'), null);
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
