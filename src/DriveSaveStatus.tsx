import type { DriveReceipt } from './driveSession';

export default function DriveSaveStatus({ receipt }: { receipt: DriveReceipt | null }) {
  if (!receipt) return <p className="library-note">이 탭에서 Drive 저장 내용을 아직 검증하지 않았습니다.</p>;
  return <p className="library-note" role="status">Drive 저장·다시 읽기 확인: {receipt.recipeCount}개 레시피 · {new Date(receipt.confirmedAt).toLocaleString('ko-KR')}</p>;
}
