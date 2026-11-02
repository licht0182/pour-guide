import type { Recipe, RecipeStep, StepAction } from './types';

export const ACTION_LABELS: Record<StepAction, string> = {
  pour: '물 붓기',
  wait: '기다리기',
  swirl: '스월링',
  stir: '스티어링',
};

const ACTIONS: readonly string[] = ['pour', 'wait', 'swirl', 'stir'];
const MAX_STEPS = 100;
const MAX_TEXT = 80;
const MAX_DESCRIPTION = 400;
const MAX_NOTE = 300;
const MAX_COFFEE = 500;
const MAX_TEMPERATURE = 100;
const MIN_TEMPERATURE = 1;
const MAX_STEP_DURATION = 1800;
const MAX_STEP_WATER = 2000;

export interface StepScheduleEntry {
  step: RecipeStep;
  start: number;
  end: number;
  waterBefore: number;
  waterAfter: number;
}

export function roundWater(value: number): number {
  return Math.round(value * 10) / 10;
}

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} 형식이 올바르지 않습니다.`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${label}은(는) 문자열이어야 합니다.`);
  if (!allowEmpty && !value.trim()) fail(`${label}을(를) 입력해 주세요.`);
  if (value.length > maxLength) fail(`${label}은(는) ${maxLength}자 이하여야 합니다.`);
  return value;
}

function requireNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label}은(는) 유효한 숫자여야 합니다.`);
  }
  if (value < min || value > max) {
    fail(`${label}은(는) ${min} 이상 ${max} 이하여야 합니다.`);
  }
  return value;
}

function validateStep(value: unknown, index: number, seenIds: Set<string>): RecipeStep {
  const label = `${index + 1}번째 단계`;
  const record = asRecord(value, label);
  const id = requireText(record.id, `${label} ID`, MAX_TEXT);
  if (seenIds.has(id)) fail(`단계 ID가 중복되었습니다: ${id}`);
  seenIds.add(id);
  const title = requireText(record.title, `${label} 이름`, MAX_TEXT);
  const action = record.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action)) {
    fail(`${label}의 동작을 알 수 없습니다: ${String(action)}`);
  }
  const duration = requireNumber(record.duration, `${label} 시간`, 1, MAX_STEP_DURATION);
  if (!Number.isInteger(duration)) fail(`${label} 시간은 정수 초여야 합니다.`);
  const water = requireNumber(record.water, `${label} 물량`, 0, MAX_STEP_WATER);
  if (action !== 'pour' && water !== 0) {
    fail(`${label}: 물 붓기 단계가 아니면 물량은 0이어야 합니다.`);
  }
  const note = requireText(record.note, `${label} 메모`, MAX_NOTE, true);
  return { id, title, action: action as StepAction, duration, water, note };
}

export function validateRecipe(value: unknown): Recipe {
  const record = asRecord(value, '레시피');
  const id = requireText(record.id, '레시피 ID', MAX_TEXT);
  const name = requireText(record.name, '레시피 이름', MAX_TEXT);
  const description = requireText(record.description, '레시피 설명', MAX_DESCRIPTION, true);
  const coffee = requireNumber(record.coffee, '원두량', 0.1, MAX_COFFEE);
  const temperature = requireNumber(record.temperature, '물 온도', MIN_TEMPERATURE, MAX_TEMPERATURE);
  const grind = requireText(record.grind, '분쇄도', MAX_TEXT);
  const dripper = requireText(record.dripper, '드리퍼', MAX_TEXT);
  if (!Array.isArray(record.steps)) fail('단계 목록이 필요합니다.');
  if (record.steps.length === 0) fail('단계는 1개 이상이어야 합니다.');
  if (record.steps.length > MAX_STEPS) fail(`단계는 1개 이상 ${MAX_STEPS}개 이하여야 합니다.`);
  const seenIds = new Set<string>();
  const steps = record.steps.map((step, index) => validateStep(step, index, seenIds));
  return { id, name, description, coffee, temperature, grind, dripper, steps };
}

export function parseRecipe(json: string): Recipe {
  if (typeof json !== 'string' || !json.trim()) fail('가져올 레시피 JSON이 비어 있습니다.');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    fail('JSON 형식이 올바르지 않습니다.');
  }
  return validateRecipe(value);
}

export function scaleRecipe(recipe: Recipe, coffee: number): Recipe {
  if (typeof coffee !== 'number' || !Number.isFinite(coffee) || coffee <= 0 || coffee > MAX_COFFEE) {
    fail(`원두량은 0보다 크고 ${MAX_COFFEE}g 이하여야 합니다.`);
  }
  const ratio = coffee / recipe.coffee;
  return {
    ...recipe,
    coffee,
    steps: recipe.steps.map(step => ({
      ...step,
      water: step.action === 'pour' ? roundWater(step.water * ratio) : 0,
    })),
  };
}

export function totalWater(recipe: Recipe): number {
  let total = 0;
  for (const step of recipe.steps) {
    if (step.action === 'pour') total += step.water;
  }
  return roundWater(total);
}

export function totalDuration(recipe: Recipe): number {
  let total = 0;
  for (const step of recipe.steps) total += step.duration;
  return total;
}

export function formatTime(seconds: number): string {
  const safe = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function getStepSchedule(recipe: Recipe): StepScheduleEntry[] {
  let start = 0;
  let water = 0;
  return recipe.steps.map(step => {
    const end = start + step.duration;
    const waterBefore = water;
    const waterAfter = roundWater(waterBefore + (step.action === 'pour' ? step.water : 0));
    water = waterAfter;
    const entry: StepScheduleEntry = { step, start, end, waterBefore, waterAfter };
    start = end;
    return entry;
  });
}

export const PRESETS: Recipe[] = [
  {
    id: 'preset-daily-v60',
    name: '데일리 V60',
    description: '매일 아침 부담 없이 내리는 기본 푸어오버입니다. 20g 원두로 300g의 커피를 추출합니다.',
    coffee: 20,
    temperature: 93,
    grind: '중간보다 약간 가늘게',
    dripper: 'V60 02',
    steps: [
      { id: 'daily-1', title: '블룸', action: 'pour', duration: 15, water: 60, note: '원두 전체를 적시고 60g까지 부어 주세요.' },
      { id: 'daily-2', title: '가볍게 스월', action: 'swirl', duration: 5, water: 0, note: '드리퍼를 작게 흔들어 원두층을 고르게 펴 주세요.' },
      { id: 'daily-3', title: '블룸 대기', action: 'wait', duration: 25, water: 0, note: '가스가 빠져나가도록 기다립니다.' },
      { id: 'daily-4', title: '첫 번째 푸어', action: 'pour', duration: 30, water: 120, note: '중심에서 바깥으로 천천히 180g까지 부어 주세요.' },
      { id: 'daily-5', title: '잠깐 대기', action: 'wait', duration: 15, water: 0, note: '수위가 살짝 내려갈 때까지 기다립니다.' },
      { id: 'daily-6', title: '두 번째 푸어', action: 'pour', duration: 30, water: 120, note: '같은 속도로 300g까지 부어 주세요.' },
      { id: 'daily-7', title: '살짝 젓기', action: 'stir', duration: 5, water: 0, note: '나무 막대로 한두 번만 부드럽게 젓습니다.' },
      { id: 'daily-8', title: '드로다운', action: 'wait', duration: 55, water: 0, note: '물이 다 빠질 때까지 기다린 뒤 서버를 흔들어 주세요.' },
    ],
  },
  {
    id: 'preset-evening-v60',
    name: '저녁의 부드러운 V60',
    description: '늦은 오후에 마시기 좋게 낮은 온도와 느린 푸어로 단맛을 살린 레시피입니다.',
    coffee: 15,
    temperature: 91,
    grind: '중간',
    dripper: 'V60 01',
    steps: [
      { id: 'evening-1', title: '블룸', action: 'pour', duration: 30, water: 45, note: '45g까지 부은 뒤 원두가 고르게 젖도록 해 주세요.' },
      { id: 'evening-2', title: '스월', action: 'swirl', duration: 5, water: 0, note: '드리퍼를 한 바퀴 부드럽게 돌립니다.' },
      { id: 'evening-3', title: '블룸 대기', action: 'wait', duration: 20, water: 0, note: '표면의 기포가 잦아들 때까지 기다립니다.' },
      { id: 'evening-4', title: '첫 번째 푸어', action: 'pour', duration: 30, water: 100, note: '145g까지 가는 물줄기로 부어 주세요.' },
      { id: 'evening-5', title: '잠깐 대기', action: 'wait', duration: 10, water: 0, note: '물이 절반쯤 빠지면 다음 푸어를 시작합니다.' },
      { id: 'evening-6', title: '두 번째 푸어', action: 'pour', duration: 25, water: 95, note: '240g까지 마무리합니다.' },
      { id: 'evening-7', title: '살짝 젓기', action: 'stir', duration: 5, water: 0, note: '원두층을 한 번만 가볍게 풀어 주세요.' },
      { id: 'evening-8', title: '드로다운', action: 'wait', duration: 25, water: 0, note: '서버에 물방울이 떨어지지 않을 때까지 기다립니다.' },
    ],
  },
  {
    id: 'preset-weekend-strong',
    name: '주말의 진한 푸어오버',
    description: '원두를 넉넉히 쓰고 온도를 높여 진한 바디감을 내는 주말용 레시피입니다.',
    coffee: 22,
    temperature: 94,
    grind: '중간보다 약간 굵게',
    dripper: 'V60 02',
    steps: [
      { id: 'weekend-1', title: '블룸', action: 'pour', duration: 40, water: 66, note: '66g을 부어 원두 전체를 충분히 적셔 주세요.' },
      { id: 'weekend-2', title: '블룸 대기', action: 'wait', duration: 20, water: 0, note: '천천히 가스가 빠져나가도록 둡니다.' },
      { id: 'weekend-3', title: '첫 번째 푸어', action: 'pour', duration: 35, water: 132, note: '198g까지 굵은 물줄기로 부어 주세요.' },
      { id: 'weekend-4', title: '스월', action: 'swirl', duration: 5, water: 0, note: '원두층이 평평해지도록 가볍게 흔듭니다.' },
      { id: 'weekend-5', title: '잠깐 대기', action: 'wait', duration: 15, water: 0, note: '수위가 내려가는 것을 확인합니다.' },
      { id: 'weekend-6', title: '두 번째 푸어', action: 'pour', duration: 35, water: 132, note: '330g까지 천천히 마무리합니다.' },
      { id: 'weekend-7', title: '젓기', action: 'stir', duration: 10, water: 0, note: '나무 막대로 두세 번 저어 추출을 고르게 합니다.' },
      { id: 'weekend-8', title: '드로다운', action: 'wait', duration: 50, water: 0, note: '물이 완전히 빠지면 바로 서버를 들어 주세요.' },
    ],
  },
];
