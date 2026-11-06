import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Library } from './storage';
import { authorize, Drive, mergeEntries, parseSnapshot, trackChanges } from './driveSync';
import type { Entry } from './driveSync';

const KEY = 'pour-guide.drive.entries.v1';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export function useDriveSync(library: Library, setLibrary: Dispatch<SetStateAction<Library>>, blocked: boolean) {
  const [status, setStatus] = useState('Google Drive에 연결하면 레시피가 자동 동기화됩니다.');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const auth = useRef<{ token: string; expires: number } | null>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(library);
  const paused = useRef(blocked);
  const entries = useRef<Entry[] | null>(null);
  latest.current = library;
  paused.current = blocked;

  function persist(value: Entry[]) {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, entries: value }));
    entries.current = value;
  }
  function observe() {
    if (entries.current === null) {
      const raw = localStorage.getItem(KEY);
      entries.current = raw ? parseSnapshot(JSON.parse(raw)).entries : [];
      if (!raw && !localStorage.getItem('pour-guide.library.v1')) {
        entries.current = latest.current.recipes.map(recipe => ({ id: recipe.id, recipe, revision: '0000000000000000-preset' }));
      }
    }
    persist(trackChanges(entries.current, latest.current.recipes));
  }
  async function sync() {
    if (working.current || !auth.current || paused.current || !navigator.onLine) return;
    working.current = true;
    setBusy(true);
    try {
      if (auth.current.expires <= Date.now() + 30000) {
        auth.current = null;
        setConnected(false);
        throw new Error('Google 연결이 만료되었습니다. 다시 연결하면 자동 동기화를 재개합니다.');
      }
      observe();
      const drive = new Drive(auth.current.token);
      const remote = await drive.read();
      if (!mounted.current || !auth.current || paused.current) return;
      observe(); // Include edits made while the request was in flight.
      const merged = mergeEntries(remote, entries.current!);
      const recipes = merged.flatMap(entry => entry.recipe ? [entry.recipe] : []);
      if (!recipes.length) throw new Error('모든 레시피가 삭제되었습니다. 새 레시피를 추가한 뒤 다시 동기화해 주세요.');
      persist(merged);
      const next = { recipes, activeId: recipes.some(recipe => recipe.id === latest.current.activeId) ? latest.current.activeId : recipes[0].id };
      if (JSON.stringify(next) !== JSON.stringify(latest.current)) {
        latest.current = next;
        setLibrary(next);
      }
      if (JSON.stringify(mergeEntries(remote)) !== JSON.stringify(merged)) await drive.write(merged);
      if (mounted.current && auth.current) setStatus(`동기화 완료 · ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      if (mounted.current) setStatus(error instanceof Error ? error.message : '동기화에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    try { observe(); } catch { setStatus('동기화 기록을 저장할 수 없습니다. 브라우저 저장 공간을 확인해 주세요.'); }
    const timer = window.setTimeout(() => void sync(), 1200);
    return () => window.clearTimeout(timer);
  }, [library, blocked, connected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    mounted.current = true;
    const tick = () => void sync();
    const visible = () => { if (document.visibilityState === 'visible') tick(); };
    const timer = window.setInterval(tick, 60000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', visible); };
  }, []); // refs provide the current library and connection
  async function connect() {
    if (!CLIENT_ID || working.current) return;
    setBusy(true);
    try {
      auth.current = await authorize(CLIENT_ID);
      setConnected(true);
      setStatus('Google Drive 연결됨');
      await sync();
    } catch (error) { setStatus(error instanceof Error ? error.message : '연결 실패'); }
    finally { setBusy(false); }
  }
  function disconnect() {
    const token = auth.current?.token;
    auth.current = null;
    if (token) window.google?.accounts.oauth2.revoke(token, () => {});
    setConnected(false);
    setStatus('연결 해제됨 · 레시피는 브라우저와 Drive에 보관됩니다.');
  }
  return { status, connected, busy, configured: !!CLIENT_ID, connect, disconnect, sync };
}
