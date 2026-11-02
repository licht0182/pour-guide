import { useEffect, useRef, useState } from 'react';
import type { FormEvent, SyntheticEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Scale, Trash2, X } from 'lucide-react';
import type { Recipe, StepAction } from './types';
import {
  ACTION_LABELS,
  formatTime,
  getStepSchedule,
  scaleRecipe,
  totalDuration,
  totalWater,
  validateRecipe,
} from './recipe';

interface RecipeEditorProps {
  recipe: Recipe;
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
}

interface DraftRecipe {
  name: string;
  description: string;
  coffee: string;
  temperature: string;
  grind: string;
  dripper: string;
}

interface DraftStep {
  id: string;
  title: string;
  action: StepAction;
  duration: string;
  water: string;
  flowRate: string;
  note: string;
}

interface StepIssues {
  title: boolean;
  duration: boolean;
  water: boolean;
  flowRate: boolean;
  note: boolean;
}

const ACTIONS: StepAction[] = ['pour', 'wait', 'swirl', 'stir'];
const MAX_STEPS = 100;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 400;
const MAX_TEXT = 80;
const MAX_NOTE = 300;
const MIN_COFFEE = 0.1;
const MAX_COFFEE = 500;
const MIN_TEMPERATURE = 1;
const MAX_TEMPERATURE = 100;
const MAX_DURATION = 1800;
const MAX_WATER = 2000;
const MIN_FLOW_RATE = 0.1;
const MAX_FLOW_RATE = 100;

function toNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

/** Mirrors recipe.getStepFlowRate so the editor previews the saved value. */
function draftFlowRate(step: DraftStep): number | null {
  if (step.flowRate.trim() === '') return null;
  const explicit = toNumber(step.flowRate);
  return Number.isFinite(explicit) ? explicit : null;
}

function effectiveFlowRate(step: DraftStep): number {
  if (step.action !== 'pour') return 0;
  const explicit = draftFlowRate(step);
  if (explicit !== null) return explicit;
  const duration = toNumber(step.duration);
  const water = toNumber(step.water);
  return duration > 0 && Number.isFinite(water) ? water / duration : 0;
}

function stepIssues(step: DraftStep): StepIssues {
  const duration = toNumber(step.duration);
  const water = toNumber(step.water);
  const explicit = draftFlowRate(step);
  const rate = effectiveFlowRate(step);
  const tooSlow = step.action === 'pour'
    && Number.isFinite(water) && Number.isInteger(duration) && duration > 0
    && rate > 0 && rate * duration + 1e-9 < water;
  return {
    title: !step.title.trim() || step.title.length > MAX_TEXT,
    duration: !Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION,
    water: step.action === 'pour' && (!Number.isFinite(water) || water < 0 || water > MAX_WATER),
    flowRate: step.action === 'pour' && (
      (explicit !== null && (explicit < MIN_FLOW_RATE || explicit > MAX_FLOW_RATE)) || tooSlow
    ),
    note: step.note.length > MAX_NOTE,
  };
}

