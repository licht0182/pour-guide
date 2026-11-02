import { describe, expect, it } from 'vitest';
import type { Recipe, RecipeStep } from './types';
import {
  formatTime,
  getStepSchedule,
  parseRecipe,
  scaleRecipe,
  totalDuration,
  totalWater,
  validateRecipe,
} from './recipe';

function step(id: string, overrides: Partial<RecipeStep> = {}): RecipeStep {
  return {
    id,
    title: `단계 ${id}`,
    action: 'pour',
    duration: 10,
    water: 20,
    flowRate: null,
    note: `${id} 메모`,
    ...overrides,
  };
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'test-recipe',
    name: '테스트 레시피',
    description: '테스트용 설명',
    coffee: 20,
    temperature: 93,
    grind: '중간',
    dripper: 'V60 02',
    steps: [step('a'), step('b', { action: 'wait', water: 0 })],
    ...overrides,
  };
}

describe('scaleRecipe', () => {
  it('scales pour water to 0.1g precision while keeping notes and untouched fields', () => {
    const source = recipe({
      coffee: 20,
      steps: [
        step('pour-1', { duration: 15, water: 100, note: '첫 푸어' }),
        step('wait-1', { action: 'wait', water: 0, note: '대기' }),
        step('pour-2', { duration: 30, water: 75, note: '두 번째 푸어' }),
      ],
    });
    const scaled = scaleRecipe(source, 13);

    expect(scaled.coffee).toBe(13);
    expect(scaled.steps.map(item => item.water)).toEqual([65, 0, 48.8]);
    expect(scaled.steps.map(item => item.note)).toEqual(['첫 푸어', '대기', '두 번째 푸어']);
    expect(scaled.steps.map(item => item.id)).toEqual(['pour-1', 'wait-1', 'pour-2']);
    expect(scaled.steps.map(item => item.action)).toEqual(['pour', 'wait', 'pour']);
    expect(totalWater(scaled)).toBe(113.8);
    expect(source.coffee).toBe(20);
    expect(source.steps.map(item => item.water)).toEqual([100, 0, 75]);
    expect(scaled).not.toBe(source);
    expect(scaled.steps[0]).not.toBe(source.steps[0]);
  });

  it('rounds non-terminating ratios to one decimal place', () => {
    const source = recipe({
      coffee: 18,
      steps: [step('a', { water: 100 }), step('b', { water: 55 })],
    });
    const scaled = scaleRecipe(source, 11);

    expect(scaled.steps.map(item => item.water)).toEqual([61.1, 33.6]);
    expect(totalWater(scaled)).toBe(94.7);
  });

  it('keeps a scaled recipe valid and unchanged when scaling to the same dose', () => {
    const source = recipe();
    const same = scaleRecipe(source, source.coffee);

    expect(same.steps.map(item => item.water)).toEqual(source.steps.map(item => item.water));
    expect(() => validateRecipe(same)).not.toThrow();
  });
});

