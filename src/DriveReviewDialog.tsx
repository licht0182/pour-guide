import { useEffect, useRef } from 'react';
import type { Recipe } from './types';
import type { Entry } from './driveSync';
import { compareDriveRecipes, remoteRecipes } from './driveReview';
import { ACTION_LABELS, formatTime, totalDuration, totalWater } from './recipe';

export interface DriveReview { local: Recipe[]; remote: Entry[]; localKey: string; remoteKey: string }

function Preview({ recipe }: { recipe?: Recipe }) {
  if (!recipe) return <p>이쪽 보관함에는 없습니다.</p>;
  return <div>
    <strong>{recipe.name}</strong>
    <p>{recipe.coffee}g · {totalWater(recipe)}g · {formatTime(totalDuration(recipe))} · {recipe.temperature}℃</p>
    <p>{recipe.dripper} · {recipe.grind}</p>
    {recipe.description && <p>{recipe.description}</p>}
    <ol>{recipe.steps.map(step => <li key={step.id}>{step.title} · {ACTION_LABELS[step.action]} · {step.duration}초 · 추가 {step.water}g{step.flowRate !== null ? ` · ${step.flowRate}g/s` : ''}{step.note ? ` — ${step.note}` : ''}</li>)}</ol>
  </div>;
}

export default function DriveReviewDialog({ review, busy, status, onChoose, onDefer }: {
  review: DriveReview; busy: boolean; status: string;
  onChoose: (choice: 'remote' | 'local') => void; onDefer: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const remote = remoteRecipes(review.remote);
  const differences = compareDriveRecipes(review.local, remote);
  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  return <dialog className="drive-review" ref={dialog} aria-labelledby="drive-review-title" aria-describedby="drive-review-description" onCancel={event => { event.preventDefault(); if (!busy) onDefer(); }}>
    <h2 id="drive-review-title">Drive와 현재 레시피가 다릅니다</h2>
    <p id="drive-review-description">다른 기기에서 저장한 내용이 있습니다. 비교한 뒤 어느 내용을 사용할지 선택해 주세요. 선택 전에는 현재 기기와 Drive를 변경하지 않습니다.</p>
    <p>현재 기기 {review.local.length}개 · Drive {remote.length}개 · 차이가 있는 레시피 {differences.length}개</p>
    <div className="drive-review-differences">
      {differences.map(item => <details key={item.id}>
        <summary>{item.remote?.name ?? item.local?.name} — {item.fields.join(' · ')}</summary>
        <div className="drive-review-columns"><section aria-label="현재 기기 내용"><h3>현재 기기</h3><Preview recipe={item.local} /></section><section aria-label="Drive 내용"><h3>Drive</h3><Preview recipe={item.remote} /></section></div>
      </details>)}
    </div>
    <p className="drive-review-notice">‘Drive 내용으로 현재 기기 교체’는 기기 전용 레시피를 포함해 현재 보관함 전체를 교체합니다. ‘현재 기기 내용으로 Drive 갱신’은 Drive에만 있는 레시피를 포함해 Drive의 현재 내용을 교체합니다.</p>
    <p role="status">{busy ? 'Drive의 최신 내용을 다시 확인하고 선택을 적용하는 중입니다…' : status}</p>
    <div className="drive-review-actions">
      <button className="btn btn-primary" type="button" disabled={busy || !remote.length} onClick={() => onChoose('remote')}>Drive 내용으로 현재 기기 교체</button>
      <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => onChoose('local')}>현재 기기 내용으로 Drive 갱신</button>
      <button className="btn btn-ghost" type="button" disabled={busy} onClick={onDefer} autoFocus>지금은 덮어쓰지 않기</button>
    </div>
  </dialog>;
}