function collectMessages(draft: DraftRecipe, steps: DraftStep[]): { messages: string[]; badStepIds: Set<string> } {
  const messages: string[] = [];
  const badStepIds = new Set<string>();
  const coffee = toNumber(draft.coffee);
  const temperature = toNumber(draft.temperature);

  if (!draft.name.trim()) messages.push('레시피 이름을 입력해 주세요.');
  else if (draft.name.length > MAX_NAME) messages.push(`레시피 이름은 ${MAX_NAME}자 이하여야 합니다.`);
  if (draft.description.length > MAX_DESCRIPTION) {
    messages.push(`레시피 설명은 ${MAX_DESCRIPTION}자 이하여야 합니다.`);
  }
  if (!Number.isFinite(coffee) || coffee < MIN_COFFEE || coffee > MAX_COFFEE) {
    messages.push(`원두량은 ${MIN_COFFEE}~${MAX_COFFEE}g 사이의 숫자여야 합니다.`);
  }
  if (!Number.isFinite(temperature) || temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
    messages.push(`물 온도는 ${MIN_TEMPERATURE}~${MAX_TEMPERATURE}℃ 사이의 숫자여야 합니다.`);
  }
  if (!draft.grind.trim()) messages.push('분쇄도를 입력해 주세요.');
  else if (draft.grind.length > MAX_TEXT) messages.push(`분쇄도는 ${MAX_TEXT}자 이하여야 합니다.`);
  if (!draft.dripper.trim()) messages.push('드리퍼를 입력해 주세요.');
  else if (draft.dripper.length > MAX_TEXT) messages.push(`드리퍼는 ${MAX_TEXT}자 이하여야 합니다.`);

  if (steps.length === 0) messages.push('단계를 1개 이상 추가해 주세요.');
  if (steps.length > MAX_STEPS) messages.push(`단계는 ${MAX_STEPS}개 이하로 작성해 주세요.`);

  steps.forEach((step, index) => {
    const label = `${index + 1}번째 단계`;
    const issues = stepIssues(step);
    if (issues.title) {
      messages.push(
        !step.title.trim()
          ? `${label} 이름을 입력해 주세요.`
          : `${label} 이름은 ${MAX_TEXT}자 이하여야 합니다.`,
      );
    }
    if (issues.duration) {
      const duration = toNumber(step.duration);
      messages.push(
        Number.isFinite(duration)
          ? `${label} 시간은 1~${MAX_DURATION}초 사이 정수여야 합니다.`
          : `${label} 시간을 숫자로 입력해 주세요.`,
      );
    }
    if (issues.water) {
      const water = toNumber(step.water);
      messages.push(
        Number.isFinite(water)
          ? `${label} 추가 물량은 0~${MAX_WATER}g 사이여야 합니다.`
          : `${label} 추가 물량을 숫자로 입력해 주세요.`,
      );
    }
    if (issues.flowRate) {
      const explicit = draftFlowRate(step);
      const rate = effectiveFlowRate(step);
      messages.push(
        explicit !== null && (explicit < MIN_FLOW_RATE || explicit > MAX_FLOW_RATE)
          ? `${label} 유량은 ${MIN_FLOW_RATE}~${MAX_FLOW_RATE}g/s 사이여야 합니다.`
          : `${label}: ${rate.toFixed(2)}g/s로는 ${step.duration}초 안에 ${step.water}g을 붓지 못합니다. 최소 ${Math.ceil(toNumber(step.water) / rate)}초가 필요합니다.`,
      );
    }
    if (issues.note) messages.push(`${label} 메모는 ${MAX_NOTE}자 이하여야 합니다.`);
    if (issues.title || issues.duration || issues.water || issues.flowRate || issues.note) {
      badStepIds.add(step.id);
    }
  });

  return { messages, badStepIds };
}

function buildRecipe(recipe: Recipe, draft: DraftRecipe, steps: DraftStep[]): Recipe {
  return {
    id: recipe.id,
    name: draft.name,
    description: draft.description,
    coffee: toNumber(draft.coffee),
    temperature: toNumber(draft.temperature),
    grind: draft.grind,
    dripper: draft.dripper,
    steps: steps.map(step => ({
      id: step.id,
      title: step.title,
      action: step.action,
      duration: toNumber(step.duration),
      water: step.action === 'pour' ? toNumber(step.water) : 0,
      flowRate: step.action === 'pour' ? draftFlowRate(step) : null,
      note: step.note,
    })),
  };
}

