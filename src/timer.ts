import type { Recipe, TimerSnapshot, TimerState } from './types';

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampMs(value: number, durationMs: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  return Math.min(value, durationMs);
}

export function initialTimer(): TimerState {
  return { status: 'idle', elapsedMs: 0, startedAt: null };
}

export function getElapsedMs(state: TimerState, nowMs: number): number {
  const base = Number.isFinite(state.elapsedMs) && state.elapsedMs > 0 ? state.elapsedMs : 0;
  if (state.status !== 'running' || state.startedAt === null) return base;
  const delta = nowMs - state.startedAt;
  if (!Number.isFinite(delta) || delta <= 0) return base;
  return base + delta;
}

export function startTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status === 'completed' || state.status === 'running') return state;
  const startedAt = Number.isFinite(nowMs) ? nowMs : 0;
  const elapsedMs = Number.isFinite(state.elapsedMs) && state.elapsedMs > 0 ? state.elapsedMs : 0;
  return { status: 'running', elapsedMs, startedAt };
}

export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status !== 'running') return state;
  return { status: 'paused', elapsedMs: getElapsedMs(state, nowMs), startedAt: null };
}

export function getTimerSnapshot(recipe: Recipe, elapsedMs: number): TimerSnapshot {
  const steps = recipe.steps;
  let totalDuration = 0;
  let totalWater = 0;
  for (const step of steps) {
    totalDuration += step.duration;
    if (step.action === 'pour') totalWater += step.water;
  }
  totalWater = roundTenth(totalWater);

  if (steps.length === 0) {
    return {
      elapsed: 0,
      totalDuration: 0,
      totalWater: 0,
      stepIndex: -1,
      stepElapsed: 0,
      stepRemaining: 0,
      stepStart: 0,
      stepEnd: 0,
      waterBefore: 0,
      waterAfter: 0,
      targetWater: 0,
      progress: 1,
      completed: true,
    };
  }

  const durationMs = totalDuration * 1000;
  const safeMs = clampMs(elapsedMs, durationMs);
  const completed = safeMs >= durationMs;
  const elapsed = safeMs / 1000;
  const progress = durationMs > 0 ? safeMs / durationMs : 1;

  let stepIndex = -1;
  let stepStart = 0;
  let stepEnd = 0;
  let waterBefore = 0;
  let waterAfter = 0;
  let previousEnd = 0;
  let water = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const start = previousEnd;
    const end = start + step.duration;
    const before = water;
    const after = step.action === 'pour' ? roundTenth(before + step.water) : before;
    stepIndex = index;
    stepStart = start;
    stepEnd = end;
    waterBefore = before;
    waterAfter = after;
    previousEnd = end;
    water = after;
    if (!completed && elapsed < end) break;
  }

  const step = steps[stepIndex];
  if (completed) {
    return {
      elapsed: totalDuration,
      totalDuration,
      totalWater,
      stepIndex,
      stepElapsed: step.duration,
      stepRemaining: 0,
      stepStart,
      stepEnd,
      waterBefore,
      waterAfter,
      targetWater: totalWater,
      progress: 1,
      completed: true,
    };
  }

  const stepElapsed = Math.max(0, elapsed - stepStart);
  const targetWater = step.action === 'pour'
    ? roundTenth(waterBefore + (waterAfter - waterBefore) * (stepElapsed / step.duration))
    : waterBefore;

  return {
    elapsed,
    totalDuration,
    totalWater,
    stepIndex,
    stepElapsed,
    stepRemaining: Math.max(0, stepEnd - elapsed),
    stepStart,
    stepEnd,
    waterBefore,
    waterAfter,
    targetWater,
    progress,
    completed: false,
  };
}
