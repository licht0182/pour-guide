import { describe, expect, it } from 'vitest';
import type { Recipe } from './types';
import { getStepSchedule, parseRecipe, PRESETS, scaleRecipe, totalWater, validateRecipe } from './recipe';
import { getElapsedMs, getTimerSnapshot, initialTimer, pauseTimer, startTimer } from './timer';

const recipe: Recipe = {
  id: 'test',
  name: '테스트',
  description: '',
  coffee: 20,
  temperature: 92,
  grind: '중간',
  dripper: 'V60',
  steps: [
    { id: 'a', title: '블룸', action: 'pour', duration: 30, water: 60, flowRate: null, note: '' },
    { id: 'b', title: '대기', action: 'wait', duration: 15, water: 0, flowRate: null, note: '' },
    { id: 'c', title: '두번째', action: 'pour', duration: 45, water: 120, flowRate: null, note: '' },
    { id: 'd', title: '스월', action: 'swirl', duration: 5, water: 0, flowRate: null, note: '' },
  ],
};

describe('recipe validation', () => {
  it('rejects nonpour water and duplicate step ids', () => {
    expect(() => validateRecipe({
      ...recipe,
      steps: [{ ...recipe.steps[0], action: 'wait' }],
    })).toThrow(/물량/);
    expect(() => validateRecipe({
      ...recipe,
      steps: [recipe.steps[0], { ...recipe.steps[1], id: 'a' }],
    })).toThrow(/중복/);
  });

  it('rejects malformed JSON without inventing defaults', () => {
    expect(() => parseRecipe('{"name":')).toThrow(/JSON/);
    expect(() => parseRecipe('{"id":"x"}')).toThrow(/이름/);
    const invalidAction = JSON.stringify({ ...recipe, steps: [{ ...recipe.steps[0], action: 'boil' }] });
    expect(() => parseRecipe(invalidAction)).toThrow(/동작/);
  });

  it('keeps the input recipe untouched when scaling', () => {
    const scaled = scaleRecipe(recipe, 30);
    expect(scaled).not.toBe(recipe);
    expect(recipe.coffee).toBe(20);
    expect(recipe.steps[0].water).toBe(60);
    expect(scaled.coffee).toBe(30);
    expect(scaled.steps.map(step => step.water)).toEqual([90, 0, 180, 0]);
    expect(totalWater(scaled)).toBe(270);
  });

  it('rejects a coffee target outside the supported range', () => {
    expect(() => scaleRecipe(recipe, 0)).toThrow(/원두량/);
    expect(() => scaleRecipe(recipe, Number.NaN)).toThrow(/원두량/);
  });

  it('derives sequential absolute times and cumulative water', () => {
    const schedule = getStepSchedule(recipe);
    expect(schedule.map(entry => [entry.start, entry.end, entry.waterBefore, entry.waterAfter])).toEqual([
      [0, 30, 0, 60],
      [30, 45, 60, 60],
      [45, 90, 60, 180],
      [90, 95, 180, 180],
    ]);
  });

  it('ships presets whose totals match their steps', () => {
    for (const preset of PRESETS) {
      expect(() => validateRecipe(preset)).not.toThrow();
      expect(totalWater(preset)).toBe(preset.steps.reduce((sum, step) => sum + (step.action === 'pour' ? step.water : 0), 0));
    }
  });
});

