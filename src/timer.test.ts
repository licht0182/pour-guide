import { describe, expect, it } from 'vitest';
import type { Recipe, RecipeStep } from './types';
import {
  getElapsedMs,
  getTimerSnapshot,
  initialTimer,
  pauseTimer,
  startTimer,
} from './timer';

function step(id: string, overrides: Partial<RecipeStep> = {}): RecipeStep {
  return {
    id,
    title: `단계 ${id}`,
    action: 'pour',
    duration: 10,
    water: 100,
    flowRate: null,
    note: '',
    ...overrides,
  };
}

function recipe(steps: RecipeStep[]): Recipe {
  return {
    id: 'timer-recipe',
    name: '타이머 테스트',
    description: '',
    coffee: 20,
    temperature: 93,
    grind: '중간',
    dripper: 'V60 02',
    steps,
  };
}

const linear = recipe([
  step('pour-1', { duration: 10, water: 100 }),
  step('wait-1', { action: 'wait', duration: 5, water: 0 }),
  step('pour-2', { duration: 10, water: 50 }),
]);

describe('getTimerSnapshot boundaries', () => {
  it('keeps the next step at the exact previous end', () => {
    const atStart = getTimerSnapshot(linear, 0);
    expect(atStart.stepIndex).toBe(0);
    expect(atStart.stepElapsed).toBe(0);
    expect(atStart.targetWater).toBe(0);

    const justBefore = getTimerSnapshot(linear, 9999);
    expect(justBefore.stepIndex).toBe(0);
    expect(justBefore.stepElapsed).toBeCloseTo(9.999, 6);

    const atBoundary = getTimerSnapshot(linear, 10000);
    expect(atBoundary.stepIndex).toBe(1);
    expect(atBoundary.stepElapsed).toBe(0);
    expect(atBoundary.stepRemaining).toBe(5);
    expect(atBoundary.stepStart).toBe(10);
    expect(atBoundary.stepEnd).toBe(15);
    expect(atBoundary.waterBefore).toBe(100);
    expect(atBoundary.waterAfter).toBe(100);
    expect(atBoundary.targetWater).toBe(100);

    const secondPour = getTimerSnapshot(linear, 15000);
    expect(secondPour.stepIndex).toBe(2);
    expect(secondPour.stepStart).toBe(15);
    expect(secondPour.waterBefore).toBe(100);
    expect(secondPour.waterAfter).toBe(150);
    expect(secondPour.targetWater).toBe(100);
  });

  it('interpolates target water linearly only during a pour', () => {
    const quarter = getTimerSnapshot(linear, 2500);
    expect(quarter.targetWater).toBe(25);

    const half = getTimerSnapshot(linear, 5000);
    expect(half.targetWater).toBe(50);

    const threeQuarters = getTimerSnapshot(linear, 7500);
    expect(threeQuarters.targetWater).toBe(75);

    const endOfPour = getTimerSnapshot(linear, 9999);
    expect(endOfPour.targetWater).toBe(100);
  });

  it('rounds the partial pour target to 0.1g without drifting past the step amount', () => {
    const partial = recipe([
      step('pour-1', { duration: 30, water: 60 }),
      step('wait-1', { action: 'wait', duration: 15, water: 0 }),
      step('pour-2', { duration: 45, water: 120 }),
    ]);

    expect(getTimerSnapshot(partial, 0).targetWater).toBe(0);
    expect(getTimerSnapshot(partial, 1000).targetWater).toBe(2);
    expect(getTimerSnapshot(partial, 89_500).targetWater).toBe(178.7);
    expect(getTimerSnapshot(partial, 89_999).targetWater).toBe(180);
    expect(getTimerSnapshot(partial, 90_000).targetWater).toBe(180);
  });

  it('holds target water steady through non-pour steps', () => {
    for (const ms of [10000, 12000, 14999]) {
      const snapshot = getTimerSnapshot(linear, ms);
      expect(snapshot.stepIndex).toBe(1);
      expect(snapshot.targetWater).toBe(100);
      expect(snapshot.waterBefore).toBe(100);
      expect(snapshot.waterAfter).toBe(100);
    }
  });

  it('clamps at the final step and final totals once finished', () => {
    const total = 25;
    const finished = getTimerSnapshot(linear, total * 1000);

    expect(finished.completed).toBe(true);
    expect(finished.elapsed).toBe(total);
    expect(finished.progress).toBe(1);
    expect(finished.targetWater).toBe(150);
    expect(finished.totalWater).toBe(150);
    expect(finished.stepIndex).toBe(2);
    expect(finished.stepElapsed).toBe(10);
    expect(finished.stepRemaining).toBe(0);
    expect(finished.stepStart).toBe(15);
    expect(finished.stepEnd).toBe(25);
    expect(finished.waterBefore).toBe(100);
    expect(finished.waterAfter).toBe(150);

    const overrun = getTimerSnapshot(linear, 90000);
    expect(overrun).toEqual(finished);
  });

  it('guards negative and non-finite elapsed values', () => {
    const base = getTimerSnapshot(linear, 0);
    expect(getTimerSnapshot(linear, -1)).toEqual(base);
    expect(getTimerSnapshot(linear, Number.NaN)).toEqual(base);
    expect(getTimerSnapshot(linear, Number.POSITIVE_INFINITY).completed).toBe(true);
    expect(getTimerSnapshot(linear, Number.NEGATIVE_INFINITY)).toEqual(base);

    const huge = getTimerSnapshot(linear, 1e15);
    expect(huge.completed).toBe(true);
    expect(huge.elapsed).toBe(25);
    expect(huge.progress).toBe(1);
  });

  it('reports progress in 0..1 without exceeding it mid-brew', () => {
    expect(getTimerSnapshot(linear, 0).progress).toBe(0);
    expect(getTimerSnapshot(linear, 12500).progress).toBeCloseTo(0.5, 10);
    expect(getTimerSnapshot(linear, 24999).progress).toBeGreaterThan(0.99);
    expect(getTimerSnapshot(linear, 25000).progress).toBe(1);
  });
});