describe('validateRecipe', () => {
  it('accepts a valid recipe and returns fresh nested objects without mutating the input', () => {
    const input = recipe();
    const snapshot = JSON.parse(JSON.stringify(input)) as Recipe;
    const validated = validateRecipe(input);

    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
    expect(validated.steps).not.toBe(input.steps);
    expect(validated.steps[0]).not.toBe(input.steps[0]);
    expect(input).toEqual(snapshot);
  });

  it('rejects unknown action and non-pour water together with out-of-range numbers', () => {
    expect(() =>
      validateRecipe({ ...recipe(), steps: [{ ...step('a'), action: 'boil' }] }),
    ).toThrow(/동작/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { action: 'stir', water: 1 })] }),
    ).toThrow(/물량은 0/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { water: Number.POSITIVE_INFINITY })] }),
    ).toThrow(/물량/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { duration: -5 })] }),
    ).toThrow(/시간/);
    expect(() =>
      validateRecipe({ ...recipe(), temperature: 0 }),
    ).toThrow(/온도/);
  });

  it('accepts 100 steps and rejects 101', () => {
    const hundred = recipe({
      steps: Array.from({ length: 100 }, (_, index) => step(`s-${index + 1}`, { duration: 1, water: 1 })),
    });
    expect(() => validateRecipe(hundred)).not.toThrow();

    const tooMany = recipe({
      steps: Array.from({ length: 101 }, (_, index) => step(`s-${index + 1}`, { duration: 1, water: 1 })),
    });
    expect(() => validateRecipe(tooMany)).toThrow(/100개 이하/);
  });

  it('rejects malformed structures with Korean messages', () => {
    expect(() => validateRecipe(null)).toThrow(/레시피/);
    expect(() => validateRecipe([])).toThrow(/레시피/);
    expect(() => validateRecipe('recipe')).toThrow(/레시피/);
    expect(() => validateRecipe(recipe({ name: '   ' }))).toThrow(/이름/);
    expect(() => validateRecipe(recipe({ coffee: 0 }))).toThrow(/원두량/);
    expect(() => validateRecipe(recipe({ coffee: Number.NaN }))).toThrow(/원두량/);
    expect(() => validateRecipe(recipe({ temperature: 100.5 }))).toThrow(/온도/);
    expect(() => validateRecipe(recipe({ steps: [] }))).toThrow(/단계는 1개 이상/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [{ ...step('a'), action: 'shake' }] }),
    ).toThrow(/동작/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a'), step('a')] }),
    ).toThrow(/중복/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { duration: 0 })] }),
    ).toThrow(/시간/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { duration: 1.5 })] }),
    ).toThrow(/정수/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { water: -1 })] }),
    ).toThrow(/물량/);
    expect(() =>
      validateRecipe({ ...recipe(), steps: [step('a', { action: 'wait', water: 5 })] }),
    ).toThrow(/물량은 0/);
  });
});

describe('parseRecipe', () => {
  it('parses valid JSON into a validated copy', () => {
    const input = recipe();
    const parsed = parseRecipe(JSON.stringify(input));

    expect(parsed).toEqual(input);
    expect(parsed.steps[0]).not.toBe(input.steps[0]);
  });

  it('rejects broken JSON and malformed payloads without throwing non-Error values', () => {
    expect(() => parseRecipe('{ "id": ')).toThrow(/JSON/);
    expect(() => parseRecipe('')).toThrow(/비어/);
    expect(() => parseRecipe('null')).toThrow(/레시피/);
    expect(() => parseRecipe(JSON.stringify({ ...recipe(), steps: 'none' }))).toThrow(/단계 목록/);
    try {
      parseRecipe('{ bad');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe('recipe summaries', () => {
  it('totals only pour water and sums durations sequentially', () => {
    const input = recipe({
      steps: [
        step('a', { duration: 15, water: 60 }),
        step('b', { action: 'swirl', duration: 5, water: 0 }),
        step('c', { duration: 30, water: 120 }),
        step('d', { action: 'wait', duration: 55, water: 0 }),
      ],
    });

    expect(totalWater(input)).toBe(180);
    expect(totalDuration(input)).toBe(105);
  });

  it('derives absolute step starts and cumulative water from sequential durations', () => {
    const input = recipe({
      steps: [
        step('a', { duration: 10, water: 100 }),
        step('b', { action: 'wait', duration: 5, water: 0 }),
        step('c', { duration: 15, water: 50 }),
      ],
    });
    const schedule = getStepSchedule(input);

    expect(schedule.map(entry => [entry.start, entry.end, entry.waterBefore, entry.waterAfter])).toEqual([
      [0, 10, 0, 100],
      [10, 15, 100, 100],
      [15, 30, 100, 150],
    ]);
    expect(schedule[1].step).toBe(input.steps[1]);
  });

  it('formats whole seconds as m:ss and clamps unusable values', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(180)).toBe('3:00');
    expect(formatTime(3600)).toBe('60:00');
    expect(formatTime(59.9)).toBe('0:59');
    expect(formatTime(-4)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});
