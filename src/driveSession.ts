import { driveClientId } from './googleDrive';

export type DriveMode = 'sync' | 'backup';
export interface DriveSession { token: string; expiresAt: number }
export interface DriveReceipt { confirmedAt: number; recipeCount: number }
const key = (mode: DriveMode, suffix: string) => `pour-guide.drive.${mode}.${suffix}.v1`;

// A short-lived access token survives reloads in this tab, but is not kept in localStorage.
export function loadDriveSession(mode: DriveMode): DriveSession | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(key(mode, 'session')) ?? 'null');
    if (data?.clientId === driveClientId && typeof data.token === 'string' && data.token.length > 0 && Number.isFinite(data.expiresAt) && data.expiresAt > Date.now() + 30000) {
      return { token: data.token, expiresAt: data.expiresAt };
    }
    clearDriveSession(mode);
  } catch { /* Storage may be disabled or corrupt. */ }
  return null;
}

export function saveDriveSession(mode: DriveMode, session: DriveSession): boolean {
  try {
    sessionStorage.setItem(key(mode, 'session'), JSON.stringify({ ...session, clientId: driveClientId }));
    localStorage.setItem(key(mode, 'enabled'), 'on');
    return true;
  } catch { return false; }
}

export function clearDriveSession(mode: DriveMode): void {
  try { sessionStorage.removeItem(key(mode, 'session')); } catch { /* Optional storage. */ }
}

export function driveWasEnabled(mode: DriveMode): boolean {
  try { return localStorage.getItem(key(mode, 'enabled')) === 'on'; } catch { return false; }
}

export function forgetDrive(mode: DriveMode): void {
  clearDriveSession(mode);
  try { localStorage.removeItem(key(mode, 'enabled')); sessionStorage.removeItem(key(mode, 'receipt')); } catch { /* Optional storage. */ }
}

export function loadDriveReceipt(mode: DriveMode): DriveReceipt | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(key(mode, 'receipt')) ?? 'null');
    if (data?.clientId === driveClientId && Number.isFinite(data.confirmedAt) && Number.isInteger(data.recipeCount) && data.recipeCount >= 0) return { confirmedAt: data.confirmedAt, recipeCount: data.recipeCount };
  } catch { /* Optional storage. */ }
  return null;
}

export function saveDriveReceipt(mode: DriveMode, receipt: DriveReceipt | null): void {
  try {
    if (receipt) sessionStorage.setItem(key(mode, 'receipt'), JSON.stringify({ ...receipt, clientId: driveClientId }));
    else sessionStorage.removeItem(key(mode, 'receipt'));
  } catch { /* The verified result can still be displayed for this page. */ }
}
