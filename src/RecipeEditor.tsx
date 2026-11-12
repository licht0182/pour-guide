import { useEffect, useRef, useState } from 'react';
import type { FormEvent, SyntheticEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Scale, Trash2, X } from 'lucide-react';
import type { Recipe, ServeTemperature, StepAction } from './types';
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
  categories: string[];
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
  filter: string;
  category: string;
  categoryMode: 'existing' | 'new';
  newCategory: string;
  serve: ServeTemperature | '';
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
const SERVE_CHOICES: { value: ServeTemperature; label: string }[] = [{ value: 'ice', label: 'ICE' }, { value: 'hot', label: 'HOT' }];
const MAX_STEPS = 100;
const MAX_NAME = 80;
const MAX_CATEGORY = 80;
const CATEGORY_CHOICE_PREFIX = 'category:';
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

/** Category labels are trimmed and internal whitespace collapsed. */
function normalizeCategory(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

/** Stable, attribute-safe DOM id segment derived from a recipe or step id. */
function idSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'item';
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
  if (draft.filter.length > MAX_TEXT) messages.push(`필터는 ${MAX_TEXT}자 이하여야 합니다.`);
  if (draft.categoryMode === 'new') {
    const newCategory = normalizeCategory(draft.newCategory);
    if (!newCategory) messages.push('새 분류 이름을 입력해 주세요.');
    else if (newCategory.length > MAX_CATEGORY) {
      messages.push(`새 분류 이름은 ${MAX_CATEGORY}자 이하여야 합니다.`);
    }
  }

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

function buildRecipe(recipe: Recipe, draft: DraftRecipe, steps: DraftStep[], categories: string[]): Recipe {
  let category = draft.category;
  if (draft.categoryMode === 'new') {
    const normalized = normalizeCategory(draft.newCategory);
    const existing = [recipe.category ?? '', ...categories].find(
      value => value !== '' && normalizeCategory(value) === normalized,
    );
    category = existing ?? normalized;
  }
  return {
    id: recipe.id,
    name: draft.name,
    description: draft.description,
    coffee: toNumber(draft.coffee),
    temperature: toNumber(draft.temperature),
    grind: draft.grind,
    dripper: draft.dripper,
    filter: draft.filter,
    ...(category ? { category } : {}),
    ...(draft.serve ? { serve: draft.serve } : {}),
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

export default function RecipeEditor({ recipe, categories, onSave, onCancel }: RecipeEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const editorId = idSegment(recipe.id);
  const [draft, setDraft] = useState<DraftRecipe>(() => ({
    name: recipe.name,
    description: recipe.description,
    coffee: numberText(recipe.coffee),
    temperature: numberText(recipe.temperature),
    grind: recipe.grind,
    dripper: recipe.dripper,
    filter: recipe.filter ?? '',
    category: recipe.category ?? '',
    categoryMode: 'existing',
    newCategory: '',
    serve: recipe.serve ?? '',
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
    const captured = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!returnFocusRef.current && captured && captured !== document.body && !dialog.contains(captured)) {
      returnFocusRef.current = captured;
    }
    if (!dialog.open) dialog.showModal();
    nameRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const target = returnFocusRef.current;
      if (!target || !target.isConnected) return;
      const focused = document.activeElement;
      if (!focused || focused === document.body || focused === dialog || dialog.contains(focused)) {
        target.focus();
      }
    };
  }, []);

  const current = buildRecipe(recipe, draft, steps, categories);
  const { messages, badStepIds } = collectMessages(draft, steps);
  const newCategoryName = normalizeCategory(draft.newCategory);
  const categoryMissing = draft.categoryMode === 'new' && !newCategoryName;
  const categoryTooLong = draft.categoryMode === 'new' && newCategoryName.length > MAX_CATEGORY;
  const categoryChoices = [
    ...new Set([
      ...(recipe.category ? [recipe.category] : []),
      ...categories.filter(category => category !== ''),
    ]),
  ];
  const categoryChoiceIndex = categoryChoices.indexOf(draft.category);
  const categorySelectValue = draft.categoryMode === 'new'
    ? 'new'
    : categoryChoiceIndex >= 0
      ? `${CATEGORY_CHOICE_PREFIX}${categoryChoiceIndex}`
      : 'none';
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
  const filterTooLong = draft.filter.length > MAX_TEXT;
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
              각 단계의 물량은 그 단계에서 추가로 붓는 양이며, 시작 시간은 앞 단계에서 자동으로
              이어집니다. 유량을 비워 두면 물량과 시간으로 자동 계산합니다.
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

            <section aria-labelledby={`${editorId}-details-heading`}>
              <div className="editor-fields">
                <h3 id={`${editorId}-details-heading`} className="editor-section-title field-full">
                  레시피 정보
                </h3>
                <div className="field field-full">
                  <label className="field-label" htmlFor={`${editorId}-name`}>레시피 이름</label>
                  <input
                    ref={nameRef}
                    id={`${editorId}-name`}
                    className="field-input"
                    value={draft.name}
                    aria-invalid={attempted && (nameMissing || nameTooLong) ? true : undefined}
                    aria-describedby={
                      attempted && (nameMissing || nameTooLong) ? `${editorId}-name-error` : undefined
                    }
                    onChange={event => patchDraft({ name: event.target.value })}
                  />
                  {attempted && (nameMissing || nameTooLong) && (
                    <span id={`${editorId}-name-error`} className="field-error">
                      {nameMissing ? '레시피 이름을 입력해 주세요.' : `이름은 ${MAX_NAME}자 이하여야 합니다.`}
                    </span>
                  )}
                </div>

                <div className="field field-full">
                  <label className="field-label" htmlFor={`${editorId}-description`}>설명 (선택)</label>
                  <textarea
                    id={`${editorId}-description`}
                    className="field-input"
                    value={draft.description}
                    aria-invalid={attempted && descriptionTooLong ? true : undefined}
                    aria-describedby={
                      attempted && descriptionTooLong ? `${editorId}-description-error` : undefined
                    }
                    onChange={event => patchDraft({ description: event.target.value })}
                  />
                  {attempted && descriptionTooLong && (
                    <span id={`${editorId}-description-error`} className="field-error">
                      설명은 {MAX_DESCRIPTION}자 이하여야 합니다.
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor={`${editorId}-coffee`}>원두량 (g)</label>
                  <input
                    id={`${editorId}-coffee`}
                    className="field-input"
                    type="number"
                    inputMode="decimal"
                    min={MIN_COFFEE}
                    max={MAX_COFFEE}
                    step="0.1"
                    value={draft.coffee}
                    aria-invalid={attempted && coffeeInvalid ? true : undefined}
                    aria-describedby={attempted && coffeeInvalid ? `${editorId}-coffee-error` : undefined}
                    onChange={event => patchDraft({ coffee: event.target.value })}
                  />
                  {attempted && coffeeInvalid && (
                    <span id={`${editorId}-coffee-error`} className="field-error">
                      {MIN_COFFEE}~{MAX_COFFEE}g 사이 숫자를 입력해 주세요.
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor={`${editorId}-temperature`}>물 온도 (℃)</label>
                  <input
                    id={`${editorId}-temperature`}
                    className="field-input"
                    type="number"
                    inputMode="decimal"
                    min={MIN_TEMPERATURE}
                    max={MAX_TEMPERATURE}
                    step="1"
                    value={draft.temperature}
                    aria-invalid={attempted && temperatureInvalid ? true : undefined}
                    aria-describedby={
                      attempted && temperatureInvalid ? `${editorId}-temperature-error` : undefined
                    }
                    onChange={event => patchDraft({ temperature: event.target.value })}
                  />
                  {attempted && temperatureInvalid && (
                    <span id={`${editorId}-temperature-error`} className="field-error">
                      {MIN_TEMPERATURE}~{MAX_TEMPERATURE}℃ 사이 숫자를 입력해 주세요.
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor={`${editorId}-grind`}>분쇄도</label>
                  <input
                    id={`${editorId}-grind`}
                    className="field-input"
                    value={draft.grind}
                    aria-invalid={attempted && (grindMissing || grindTooLong) ? true : undefined}
                    aria-describedby={
                      attempted && (grindMissing || grindTooLong) ? `${editorId}-grind-error` : undefined
                    }
                    onChange={event => patchDraft({ grind: event.target.value })}
                  />
                  {attempted && (grindMissing || grindTooLong) && (
                    <span id={`${editorId}-grind-error`} className="field-error">
                      {grindMissing ? '분쇄도를 입력해 주세요.' : `분쇄도는 ${MAX_TEXT}자 이하여야 합니다.`}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor={`${editorId}-dripper`}>드리퍼</label>
                  <input
                    id={`${editorId}-dripper`}
                    className="field-input"
                    value={draft.dripper}
                    aria-invalid={attempted && (dripperMissing || dripperTooLong) ? true : undefined}
                    aria-describedby={
                      attempted && (dripperMissing || dripperTooLong) ? `${editorId}-dripper-error` : undefined
                    }
                    onChange={event => patchDraft({ dripper: event.target.value })}
                  />
                  {attempted && (dripperMissing || dripperTooLong) && (
                    <span id={`${editorId}-dripper-error`} className="field-error">
                      {dripperMissing ? '드리퍼를 입력해 주세요.' : `드리퍼는 ${MAX_TEXT}자 이하여야 합니다.`}
                    </span>
                  )}
                </div>

                <div className="field field-full">
                  <label className="field-label" htmlFor={`${editorId}-filter`}>필터 (선택)</label>
                  <input
                    id={`${editorId}-filter`}
                    className="field-input"
                    value={draft.filter}
                    placeholder="예: 하리오 V60 종이 필터"
                    aria-invalid={attempted && filterTooLong ? true : undefined}
                    aria-describedby={attempted && filterTooLong ? `${editorId}-filter-error` : undefined}
                    onChange={event => patchDraft({ filter: event.target.value })}
                  />
                  {attempted && filterTooLong && (
                    <span id={`${editorId}-filter-error`} className="field-error">
                      필터는 {MAX_TEXT}자 이하여야 합니다.
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor={`${editorId}-category`}>분류</label>
                  <select
                    id={`${editorId}-category`}
                    className="field-input"
                    value={categorySelectValue}
                    aria-describedby={`${editorId}-category-hint`}
                    onChange={event => {
                      const value = event.target.value;
                      if (value === 'new') {
                        patchDraft({ categoryMode: 'new' });
                      } else if (value === 'none') {
                        patchDraft({ category: '', categoryMode: 'existing', newCategory: '' });
                      } else {
                        const name = categoryChoices[Number(value.slice(CATEGORY_CHOICE_PREFIX.length))];
                        if (name !== undefined) {
                          patchDraft({ category: name, categoryMode: 'existing', newCategory: '' });
                        }
                      }
                    }}
                  >
                    <option value="none">미분류</option>
                    {categoryChoices.map((category, index) => (
                      <option key={category} value={`${CATEGORY_CHOICE_PREFIX}${index}`}>
                        {category}
                      </option>
                    ))}
                    <option value="new">새 분류 만들기</option>
                  </select>
                  <span id={`${editorId}-category-hint`} className="field-hint">
                    목록에 없으면 새 분류 만들기를 선택하세요.
                  </span>
                </div>

                <div className="field">
                  <span className="field-label" id={`${editorId}-serve-label`}>ICE / HOT</span>
                  <div className="serve-choice" role="radiogroup" aria-labelledby={`${editorId}-serve-label`}>
                    {SERVE_CHOICES.map(choice => (
                      <label
                        key={choice.value}
                        className={`category-chip serve-chip${draft.serve === choice.value ? ' is-active' : ''}`}
                      >
                        <input
                          className="serve-choice-input"
                          type="radio"
                          name={`${editorId}-serve`}
                          value={choice.value}
                          checked={draft.serve === choice.value}
                          onChange={() => patchDraft({ serve: choice.value })}
                        />
                        {choice.label}
                      </label>
                    ))}
                  </div>
                </div>

                {draft.categoryMode === 'new' && (
                  <div className="field">
                    <label className="field-label" htmlFor={`${editorId}-new-category`}>새 분류 이름</label>
                    <input
                      id={`${editorId}-new-category`}
                      className="field-input"
                      value={draft.newCategory}
                      placeholder="예: 아이스"
                      aria-invalid={attempted && (categoryMissing || categoryTooLong) ? true : undefined}
                      aria-describedby={
                        attempted && (categoryMissing || categoryTooLong)
                          ? `${editorId}-category-error`
                          : `${editorId}-new-category-hint`
                      }
                      onChange={event => patchDraft({ newCategory: event.target.value })}
                    />
                    {attempted && (categoryMissing || categoryTooLong) ? (
                      <span id={`${editorId}-category-error`} className="field-error">
                        {categoryMissing
                          ? '새 분류 이름을 입력해 주세요.'
                          : `새 분류 이름은 ${MAX_CATEGORY}자 이하여야 합니다.`}
                      </span>
                    ) : (
                      <span id={`${editorId}-new-category-hint`} className="field-hint">
                        같은 이름의 분류가 있으면 기존 분류를 사용합니다.
                      </span>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section aria-labelledby={`${editorId}-scale-heading`}>
              <div className="editor-fields">
                <h3 id={`${editorId}-scale-heading`} className="editor-section-title field-full">
                  비율 조정
                </h3>
                <div className="field field-full">
                  <label className="field-label" htmlFor={`${editorId}-scale-target`}>
                    조정할 원두량 (g)
                  </label>
                  <div className="editor-scale-row">
                    <input
                      id={`${editorId}-scale-target`}
                      className="field-input"
                      type="number"
                      inputMode="decimal"
                      min={MIN_COFFEE}
                      max={MAX_COFFEE}
                      step="0.1"
                      value={scaleTarget}
                      placeholder={Number.isFinite(coffee) ? `현재 ${numberText(coffee)}g` : '목표 원두량'}
                      aria-describedby={`${editorId}-scale-hint`}
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
                    id={`${editorId}-scale-hint`}
                    className={scaleFailed ? 'field-error' : 'field-hint'}
                    role={scaleNotice ? (scaleFailed ? 'alert' : 'status') : undefined}
                  >
                    {scaleNotice
                      || '같은 비율을 유지하도록 모든 물 붓기 단계의 추가 물량과 지정한 유량을 함께 다시 계산합니다. 유량을 비워 둔 단계는 물량÷시간으로 자동 계산됩니다.'}
                  </span>
                </div>
              </div>
            </section>

            <div className="editor-steps-header">
              <h3 id="editor-steps-heading" className="editor-section-title">단계</h3>
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
                const fieldId = `${editorId}-step-${index + 1}-${idSegment(step.id)}`;
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
                      <div className="field">
                        <label className="field-label" htmlFor={`${fieldId}-title`}>단계 이름</label>
                        <input
                          id={`${fieldId}-title`}
                          className="field-input"
                          value={step.title}
                          aria-invalid={flagged && issues.title ? true : undefined}
                          aria-describedby={flagged && issues.title ? `${fieldId}-title-error` : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, title: value }));
                          }}
                        />
                        {flagged && issues.title && (
                          <span id={`${fieldId}-title-error`} className="field-error">
                            {step.title.trim() ? `이름은 ${MAX_TEXT}자 이하여야 합니다.` : '단계 이름을 입력해 주세요.'}
                          </span>
                        )}
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor={`${fieldId}-action`}>동작</label>
                        <select
                          id={`${fieldId}-action`}
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
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor={`${fieldId}-duration`}>시간 (초)</label>
                        <input
                          id={`${fieldId}-duration`}
                          className="field-input"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_DURATION}
                          step="1"
                          value={step.duration}
                          aria-invalid={flagged && issues.duration ? true : undefined}
                          aria-describedby={flagged && issues.duration ? `${fieldId}-duration-error` : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, duration: value }));
                          }}
                        />
                        {flagged && issues.duration && (
                          <span id={`${fieldId}-duration-error`} className="field-error">
                            1~{MAX_DURATION}초 정수로 입력해 주세요.
                          </span>
                        )}
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor={`${fieldId}-water`}>추가 물량 (g)</label>
                        <input
                          id={`${fieldId}-water`}
                          className="field-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={MAX_WATER}
                          step="0.1"
                          value={step.action === 'pour' ? step.water : '0'}
                          disabled={step.action !== 'pour'}
                          aria-invalid={flagged && issues.water ? true : undefined}
                          aria-describedby={flagged && issues.water ? `${fieldId}-water-error` : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, water: value }));
                          }}
                        />
                        {flagged && issues.water && (
                          <span id={`${fieldId}-water-error`} className="field-error">
                            0~{MAX_WATER}g 사이 숫자를 입력해 주세요.
                          </span>
                        )}
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor={`${fieldId}-flow`}>유량 (g/s)</label>
                        <input
                          id={`${fieldId}-flow`}
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
                          aria-invalid={flagged && issues.flowRate ? true : undefined}
                          aria-describedby={`${fieldId}-flow-hint`}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, flowRate: value }));
                          }}
                        />
                        <span
                          id={`${fieldId}-flow-hint`}
                          className={flagged && issues.flowRate ? 'field-error' : 'field-hint'}
                        >
                          {flagged && issues.flowRate
                            ? (() => {
                                const explicit = draftFlowRate(step);
                                const rate = effectiveFlowRate(step);
                                if (explicit !== null && (explicit < MIN_FLOW_RATE || explicit > MAX_FLOW_RATE)) {
                                  return `${MIN_FLOW_RATE}~${MAX_FLOW_RATE}g/s 사이로 입력해 주세요.`;
                                }
                                const water = toNumber(step.water);
                                return `${rate.toFixed(2)}g/s로는 최소 ${Math.ceil(water / rate)}초가 필요합니다.`;
                              })()
                            : step.action === 'pour'
                              ? `비우면 자동 계산(물량÷시간), 입력하면 입력값을 지정 유량(${MIN_FLOW_RATE}~${MAX_FLOW_RATE}g/s)으로 사용`
                              : '붓기 단계에서만 설정'}
                        </span>
                      </div>
                      <div className="field editor-step-note">
                        <label className="field-label" htmlFor={`${fieldId}-note`}>메모 (선택)</label>
                        <input
                          id={`${fieldId}-note`}
                          className="field-input"
                          value={step.note}
                          aria-invalid={flagged && issues.note ? true : undefined}
                          aria-describedby={flagged && issues.note ? `${fieldId}-note-error` : undefined}
                          onChange={event => {
                            const value = event.target.value;
                            updateStep(step.id, item => ({ ...item, note: value }));
                          }}
                        />
                        {flagged && issues.note && (
                          <span id={`${fieldId}-note-error`} className="field-error">
                            메모는 {MAX_NOTE}자 이하여야 합니다.
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <section className="editor-summary" aria-labelledby="editor-summary-heading">
              <h3 id="editor-summary-heading" className="editor-section-title">추출 요약</h3>
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
