import { parseRecipe, validateRecipe } from './recipe';
import type { Recipe } from './types';
import { DriveNetworkError, driveResponseError } from './driveErrors';
import { connectDrive, loadGoogleIdentity } from './googleDrive';
export { DriveAuthError, DriveNetworkError } from './driveErrors';

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
  // Compare canonical shapes only: validation drops transport metadata and puts
  // keys in a fixed order, so a re-read entry never looks edited.
  const previous = new Map(entries.map(entry => [entry.id, {
    id: entry.id,
    revision: entry.revision,
    recipe: entry.recipe === null ? null : validateRecipe(entry.recipe),
  }]));
  // The library array is the canonical order; each entry records its position so
  // another device can restore it.
  const current = new Map(recipes.map((recipe, index) => [recipe.id, validateRecipe({ ...recipe, order: index })]));
  const newest = Math.max(0, ...entries.map(entry => Number(entry.revision.slice(0, 16))));
  const revision = `${String(Math.max(Date.now(), newest + 1)).padStart(16, '0')}-${crypto.randomUUID()}`;
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const recipe = current.get(id) ?? null;
    if (JSON.stringify(previous.get(id)?.recipe ?? null) !== JSON.stringify(recipe)) previous.set(id, { id, revision, recipe });
  }
  return [...previous.values()];
}

const API = 'https://www.googleapis.com/drive/v3/files';
export class Drive {
  constructor(private token: string) {}
  private async request(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000), headers: { ...init?.headers, Authorization: `Bearer ${this.token}` } });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new DriveNetworkError('Drive 응답 시간이 초과되었습니다. 연결 상태는 유지되며 네트워크를 확인한 뒤 다시 시도해 주세요.');
      if (error instanceof TypeError) throw new DriveNetworkError('Drive에 연결하지 못했습니다. 연결 상태는 유지되며 네트워크를 확인한 뒤 다시 시도해 주세요.');
      throw error;
    }
    if (!response.ok) throw await driveResponseError(response);
    return response;
  }
  async checkConnection(): Promise<void> {
    const params = new URLSearchParams({ spaces: 'appDataFolder', fields: 'files(id)', pageSize: '1', q: 'trashed = false' });
    const data = await (await this.request(`${API}?${params}`)).json();
    if (!Array.isArray(data?.files)) throw new Error('Drive 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
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
    const file = await (await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
    if (typeof file?.id !== 'string' || !file.id) throw new Error('Drive 저장 결과를 확인하지 못했습니다. 다시 동기화해 주세요.');
    const saved = parseSnapshot(await (await this.request(`${API}/${encodeURIComponent(file.id)}?alt=media`)).json());
    const expected = parseSnapshot({ version: 1, entries });
    if (JSON.stringify(mergeEntries(saved.entries)) !== JSON.stringify(mergeEntries(expected.entries))) throw new Error('Drive에 저장된 내용이 일치하지 않습니다. 로컬 레시피는 유지됩니다. 다시 동기화해 주세요.');
  }
}

export function authorize(_clientId: string): Promise<{ token: string; expires: number }> {
  const begin = () => connectDrive().then(session => ({ token: session.token, expires: session.expiresAt }));
  return window.google?.accounts.oauth2 ? begin() : loadGoogleIdentity().then(begin);
}
