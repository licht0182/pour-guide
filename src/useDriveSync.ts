import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Library } from './storage';
import { authorize, Drive, DriveAuthError, DriveNetworkError, mergeEntries, parseSnapshot, trackChanges } from './driveSync';
import type { Entry } from './driveSync';
import { disconnectedDrive, restoredDrive } from './DriveConnectionStatus';
import type { DriveConnection } from './DriveConnectionStatus';
import { clearDriveSession, driveWasEnabled, enableDriveSync, forgetDrive, loadDriveReceipt, loadDriveSession, markDriveSessionVerified, saveDriveReceipt, saveDriveSession, subscribeDriveSession } from './driveSession';
import type { DriveReceipt } from './driveSession';
import { entryKey, needsDriveReview, recipeKey, remoteRecipes, replaceDriveEntries } from './driveReview';
import type { DriveReview } from './DriveReviewDialog';
import { driveClientId } from './googleDrive';

const KEY = 'pour-guide.drive.entries.v1';
const CLIENT_ID = driveClientId;
const BASELINE_KEY = 'pour-guide.drive.baseline.v1';
export function useDriveSync(library: Library, setLibrary: Dispatch<SetStateAction<Library>>, blocked: boolean) {
  const [restored] = useState(() => loadDriveSession('sync'));
  const [status, setStatus] = useState(() => restored ? driveWasEnabled('sync') ? '이 기기에 저장된 Google 연결로 동기화를 재개합니다.' : '수동 백업과 Google 연결을 공유합니다. 자동 동기화 시작을 누르면 재로그인 없이 시작합니다.' : driveWasEnabled('sync') ? '자동 동기화 설정은 저장되어 있습니다. 인증이 만료되었거나 저장된 인증이 없습니다. Google 계정을 다시 연결해 주세요.' : 'Google Drive에 연결하면 레시피가 자동 동기화됩니다.');
  const [connected, setConnected] = useState(!!restored);
  const [enabled, setEnabled] = useState(() => driveWasEnabled('sync'));
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [authRevision, setAuthRevision] = useState(0);
  const [receipt, setReceipt] = useState<DriveReceipt | null>(() => loadDriveReceipt('sync'));
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<DriveConnection>(() => restoredDrive(restored));
  const [review, setReview] = useState<DriveReview | null>(null);
  const reviewRef = useRef<DriveReview | null>(null);
  const deferred = useRef('');
  const auth = useRef<{ token: string; expires: number } | null>(restored ? { token: restored.token, expires: restored.expiresAt } : null);
  const working = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(library);
  const paused = useRef(blocked);
  const entries = useRef<Entry[] | null>(null);
  latest.current = library;
  paused.current = blocked;

  function closeReview() { reviewRef.current = null; setReview(null); }
  function showReview(remote: Entry[], message: string) {
    const next = { local: latest.current.recipes, remote, localKey: recipeKey(latest.current.recipes), remoteKey: entryKey(remote) };
    reviewRef.current = next;
    setReview(next);
    setStatus(message);
  }
  function baseline(): Entry[] | null {
    try {
      const saved = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? 'null');
      return saved?.clientId === CLIENT_ID ? parseSnapshot(saved).entries : null;
    } catch { return null; }
  }

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
  async function sync(manual = false, resolution?: { choice: 'remote' | 'local'; localKey: string; remoteKey: string }) {
    if (manual && auth.current && !enabledRef.current) {
      enableDriveSync(); enabledRef.current = true; setEnabled(true);
    }
    if (!enabledRef.current) return;
    if (working.current || !auth.current || paused.current || !navigator.onLine) return;
    if (reviewRef.current && !resolution) return;
    working.current = true;
    setBusy(true);
    setConnection(previous => ({ ...previous, state: 'checking' }));
    const attempted = auth.current;
    try {
      if (auth.current.expires <= Date.now()) {
        auth.current = null;
        clearDriveSession('sync');
        closeReview();
        setConnected(false);
        setConnection(previous => ({ ...previous, state: 'error' }));
        setStatus('Google 연결이 만료되었습니다. 다시 연결하면 자동 동기화를 재개합니다.');
        return;
      }
      observe();
      const drive = new Drive(auth.current.token);
      const remote = await drive.read();
      if (!mounted.current || auth.current !== attempted) return;
      markDriveSessionVerified();
      setConnection({ state: 'verified', checkedAt: Date.now() });
      if (paused.current) return;
      observe(); // Include edits made while the request was in flight.
      const localKey = recipeKey(latest.current.recipes);
      const remoteKey = entryKey(remote);
      const pair = JSON.stringify([localKey, remoteKey]);
      if (resolution && (resolution.localKey !== localKey || resolution.remoteKey !== remoteKey)) {
        showReview(remote, '비교하는 동안 레시피가 다시 변경되었습니다. 최신 내용을 확인하고 다시 선택해 주세요.');
        return;
      }
      if (!resolution && needsDriveReview(latest.current.recipes, remote, baseline())) {
        if (!manual && deferred.current === pair) {
          setStatus('덮어쓰기를 보류했습니다. 현재 기기와 Drive를 각각 유지합니다. 지금 동기화를 누르면 다시 비교합니다.');
          return;
        }
        showReview(remote, '다른 기기의 변경 사항을 발견했습니다. 적용 방향을 선택해 주세요.');
        return;
      }
      const merged = resolution?.choice === 'remote' ? mergeEntries(remote)
        : resolution?.choice === 'local' ? replaceDriveEntries(latest.current.recipes, remote, entries.current!)
        : mergeEntries(remote, entries.current!);
      // Merge is ID-sorted; the stored positions carry the user's own order.
      const recipes = remoteRecipes(merged);
      if (!recipes.length) throw new Error('모든 레시피가 삭제되었습니다. 새 레시피를 추가한 뒤 다시 동기화해 주세요.');
      persist(merged);
      const next = { recipes, activeId: recipes.some(recipe => recipe.id === latest.current.activeId) ? latest.current.activeId : recipes[0].id };
      if (JSON.stringify(next) !== JSON.stringify(latest.current)) {
        latest.current = next;
        setLibrary(next);
      }
      if (JSON.stringify(mergeEntries(remote)) !== JSON.stringify(merged)) await drive.write(merged);
      if (mounted.current && auth.current === attempted) {
        localStorage.setItem(BASELINE_KEY, JSON.stringify({ version: 1, entries: merged, clientId: CLIENT_ID }));
        deferred.current = '';
        closeReview();
        const confirmed = { confirmedAt: Date.now(), recipeCount: recipes.length };
        saveDriveReceipt('sync', confirmed);
        setReceipt(confirmed);
        setConnection({ state: 'verified', checkedAt: Date.now() });
        setStatus(`동기화 완료 · ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      if (auth.current !== attempted) return;
      if (error instanceof DriveAuthError) {
        closeReview();
        auth.current = null;
        clearDriveSession('sync');
        setConnected(false);
      }
      if (mounted.current) {
        // A transport failure says nothing about the stored credential, so keep the
        // connection it already proved. A server rejection is a real failure.
        if (error instanceof DriveNetworkError) setConnection(restoredDrive(loadDriveSession('sync')));
        else setConnection(previous => ({ ...previous, state: 'error' }));
        setStatus(error instanceof Error ? error.message : '동기화에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && auth.current && auth.current !== attempted) window.setTimeout(() => void sync(), 0);
    }
  }
  useEffect(() => {
    try { observe(); } catch { setStatus('동기화 기록을 저장할 수 없습니다. 브라우저 저장 공간을 확인해 주세요.'); }
    if (auth.current && !reviewRef.current) setStatus(!enabledRef.current ? '수동 백업과 Google 연결을 공유합니다. 자동 동기화 시작을 누르면 재로그인 없이 시작합니다.' : !navigator.onLine ? '오프라인 · 변경 사항은 브라우저에 보관되며 온라인 복귀 후 Drive에 저장됩니다.' : blocked ? '현재 작업을 마친 뒤 Drive 동기화를 재개합니다.' : 'Drive 동기화 대기 중 · 저장 후 내용을 다시 읽어 확인합니다.');
    const timer = window.setTimeout(() => void sync(), 1200);
    return () => window.clearTimeout(timer);
  }, [library, blocked, connected, enabled, authRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribeDriveSession(() => {
    const next = loadDriveSession('sync');
    const active = driveWasEnabled('sync');
    if (next && next.token === auth.current?.token && next.expiresAt === auth.current?.expires && active === enabledRef.current) return;
    auth.current = next ? { token: next.token, expires: next.expiresAt } : null;
    enabledRef.current = active;
    setEnabled(active);
    setConnected(!!next);
    setAuthRevision(value => value + 1);
    closeReview(); deferred.current = '';
    setReceipt(loadDriveReceipt('sync'));
    setConnection(restoredDrive(next));
    setStatus(next ? '공유 Google 연결을 받았습니다.' : '공유 Google 연결이 해제되었거나 만료되었습니다. 다시 연결해 주세요.');
  }), []);
  useEffect(() => {
    if (auth.current && !enabledRef.current) void checkConnection();
  }, [connected, enabled, authRevision]);
  useEffect(() => {
    mounted.current = true;
    const tick = () => void sync();
    const visible = () => { if (document.visibilityState === 'visible') tick(); };
    const timer = window.setInterval(tick, 60000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', visible); };
  }, []); // refs provide the current library and connection
  const expiresAt = auth.current?.expires;
  useEffect(() => {
    if (!connected || !expiresAt) return;
    const timer = window.setTimeout(() => {
      if (auth.current?.expires !== expiresAt) return;
      auth.current = null;
      clearDriveSession('sync');
      closeReview();
      setConnected(false);
      setConnection(previous => ({ ...previous, state: 'error' }));
      setStatus('Google 연결이 만료되었습니다. 다시 연결해 주세요.');
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [connected, expiresAt]);
  async function connect() {
    if (!CLIENT_ID || working.current) return;
    setBusy(true);
    setConnection(previous => ({ ...previous, state: 'checking' }));
    try {
      auth.current = await authorize(CLIENT_ID);
      const remembered = saveDriveSession('sync', { token: auth.current.token, expiresAt: auth.current.expires });
      setEnabled(true);
      enabledRef.current = true;
      saveDriveReceipt('sync', null);
      setReceipt(null);
      setConnected(true);
      setConnection({ state: 'unverified', checkedAt: null });
      setStatus('Google 승인 완료 · Drive 응답을 확인해 주세요.');
      await sync(true);
      if (!remembered) setStatus(previous => `${previous} 이 기기에 인증을 저장하지 못해 앱을 다시 열면 재연결이 필요할 수 있습니다. 브라우저 저장 공간 설정을 확인해 주세요.`);
    } catch (error) {
      setConnection(previous => ({ ...previous, state: 'error' }));
      setStatus(error instanceof Error ? error.message : '연결 실패');
    }
    finally { setBusy(false); }
  }
  async function checkConnection() {
    if (working.current || !auth.current) return;
    if (auth.current.expires <= Date.now()) {
      auth.current = null;
      clearDriveSession('sync');
      setConnected(false);
      setConnection(previous => ({ ...previous, state: 'error' }));
      setStatus('Google 연결이 만료되었습니다. 다시 연결해 주세요.');
      return;
    }
    const session = auth.current;
    working.current = true;
    setBusy(true);
    setConnection(previous => ({ ...previous, state: 'checking' }));
    try {
      await new Drive(session.token).checkConnection();
      if (!mounted.current || auth.current !== session) return;
      markDriveSessionVerified();
      setConnection({ state: 'verified', checkedAt: Date.now() });
      setStatus('연결 확인 완료 · 레시피를 변경하지 않고 Drive 응답을 확인했습니다.');
    } catch (error) {
      if (!mounted.current || auth.current !== session) return;
      if (error instanceof DriveAuthError) { auth.current = null; clearDriveSession('sync'); setConnected(false); }
      if (error instanceof DriveNetworkError) setConnection(restoredDrive(loadDriveSession('sync')));
      else setConnection(previous => ({ ...previous, state: 'error' }));
      setStatus(error instanceof Error ? error.message : '연결 확인에 실패했습니다. 네트워크를 확인해 주세요.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function disconnect() {
    const token = auth.current?.token;
    auth.current = null;
    closeReview();
    deferred.current = '';
    forgetDrive('sync');
    enabledRef.current = false;
    setEnabled(false);
    setReceipt(null);
    if (token) window.google?.accounts.oauth2.revoke(token, () => {});
    setConnected(false);
    setConnection(disconnectedDrive);
    setStatus('연결 해제됨 · 레시피는 브라우저와 Drive에 보관됩니다.');
  }
  function chooseReview(choice: 'remote' | 'local') {
    const current = reviewRef.current;
    if (!current) return;
    void sync(true, { choice, localKey: current.localKey, remoteKey: current.remoteKey });
  }
  function deferReview() {
    if (working.current) return;
    const current = reviewRef.current;
    if (current) deferred.current = JSON.stringify([current.localKey, current.remoteKey]);
    closeReview();
    setStatus('덮어쓰기를 보류했습니다. 현재 기기와 Drive를 각각 유지합니다. 지금 동기화를 누르면 다시 비교합니다.');
  }
  return { status, connected, enabled, busy, connection, receipt, review, chooseReview, deferReview, configured: !!CLIENT_ID, connect, disconnect, sync, checkConnection };
}