describe('timer lifecycle', () => {
  it('starts from idle and advances elapsed from the supplied clock', () => {
    const idle = initialTimer();
    const running = startTimer(idle, 1000);

    expect(running.status).toBe('running');
    expect(running.startedAt).toBe(1000);
    expect(getElapsedMs(running, 3500)).toBe(2500);
    expect(getElapsedMs(running, 900)).toBe(0);
    expect(getElapsedMs(running, Number.NaN)).toBe(0);
    expect(getElapsedMs(running, 1000)).toBe(0);
    expect(startTimer(running, 2000)).toBe(running);
  });

  it('accumulates elapsed across pause and restart without double counting', () => {
    const started = startTimer(initialTimer(), 1000);
    const paused = pauseTimer(started, 4000);
    expect(paused).toEqual({ status: 'paused', elapsedMs: 3000, startedAt: null });
    expect(getElapsedMs(paused, 99999)).toBe(3000);

    const restarted = startTimer(paused, 50000);
    expect(restarted.elapsedMs).toBe(3000);
    expect(restarted.startedAt).toBe(50000);
    expect(getElapsedMs(restarted, 52000)).toBe(5000);
    expect(getTimerSnapshot(linear, getElapsedMs(restarted, 52000)).stepIndex).toBe(0);
    expect(pauseTimer(paused, 60000)).toBe(paused);
    expect(startTimer(initialTimer(), 10).status).toBe('running');
    expect(startTimer(startTimer(initialTimer(), 10), 20).startedAt).toBe(10);
  });

  it('catches up after a delayed tick using the same clock', () => {
    const started = startTimer(initialTimer(), 0);
    const paused = pauseTimer(started, 8600);
    expect(getTimerSnapshot(linear, getElapsedMs(paused, 8600)).stepIndex).toBe(0);

    const resumed = startTimer(paused, 60000);
    const delayedNow = 60000 + 1400;
    const elapsed = getElapsedMs(resumed, delayedNow);
    const snapshot = getTimerSnapshot(linear, elapsed);

    expect(elapsed).toBe(10000);
    expect(snapshot.stepIndex).toBe(1);
    expect(snapshot.targetWater).toBe(100);
    expect(snapshot.elapsed).toBe(10);
  });

  it('does not restart a completed timer until reset', () => {
    const completed = { status: 'completed' as const, elapsedMs: 25000, startedAt: null };
    expect(startTimer(completed, 12345)).toBe(completed);
    expect(pauseTimer(completed, 12345)).toBe(completed);

    const reset = initialTimer();
    const again = startTimer(reset, 500);
    expect(again.status).toBe('running');
    expect(getElapsedMs(again, 700)).toBe(200);
  });

  it('returns a fresh idle state each call so consumers cannot share one object', () => {
    const first = initialTimer();
    const second = initialTimer();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
