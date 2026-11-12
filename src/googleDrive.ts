import { decodeBackup, encodeBackup } from './driveBackup';
import type { Library } from './storage';
import { DriveNetworkError, driveResponseError } from './driveErrors';
export { DriveAuthError } from './driveErrors';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3/files';
export const driveClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '13512728967-g0g2e77gjmlrgu626gpsp8s6q5rr59m3.apps.googleusercontent.com').trim();

interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface OAuth {
  initTokenClient(config: {
    client_id: string; scope: string; include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: () => void;
  }): { requestAccessToken(options: { prompt: string }): void };
  hasGrantedAllScopes(response: TokenResponse, scope: string): boolean;
  revoke(token: string, callback: () => void): void;
}
declare global { interface Window { google?: { accounts: { oauth2: OAuth } } } }
function oauthApi(): OAuth | undefined {
  return window.google?.accounts.oauth2;
}

let loading: Promise<void> | undefined;
export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => fail(), 15000);
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      loading = undefined;
      reject(new Error('Google 로그인을 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'));
    };
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      if (!window.google?.accounts.oauth2) { fail(); return; }
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

// Called directly from a click: opening the OAuth popup must retain user activation.
let connecting: Promise<{ token: string; expiresAt: number }> | undefined;
export function connectDrive(): Promise<{ token: string; expiresAt: number }> {
  if (connecting) return connecting;
  const pending = requestDriveToken();
  connecting = pending;
  const finished = () => { if (connecting === pending) connecting = undefined; };
  void pending.then(finished, finished);
  return pending;
}

function requestDriveToken(): Promise<{ token: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    const oauth = oauthApi();
    if (!oauth || !driveClientId) { reject(new Error('Google 로그인 설정을 확인해 주세요.')); return; }
    const client = oauth.initTokenClient({
      client_id: driveClientId, scope: SCOPE, include_granted_scopes: false,
      callback: response => {
        if (response.error || !response.access_token || !oauth.hasGrantedAllScopes(response, SCOPE)) {
          reject(new Error('Drive 권한을 허용해야 백업을 사용할 수 있습니다.')); return;
        }
        resolve({ token: response.access_token, expiresAt: Date.now() + Math.max(1, Number(response.expires_in) || 3600) * 1000 });
      },
      error_callback: () => reject(new Error('로그인 창이 닫혔거나 차단되었습니다. 다시 연결해 주세요.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

async function request(token: string, url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw await driveResponseError(response);
    // Consume the body while the timeout is still active.
    return new Response(await response.blob(), { status: response.status, headers: response.headers });
  } catch (error) {
    if (controller.signal.aborted) throw new DriveNetworkError('Drive 응답 시간이 초과되었습니다. 연결 상태는 유지되며 네트워크를 확인한 뒤 다시 시도해 주세요.');
    if (error instanceof TypeError) throw new DriveNetworkError('Drive에 연결하지 못했습니다. 연결 상태는 유지되며 네트워크를 확인한 뒤 다시 시도해 주세요.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export interface DriveBackup { id: string; name: string; createdTime: string }
export async function listDriveBackups(token: string): Promise<DriveBackup[]> {
  const query = new URLSearchParams({ spaces: 'appDataFolder', q: "trashed = false and appProperties has { key='app' and value='pour-guide' }", fields: 'files(id,name,createdTime)', orderBy: 'createdTime desc', pageSize: '20' });
  const result = await (await request(token, `${API}?${query}`)).json();
  if (!Array.isArray(result?.files)) throw new Error('Drive 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
  return result.files;
}

export async function saveDriveBackup(token: string, library: Library): Promise<void> {
  const json = encodeBackup(library);
  const boundary = `pour_guide_${crypto.randomUUID()}`;
  const metadata = { name: `Pour Guide ${new Date().toISOString()}.json`, parents: ['appDataFolder'], appProperties: { app: 'pour-guide' } };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--`;
  const file = await (await request(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })).json();
  if (typeof file?.id !== 'string' || !file.id) throw new Error('Drive 백업의 저장 결과를 확인하지 못했습니다. 다시 저장해 주세요.');
  const saved = await readDriveBackup(token, file.id);
  if (JSON.stringify(saved) !== JSON.stringify(decodeBackup(json))) throw new Error('Drive에 저장된 백업 내용이 일치하지 않습니다. 다시 저장해 주세요.');
}

export async function readDriveBackup(token: string, id: string): Promise<Library> {
  return decodeBackup(await (await request(token, `${API}/${encodeURIComponent(id)}?alt=media`)).text());
}
