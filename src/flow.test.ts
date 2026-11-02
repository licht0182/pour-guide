import { describe, expect, it } from 'vitest';
import type { Recipe, RecipeStep } from './types';
import { getStepFlowRate, parseRecipe, scaleRecipe, validateRecipe } from './recipe';
import { getTimerSnapshot } from './timer';

function step(id: string, overrides: Partial<RecipeStep> = {}): RecipeStep {
  return {
    id,
    title: `단계 ${id}`,
    action: 'pour',
    duration: 10,
    water: 20,
    flowRate: null,
    note: '',
    ...overrides,
  };
}

function recipe(steps: RecipeStep[]): Recipe {
  return {
    id: 'flow',
    name: '유량 레시피',
    description: '',
    coffee: 15,
    temperature: 92,
    grind: '중간',
    dripper: 'V60',
    steps,
  };
}

describe('step flow rate', () => {
  it('defaults to water / duration and reports zero while not pouring', () => {
    expect(getStepFlowRate(step('a', { duration: 10, water: 20 }))).toBe(2);
    expect(getStepFlowRate(step('a', { duration: 8, water: 40, flowRate: 9 }))).toBe(9);
    expect(getStepFlowRate(step('a', { action: 'wait', water: 0 }))).toBe(0);
    expect(getStepFlowRate(step('a', { action: 'swirl', water: 0, flowRate: 4 }))).toBe(0);
  });

  it('rejects a configured rate that cannot finish inside the step', () => {
    const tooSlow = recipe([step('a', { duration: 10, water: 40, flowRate: 2 })]);
    expect(() => validateRecipe(tooSlow)).toThrow(/최소 20초/);

    const outOfRange = recipe([step('a', { duration: 10, water: 40, flowRate: 0.05 })]);
    expect(() => validateRecipe(outOfRange)).toThrow(/유량/);

    const justEnough = recipe([step('a', { duration: 10, water: 40, flowRate: 4 })]);
    expect(() => validateRecipe(justEnough)).not.toThrow();
  });

  it('keeps legacy JSON without a flow field on automatic mode', () => {
    const legacy = recipe([step('a', { duration: 10, water: 20 })]);
    const raw = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown> & { steps: Record<string, unknown>[] };
    delete raw.steps[0].flowRate;
    const parsed = parseRecipe(JSON.stringify(raw));

    expect(parsed.steps[0].flowRate).toBeNull();
    expect(getStepFlowRate(parsed.steps[0])).toBe(2);
  });

  it('scales a configured rate with the dose so the step timing holds', () => {
    const source = recipe([step('a', { duration: 10, water: 100, flowRate: 10 })]);
    const scaled = scaleRecipe(source, 30);

    expect(scaled.steps[0].water).toBe(200);
    expect(scaled.steps[0].flowRate).toBe(20);
    // The scaled rate still finishes the scaled water inside the same duration.
    expect(scaled.steps[0].water / (scaled.steps[0].flowRate ?? 1)).toBe(source.steps[0].water / (source.steps[0].flowRate ?? 1));
  });
});

describe('flow-driven snapshot', () => {
  it('reports the rate and grows the live target at that rate', () => {
    const source = recipe([step('a', { duration: 10, water: 40, flowRate: 5 })]);
    const atFour = getTimerSnapshot(source, 4_000);

    expect(atFour.flowRate).toBe(5);
    expect(atFour.targetWater).toBe(20);
    expect(atFour.waterAfter).toBe(40);
    expect(atFour.waterBefore).toBe(0);
    expect(getTimerSnapshot(source, 8_000).targetWater).toBe(40);
  });

  it('keeps the previous cumulative amount when the next step does not pour', () => {
    const source = recipe([
      step('a', { duration: 4, water: 20, flowRate: 5 }),
      step('b', { action: 'wait', duration: 2, water: 0 }),
    ]);
    const paused = getTimerSnapshot(source, 5_000);

    expect(paused.stepIndex).toBe(1);
    expect(paused.waterBefore).toBe(20);
    expect(paused.targetWater).toBe(20);
    expect(paused.flowRate).toBe(0);
  });

  it('caps a too-fast configured rate at the step total for the remaining time', () => {
    const source = recipe([step('a', { duration: 10, water: 10, flowRate: 2 })]);
    expect(getTimerSnapshot(source, 3_000).targetWater).toBe(6);
    expect(getTimerSnapshot(source, 5_000).targetWater).toBe(10);
    expect(getTimerSnapshot(source, 9_000).targetWater).toBe(10);
  });
});