export default function RecipeEditor({ recipe, onSave, onCancel }: RecipeEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<DraftRecipe>(() => ({
    name: recipe.name,
    description: recipe.description,
    coffee: numberText(recipe.coffee),
    temperature: numberText(recipe.temperature),
    grind: recipe.grind,
    dripper: recipe.dripper,
  }));
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    recipe.steps.map(step => ({
      id: step.id,
      title: step.title,
      action: step.action,
      duration: numberText(step.duration),
      water: numberText(step.water),
      flowRate: step.flowRate === null ? '' : numberText(step.flowRate),
      note: step.note,
    })),
  );
  const [attempted, setAttempted] = useState(false);
  const [scaleTarget, setScaleTarget] = useState('');
  const [scaleNotice, setScaleNotice] = useState('');
  const [scaleFailed, setScaleFailed] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    nameRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const current = buildRecipe(recipe, draft, steps);
  const { messages, badStepIds } = collectMessages(draft, steps);
  const coffee = toNumber(draft.coffee);
  const temperature = toNumber(draft.temperature);
  const nameMissing = !draft.name.trim();
  const nameTooLong = draft.name.length > MAX_NAME;
  const descriptionTooLong = draft.description.length > MAX_DESCRIPTION;
  const coffeeInvalid = !Number.isFinite(coffee) || coffee < MIN_COFFEE || coffee > MAX_COFFEE;
  const temperatureInvalid =
    !Number.isFinite(temperature) || temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE;
  const grindMissing = !draft.grind.trim();
  const grindTooLong = draft.grind.length > MAX_TEXT;
  const dripperMissing = !draft.dripper.trim();
  const dripperTooLong = draft.dripper.length > MAX_TEXT;
  const displayRecipe: Recipe = {
    ...current,
    steps: current.steps.map(step => ({
      ...step,
      duration: Number.isFinite(step.duration) && step.duration > 0 ? step.duration : 0,
      water: Number.isFinite(step.water) && step.water > 0 ? step.water : 0,
    })),
  };
  const schedule = getStepSchedule(displayRecipe);
  const water = totalWater(displayRecipe);
  const duration = totalDuration(displayRecipe);
  const ratio = water > 0 && Number.isFinite(coffee) && coffee > 0 ? water / coffee : null;

  const patchDraft = (patch: Partial<DraftRecipe>) => {
    setSaveError('');
    setScaleNotice('');
    setScaleFailed(false);
    setDraft(previous => ({ ...previous, ...patch }));
  };

  const updateStep = (id: string, change: (step: DraftStep) => DraftStep) => {
    setSaveError('');
    setScaleNotice('');
    setScaleFailed(false);
    setSteps(previous => previous.map(step => (step.id === id ? change(step) : step)));
  };

  const addStep = () => {
    setSaveError('');
    setScaleNotice('');
    setScaleFailed(false);
    setSteps(previous =>
      previous.length >= MAX_STEPS
        ? previous
        : [
            ...previous,
            {
              id: crypto.randomUUID(),
              title: `새 단계 ${previous.length + 1}`,
              action: 'pour',
              duration: '30',
              water: '50',
              flowRate: '',
              note: '',
            },
          ],
    );
  };

  const moveStep = (id: string, direction: -1 | 1) => {
    setSaveError('');
    setScaleNotice('');
    setScaleFailed(false);
    setSteps(previous => {
      const index = previous.findIndex(step => step.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const applyScale = () => {
    const target = toNumber(scaleTarget);
    if (!Number.isFinite(target) || target < MIN_COFFEE || target > MAX_COFFEE) {
      setScaleFailed(true);
      setScaleNotice(`조정할 원두량을 ${MIN_COFFEE}~${MAX_COFFEE}g 사이 숫자로 입력해 주세요.`);
      return;
    }
    if (!Number.isFinite(coffee) || coffee <= 0) {
      setScaleFailed(true);
      setScaleNotice('먼저 현재 원두량을 올바른 숫자로 입력해 주세요.');
      return;
    }
    if (steps.some(step => step.action === 'pour' && !Number.isFinite(toNumber(step.water)))) {
      setScaleFailed(true);
      setScaleNotice('물량이 비어 있는 물 붓기 단계를 먼저 채워 주세요.');
      return;
    }
    try {
      const scaled = scaleRecipe(current, target);
      setDraft(previous => ({ ...previous, coffee: numberText(scaled.coffee) }));
      setSteps(previous =>
        previous.map((step, index) => ({
          ...step,
          water: numberText(scaled.steps[index].water),
          flowRate: numberText(scaled.steps[index].flowRate ?? Number.NaN),
        })),
      );
      setScaleFailed(false);
      setScaleNotice(`현재 ${numberText(coffee)}g의 비율을 유지한 채 ${numberText(scaled.coffee)}g 기준으로 물량을 조정했습니다.`);
      setScaleTarget('');
    } catch (error) {
      setScaleFailed(true);
      setScaleNotice(error instanceof Error ? error.message : '물량을 조정하지 못했습니다.');
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (messages.length > 0) {
      window.setTimeout(() => {
        const dialog = dialogRef.current;
        const invalid = dialog?.querySelector<HTMLElement>('[aria-invalid="true"]');
        (invalid ?? dialog?.querySelector<HTMLElement>('.editor-errors'))?.focus();
      }, 0);
      return;
    }
    try {
      const next = validateRecipe(current);
      if (dialogRef.current?.open) dialogRef.current.close();
      onSave(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '레시피를 저장할 수 없습니다.');
    }
  };

  const close = (event?: SyntheticEvent<HTMLDialogElement>) => {
    event?.preventDefault();
    if (dialogRef.current?.open) dialogRef.current.close();
    onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      className="recipe-editor"
      aria-labelledby="recipe-editor-title"
      aria-describedby="recipe-editor-intro"
      onCancel={close}
    >
      <div className="editor-shell">
        <header className="editor-header">
          <div>
            <h2 id="recipe-editor-title" className="editor-title">레시피 편집</h2>
            <p id="recipe-editor-intro" className="editor-intro">
              물량은 각 단계에서 추가로 붓는 양입니다. 시작 시간은 자동으로 이어집니다.
            </p>
          </div>
          <button type="button" className="icon-button editor-close" onClick={() => close()} aria-label="편집 닫기">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="editor-scroll">
          <form id="recipe-editor-form" className="editor-form" onSubmit={submit} noValidate>
            {attempted && messages.length > 0 && (
              <div className="editor-errors" role="alert" tabIndex={-1}>
                <ul>
                  {messages.map((message, index) => (
                    <li key={`${index}-${message}`}>{message}</li>
                  ))}
                </ul>
              </div>
            )}
            {attempted && saveError && <p className="field-error" role="alert">{saveError}</p>}

            <div className="editor-fields">
              <label className="field field-full">
                <span className="field-label">레시피 이름</span>
                <input
                  ref={nameRef}
                  className="field-input"
                  value={draft.name}
                  aria-invalid={attempted && (nameMissing || nameTooLong) ? true : undefined}
                  onChange={event => patchDraft({ name: event.target.value })}
                />
                {attempted && (nameMissing || nameTooLong) && (
                  <span className="field-error">
                    {nameMissing ? '레시피 이름을 입력해 주세요.' : `이름은 ${MAX_NAME}자 이하여야 합니다.`}
                  </span>
                )}
              </label>

              <label className="field field-full">
                <span className="field-label">설명 (선택)</span>
                <textarea
                  className="field-input"
                  value={draft.description}
                  aria-invalid={attempted && descriptionTooLong ? true : undefined}
                  onChange={event => patchDraft({ description: event.target.value })}
                />
                {attempted && descriptionTooLong && (
                  <span className="field-error">설명은 {MAX_DESCRIPTION}자 이하여야 합니다.</span>
                )}
              </label>

              <label className="field">
                <span className="field-label">원두량 (g)</span>
                <input
                  className="field-input"
                  type="number"
                  inputMode="decimal"
                  min={MIN_COFFEE}
                  max={MAX_COFFEE}
                  step="0.1"
                  value={draft.coffee}
                  aria-invalid={attempted && coffeeInvalid ? true : undefined}
                  onChange={event => patchDraft({ coffee: event.target.value })}
                />
                {attempted && coffeeInvalid && (
                  <span className="field-error">{MIN_COFFEE}~{MAX_COFFEE}g 사이 숫자를 입력해 주세요.</span>
                )}
              </label>

              <label className="field">
                <span className="field-label">물 온도 (℃)</span>
                <input
                  className="field-input"
                  type="number"
                  inputMode="decimal"
                  min={MIN_TEMPERATURE}
                  max={MAX_TEMPERATURE}
                  step="1"
                  value={draft.temperature}
                  aria-invalid={attempted && temperatureInvalid ? true : undefined}
                  onChange={event => patchDraft({ temperature: event.target.value })}
                />
                {attempted && temperatureInvalid && (
                  <span className="field-error">{MIN_TEMPERATURE}~{MAX_TEMPERATURE}℃ 사이 숫자를 입력해 주세요.</span>
                )}
              </label>

              <label className="field">
                <span className="field-label">분쇄도</span>
                <input
                  className="field-input"
                  value={draft.grind}
                  aria-invalid={attempted && (grindMissing || grindTooLong) ? true : undefined}
                  onChange={event => patchDraft({ grind: event.target.value })}
                />
                {attempted && (grindMissing || grindTooLong) && (
                  <span className="field-error">
                    {grindMissing ? '분쇄도를 입력해 주세요.' : `분쇄도는 ${MAX_TEXT}자 이하여야 합니다.`}
                  </span>
                )}
              </label>

              <label className="field">
                <span className="field-label">드리퍼</span>
                <input
                  className="field-input"
                  value={draft.dripper}
                  aria-invalid={attempted && (dripperMissing || dripperTooLong) ? true : undefined}
                  onChange={event => patchDraft({ dripper: event.target.value })}
                />
                {attempted && (dripperMissing || dripperTooLong) && (
                  <span className="field-error">
                    {dripperMissing ? '드리퍼를 입력해 주세요.' : `드리퍼는 ${MAX_TEXT}자 이하여야 합니다.`}
                  </span>
                )}
              </label>
            </div>

            <div className="field">
              <span className="field-label">원두량에 맞춰 물량 조정</span>
              <div className="editor-scale-row">
                <input
                  className="field-input"
                  type="number"
                  inputMode="decimal"
                  min={MIN_COFFEE}
                  max={MAX_COFFEE}
                  step="0.1"
                  value={scaleTarget}
                  placeholder={Number.isFinite(coffee) ? `현재 ${numberText(coffee)}g` : '목표 원두량'}
                  aria-label="조정할 원두량 (g)"
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyScale();
                    }
                  }}
                  onChange={event => {
                    setScaleTarget(event.target.value);
                    setScaleNotice('');
                    setScaleFailed(false);
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={applyScale}>
                  <Scale size={15} aria-hidden="true" /> 원두량에 맞춰 물량 조정
                </button>
              </div>
              <span
                className={scaleFailed ? 'field-error' : 'field-hint'}
                role={scaleNotice ? (scaleFailed ? 'alert' : 'status') : undefined}
              >
                {scaleNotice || '원두량을 바꾸면 같은 비율을 유지하도록 모든 물 붓기 단계의 추가 물량을 다시 계산합니다.'}
              </span>
            </div>

            <div className="editor-steps-header">
              <h3 id="editor-steps-heading">단계</h3>
              <span className="field-hint" aria-live="polite">{steps.length} / {MAX_STEPS}단계</span>
              <button
                type="button"
                className="btn btn-secondary editor-add"
                onClick={addStep}
                disabled={steps.length >= MAX_STEPS}
              >
                <Plus size={15} aria-hidden="true" /> 단계 추가
              </button>
            </div>

            <ol className="editor-steps" aria-labelledby="editor-steps-heading">
              {steps.map((step, index) => {
                const issues = stepIssues(step);
                const flagged = attempted && badStepIds.has(step.id);
                return (
                  <li className="editor-step" key={step.id}>
                    <div className="editor-step-head">
                      <span className="editor-step-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="editor-step-time">
                        {formatTime(schedule[index]?.start ?? 0)} – {formatTime(schedule[index]?.end ?? 0)}
                      </span>
                      <div className="editor-step-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => moveStep(step.id, -1)}
                          disabled={index === 0}
                          aria-label={`${index + 1}번째 단계 위로 이동`}
                        >
                          <ArrowUp size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => moveStep(step.id, 1)}
                          disabled={index === steps.length - 1}
                          aria-label={`${index + 1}번째 단계 아래로 이동`}
                        >
                          <ArrowDown size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => {
                            setSaveError('');
                            setScaleNotice('');
                            setScaleFailed(false);
                            setSteps(previous => previous.filter(item => item.id !== step.id));
                          }}
                          aria-label={`${index + 1}번째 단계 삭제`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="editor-step-fields">
                      <label className="field">
                        <span className="field-label">단계 이름</span>
                        <input
                          className="field-input"
                          value={step.title}
                          aria-invalid={flagged && issues.title ? true : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, title: value }));
                          }}
                        />
                        {flagged && issues.title && (
                          <span className="field-error">
                            {step.title.trim() ? `이름은 ${MAX_TEXT}자 이하여야 합니다.` : '단계 이름을 입력해 주세요.'}
                          </span>
                        )}
                      </label>
                      <label className="field">
                        <span className="field-label">동작</span>
                        <select
                          className="field-input"
                          value={step.action}
                          onChange={event => {
                            const action = event.target.value as StepAction;
                            updateStep(step.id, item => ({
                              ...item,
                              action,
                              water: action === 'pour' ? item.water : '0',
                              flowRate: action === 'pour' ? item.flowRate : '',
                            }));
                          }}
                        >
                          {ACTIONS.map(action => (
                            <option key={action} value={action}>{ACTION_LABELS[action]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">시간 (초)</span>
                        <input
                          className="field-input"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_DURATION}
                          step="1"
                          value={step.duration}
                          aria-invalid={flagged && issues.duration ? true : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, duration: value }));
                          }}
                        />
                        {flagged && issues.duration && (
                          <span className="field-error">1~{MAX_DURATION}초 정수로 입력해 주세요.</span>
                        )}
                      </label>
                      <label className="field">
                        <span className="field-label">추가 물량 (g)</span>
                        <input
                          className="field-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={MAX_WATER}
                          step="0.1"
                          value={step.action === 'pour' ? step.water : '0'}
                          disabled={step.action !== 'pour'}
                          aria-invalid={flagged && issues.water ? true : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, water: value }));
                          }}
                        />
                        {flagged && issues.water && (
                          <span className="field-error">0~{MAX_WATER}g 사이 숫자를 입력해 주세요.</span>
                        )}
                      </label>
                      <label className="field">
                        <span className="field-label">유량 (g/s)</span>
                        <input
                          className="field-input"
                          type="number"
                          inputMode="decimal"
                          min={MIN_FLOW_RATE}
                          max={MAX_FLOW_RATE}
                          step="0.1"
                          value={step.action === 'pour' ? step.flowRate : ''}
                          disabled={step.action !== 'pour'}
                          placeholder={
                            step.action === 'pour'
                              ? `자동 ${effectiveFlowRate(step) > 0 ? effectiveFlowRate(step).toFixed(2) : '-'}`
                              : '붓기 단계만'
                          }
                          aria-label={`${index + 1}번째 단계 유량 (초당 그램)`}
                          aria-invalid={flagged && issues.flowRate ? true : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, flowRate: value }));
                          }}
                        />
                        {flagged && issues.flowRate ? (
                          <span className="field-error">
                            {(() => {
                              const explicit = draftFlowRate(step);
                              const rate = effectiveFlowRate(step);
                              if (explicit !== null && (explicit < MIN_FLOW_RATE || explicit > MAX_FLOW_RATE)) {
                                return `${MIN_FLOW_RATE}~${MAX_FLOW_RATE}g/s 사이로 입력해 주세요.`;
                              }
                              const water = toNumber(step.water);
                              return `${rate.toFixed(2)}g/s로는 최소 ${Math.ceil(water / rate)}초가 필요합니다.`;
                            })()}
                          </span>
                        ) : (
                          <span className="field-hint">
                            {step.action === 'pour'
                              ? '비우면 물량÷시간으로 자동 계산'
                              : '붓기 단계에서만 설정'}
                          </span>
                        )}
                      </label>
                      <label className="field editor-step-note">
                        <span className="field-label">메모 (선택)</span>
                        <input
                          className="field-input"
                          value={step.note}
                          aria-invalid={flagged && issues.note ? true : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, note: value }));
                          }}
                        />
                        {flagged && issues.note && (
                          <span className="field-error">메모는 {MAX_NOTE}자 이하여야 합니다.</span>
                        )}
                      </label>
                    </div>
                  </li>
                );
              })}
            </ol>

            <section className="editor-summary" aria-label="계산된 추출 요약">
              <div className="summary-stats">
                <span>총 물량 <strong>{water}g</strong></span>
                <span>총 시간 <strong>{formatTime(duration)}</strong></span>
                <span>원두 : 물 <strong>1 : {ratio ? ratio.toFixed(1) : '-'}</strong></span>
              </div>
              <div className="summary-timeline">
                {schedule.map(entry => (
                  <span className="timeline-row" key={entry.step.id}>
                    {formatTime(entry.start)} {entry.step.title}
                    {entry.step.action === 'pour'
                      ? ` +${entry.step.water}g · ${entry.flowRate.toFixed(2)}g/s`
                      : ''}
                  </span>
                ))}
              </div>
            </section>
          </form>
        </div>

        <footer className="editor-footer">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>
            취소
          </button>
          <button type="submit" form="recipe-editor-form" className="btn btn-primary">
            레시피 저장
          </button>
        </footer>
      </div>
    </dialog>
  );
}
