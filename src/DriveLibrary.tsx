import { useEffect, useRef, useState } from 'react';
import { Cloud, Download, RefreshCw, Upload } from 'lucide-react';
import type { Library } from './storage';
import { connectDrive, driveClientId, DriveAuthError, listDriveBackups, loadGoogleIdentity, readDriveBackup, saveDriveBackup } from './googleDrive';
import type { DriveBackup } from './googleDrive';
import DriveConnectionStatus, { disconnectedDrive } from './DriveConnectionStatus';
import type { DriveConnection } from './DriveConnectionStatus';

interface Props { library: Library; blocked: boolean; onImport: (library: Library) => void; onBusy: (busy: boolean) => void }

export default function DriveLibrary({ library, blocked, onImport, onBusy }: Props) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<{ token: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<DriveBackup[]>([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<DriveConnection>(disconnectedDrive);
  const latest = useRef({ blocked, onImport });
  latest.current = { blocked, onImport };
  const lock = useRef(false);

  const prepare = () => {
    setError('');
    void loadGoogleIdentity().then(() => setReady(true)).catch(error => setError(error.message));
  };
  useEffect(() => { if (driveClientId) prepare(); }, []);
  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(() => {
      setSession(null);
      setConnection(disconnectedDrive);
      setBackups([]);
      setSelected('');
      setMessage('Google 연결이 만료되었습니다. 다시 연결해 주세요.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (error) {
      if (error instanceof DriveAuthError) {
        setSession(null); setBackups([]); setSelected('');
        setConnection(previous => ({ ...previous, state: 'error' }));
      }
      setError(error instanceof Error ? error.message : 'Drive 작업을 완료하지 못했습니다. 다시 시도해 주세요.');
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  }

  async function refresh(token: string) {
    setConnection(previous => ({ ...previous, state: 'checking' }));
    try {
      const files = await listDriveBackups(token);
      setBackups(files);
      setSelected(previous => files.some(file => file.id === previous) ? previous : files[0]?.id ?? '');
      setConnection({ state: 'verified', checkedAt: Date.now() });
    } catch (error) {
      setConnection(previous => ({ ...previous, state: 'error' }));
      throw error;
    }
  }

  return <section className="drive-library" aria-label="Google Drive 백업" aria-busy={busy}>
    <h3><Cloud size={17} aria-hidden="true" /> 수동 Drive 백업</h3>
    <DriveConnectionStatus connection={connection} />
    <p>보관함 전체를 백업하고 다른 기기에서 가져오세요. 저장할 때마다 새 백업을 만듭니다.</p>
    {!driveClientId ? <p>Drive 연동 준비 중입니다. 관리자 설정 후 연결할 수 있습니다.</p> : <>
      {!session ? <button className="btn btn-secondary" type="button" disabled={busy || (!ready && !error)} onClick={() => {
        if (!ready) { prepare(); return; }
        void run(async () => {
          setConnection({ state: 'checking', checkedAt: null });
          let connection;
          try { connection = await connectDrive(); }
          catch (error) { setConnection({ state: 'error', checkedAt: null }); throw error; }
          await refresh(connection.token);
          setSession(connection);
          setMessage('연결했습니다. 저장하거나 백업을 선택해 가져오세요.');
        });
      }}>{ready ? 'Google 계정 연결' : error ? '로그인 다시 준비' : '로그인 준비 중…'}</button> : <>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(async () => {
          await refresh(session.token);
          setMessage('연결 확인 완료 · 레시피를 변경하지 않고 Drive 응답을 확인했습니다.');
        })}>백업 연결 확인</button>
        <div className="drive-actions">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(async () => {
            await saveDriveBackup(session.token, library);
            setMessage(`${library.recipes.length}개 레시피를 Drive에 저장했습니다.`);
            await refresh(session.token);
          })}><Upload size={16} /> Drive에 저장</button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(() => refresh(session.token))} aria-label="Drive 백업 목록 새로고침"><RefreshCw size={16} /></button>
        </div>
        <label htmlFor="drive-backup">최근 백업 (최대 20개)</label>
        <select id="drive-backup" value={selected} disabled={busy || !backups.length} onChange={event => setSelected(event.target.value)}>
          {!backups.length && <option value="">저장된 백업이 없습니다</option>}
          {backups.map(file => <option key={file.id} value={file.id}>{new Date(file.createdTime).toLocaleString('ko-KR')}</option>)}
        </select>
        <button className="btn btn-secondary" type="button" disabled={busy || blocked || !selected} onClick={() => void run(async () => {
          const imported = await readDriveBackup(session.token, selected);
          if (latest.current.blocked) throw new Error('추출과 편집을 마친 뒤 가져와 주세요.');
          latest.current.onImport(imported);
          setMessage('백업을 가져왔습니다. 같은 레시피는 건너뛰고, 다른 내용은 별도로 보존했습니다.');
        })}><Download size={16} /> 선택한 백업 가져오기</button>
        <p>현재 레시피를 유지하며 병합합니다. 추출·편집 중에는 가져올 수 없습니다.</p>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => {
          setSession(null); setBackups([]); setSelected(''); setError(''); setMessage('이 기기의 연결을 해제했습니다. Drive 백업은 유지됩니다.');
          setConnection(disconnectedDrive);
        }}>이 기기 연결 해제</button>
      </>}
    </>}
    {busy && <p role="status">Drive 작업 중…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="library-error" role="alert">{error}</p>}
  </section>;
}