describe('timer transitions', () => {
  it('counts wall-clock time rather than tick count', () => {
    const state = startTimer(initialTimer(), 1000);
    expect(getElapsedMs(state, 1200)).toBe(200);
    const paused = pauseTimer(state, 1500);
    expect(paused).toEqual({ status: 'paused', elapsedMs: 500, startedAt: null });
    const resumed = startTimer(paused, 9000);
    expect(getElapsedMs(resumed, 9350)).toBe(850);
  });

  it('ignores duplicate start and invalid now values', () => {
    const state = startTimer(initialTimer(), 1000);
    expect(startTimer(state, 5000)).toBe(state);
    expect(getElapsedMs(state, 500)).toBe(0);
    expect(getElapsedMs(state, Number.NaN)).toBe(0);
  });

  it('switches exactly at a step boundary', () => {
    expect(getTimerSnapshot(recipe, 29_999).stepIndex).toBe(0);
    const boundary = getTimerSnapshot(recipe, 30_000);
    expect(boundary.stepIndex).toBe(1);
    expect(boundary.stepStart).toBe(30);
    expect(boundary.targetWater).toBe(60);
    expect(boundary.stepRemaining).toBe(15);
  });

  it('interpolates target water only during pour steps', () => {
    expect(getTimerSnapshot(recipe, 15_000).targetWater).toBe(30);
    expect(getTimerSnapshot(recipe, 15_000).waterBefore).toBe(0);
    expect(getTimerSnapshot(recipe, 15_000).waterAfter).toBe(60);
    expect(getTimerSnapshot(recipe, 37_500).targetWater).toBe(60);
    expect(getTimerSnapshot(recipe, 67_500).targetWater).toBe(120);
    expect(getTimerSnapshot(recipe, 67_500).stepIndex).toBe(2);
  });

  it('clamps out-of-range elapsed values and completes at the end', () => {
    const final = getTimerSnapshot(recipe, 1_000_000);
    expect(final.completed).toBe(true);
    expect(final.elapsed).toBe(95);
    expect(final.stepIndex).toBe(3);
    expect(final.stepStart).toBe(90);
    expect(final.stepEnd).toBe(95);
    expect(final.waterBefore).toBe(180);
    expect(final.waterAfter).toBe(180);
    expect(final.targetWater).toBe(180);
    expect(final.progress).toBe(1);
    expect(getTimerSnapshot(recipe, -10).elapsed).toBe(0);
    expect(getTimerSnapshot(recipe, Number.NaN).elapsed).toBe(0);
  });

  it('rounds the partial pour target to 0.1g and reaches the final amount', () => {
    expect(getTimerSnapshot(recipe, 89_500).targetWater).toBe(178.7);
    expect(getTimerSnapshot(recipe, 89_999).targetWater).toBe(180);
    expect(getTimerSnapshot(recipe, 89_999).stepIndex).toBe(2);
  });

  it('follows an explicit flow rate instead of water / duration', () => {
    const faster = {
      ...recipe,
      steps: recipe.steps.map((item, index) => (index === 2 ? { ...item, flowRate: 4 } : item)),
    };
    expect(getTimerSnapshot(faster, 55_000).targetWater).toBe(100);
    expect(getTimerSnapshot(faster, 60_000).targetWater).toBe(120);
    expect(getTimerSnapshot(faster, 67_500).targetWater).toBe(150);
    expect(getTimerSnapshot(faster, 75_000).targetWater).toBe(180);
    expect(getTimerSnapshot(faster, 85_000).targetWater).toBe(180);
    expect(getTimerSnapshot(faster, 55_000).flowRate).toBe(4);
  });

  it('holds the step target once a configured flow finishes early', () => {
    const early = {
      ...recipe,
      steps: recipe.steps.map((item, index) => (index === 0 ? { ...item, flowRate: 10 } : item)),
    };
    expect(getTimerSnapshot(early, 3_000).targetWater).toBe(30);
    expect(getTimerSnapshot(early, 6_000).targetWater).toBe(60);
    expect(getTimerSnapshot(early, 20_000).targetWater).toBe(60);
    expect(getTimerSnapshot(early, 20_000).stepIndex).toBe(0);
  });

  it('never overshoots the step total when the rate is exact', () => {
    const exact = {
      ...recipe,
      steps: recipe.steps.map((item, index) => (index === 0 ? { ...item, flowRate: 2 } : item)),
    };
    expect(getTimerSnapshot(exact, 30_000).targetWater).toBe(60);
    expect(getTimerSnapshot(exact, 29_999).targetWater).toBe(60);
    expect(getTimerSnapshot(exact, 29_999).stepIndex).toBe(0);
  });
});
