import { parseRecipe } from './recipe';
import type { Recipe } from './types';

export interface Entry { id: string; revision: string; recipe: Recipe | null }
export interface Snapshot { version: 1; entries: Entry[] }
export function parseSnapshot(value: unknown): Snapshot {
  const data = value as Snapshot;
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) throw new Error('지원하지 않는 Drive 데이터입니다.');
  return { version: 1, entries: data.entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.revision !== 'string' || !/^\d{16}-[\w-]+$/.test(entry.revision)) throw new Error('손상된 동기화 데이터입니다.');
    const recipe = entry.recipe === null ? null : parseRecipe(JSON.stringify(entry.recipe));
    if (recipe && recipe.id !== entry.id) throw new Error('레시피 ID가 일치하지 않습니다.');
    return { id: entry.id, revision: entry.revision, recipe };
  }) };
}
export function mergeEntries(...sets: Entry[][]): Entry[] {
  const result = new Map<string, Entry>();
  for (const entry of sets.flat()) {
    const old = result.get(entry.id);
    if (!old || entry.revision > old.revision || (entry.revision === old.revision && JSON.stringify(entry) > JSON.stringify(old))) result.set(entry.id, entry);
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function trackChanges(entries: Entry[], recipes: Recipe[]): Entry[] {
  const previous = new Map(entries.map(entry => [entry.id, entry]));
  const current = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const newest = Math.max(0, ...entries.map(entry => Number(entry.revision.slice(0, 16))));
  const revision = `${String(Math.max(Date.now(), newest + 1)).padStart(16, '0')}-${crypto.randomUUID()}`;
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const recipe = current.get(id) ?? null;
    if (JSON.stringify(previous.get(id)?.recipe ?? null) !== JSON.stringify(recipe)) previous.set(id, { id, revision, recipe });
  }
  return [...previous.values()];
}

export class DriveAuthError extends Error {}

const API = 'https://www.googleapis.com/drive/v3/files';
export class Drive {
  constructor(private token: string) {}
  private async request(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${this.token}` } });
    if (response.status === 401 || response.status === 403) throw new DriveAuthError('Google Drive 권한을 확인하고 다시 연결해 주세요.');
    if (!response.ok) throw new Error(`Drive 동기화 실패 (${response.status}). 변경 사항은 브라우저에 보관됩니다.`);
    return response;
  }
  async read(): Promise<Entry[]> {
    let page = '';
    let entries: Entry[] = [];
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', q: "trashed = false and name = 'pour-guide-library-v1.json'", fields: 'nextPageToken,files(id)', pageSize: '100' });
      if (page) params.set('pageToken', page);
      const data = await (await this.request(`${API}?${params}`)).json() as { files: { id: string }[]; nextPageToken?: string };
      for (const file of data.files) {
        const snapshot = parseSnapshot(await (await this.request(`${API}/${encodeURIComponent(file.id)}?alt=media`)).json());
        entries = mergeEntries(entries, snapshot.entries);
      }
      page = data.nextPageToken ?? '';
    } while (page);
    return entries;
  }
  // Immutable snapshots avoid lost updates when several devices upload concurrently.
  async write(entries: Entry[]): Promise<void> {
    const boundary = `pour_${crypto.randomUUID()}`;
    const metadata = { name: 'pour-guide-library-v1.json', parents: ['appDataFolder'] };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ version: 1, entries })}\r\n--${boundary}--`;
    await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }
}

type TokenClient = { requestAccessToken: (options: { prompt: string }) => void };
interface GoogleIdentity { accounts: { oauth2: {
  initTokenClient: (config: { client_id: string; scope: string; callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback: () => void }) => TokenClient;
  revoke: (token: string, callback: () => void) => void;
} } }
declare global { interface Window { google?: GoogleIdentity } }
let identityLoading: Promise<void> | undefined;
export async function authorize(clientId: string): Promise<{ token: string; expires: number }> {
  if (!window.google) {
    identityLoading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { identityLoading = undefined; script.remove(); reject(new Error('Google 로그인 스크립트를 불러올 수 없습니다.')); };
      document.head.append(script);
    });
    await identityLoading;
  }
  return new Promise((resolve, reject) => {
    window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: response => response.access_token && !response.error
        ? resolve({ token: response.access_token, expires: Date.now() + (response.expires_in ?? 3600) * 1000 })
        : reject(new Error('Google Drive 연결이 승인되지 않았습니다.')),
      error_callback: () => reject(new Error('로그인 창이 닫혔거나 차단되었습니다. 다시 연결해 주세요.')),
    }).requestAccessToken({ prompt: 'select_account' });
  });
}
