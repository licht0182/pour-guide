import { CheckCircle2, Circle, CircleAlert, LoaderCircle } from 'lucide-react';

export interface DriveConnection {
  state: 'disconnected' | 'unverified' | 'checking' | 'verified' | 'error';
  checkedAt: number | null;
}

export const disconnectedDrive: DriveConnection = { state: 'disconnected', checkedAt: null };

export default function DriveConnectionStatus({ connection }: { connection: DriveConnection }) {
  const { state, checkedAt } = connection;
  const Icon = state === 'verified' ? CheckCircle2 : state === 'checking' ? LoaderCircle : state === 'error' ? CircleAlert : Circle;
  const label = state === 'verified' ? 'Drive 연결 확인됨' : state === 'checking' ? 'Drive 연결 확인 중…' : state === 'error' ? 'Drive 연결 확인 실패' : state === 'unverified' ? 'Google 승인됨 · Drive 확인 필요' : 'Drive 미연결';
  return <div className={`drive-connection is-${state}`} role="status">
    <span className="drive-connection-label"><Icon size={16} aria-hidden="true" /> {label}</span>
    {state === 'verified' && <span>Drive 앱 저장 공간에 접근할 수 있습니다.</span>}
    {checkedAt !== null && <span>최근 확인: <time dateTime={new Date(checkedAt).toISOString()}>{new Date(checkedAt).toLocaleString('ko-KR')}</time></span>}
  </div>;
}
