export type StepAction = 'pour' | 'wait' | 'swirl' | 'stir';
export type ServeTemperature = 'ice' | 'hot';
export interface RecipeStep {
  id: string;
  title: string;
  action: StepAction;
  duration: number; // seconds, sequential, integer >= 1
  water: number; // additional grams; zero for non-pour steps
  flowRate: number | null; // g/s; null = water / duration, non-pour = null
  note: string;
}
export interface Recipe {
  id: string;
  name: string;
  description: string;
  coffee: number;
  temperature: number;
  grind: string;
  dripper: string;
  filter?: string;
  category?: string;
  /** Serving temperature; absent means the recipe does not say. */
  serve?: ServeTemperature;
  order?: number;
  steps: RecipeStep[];
}
export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed';
export interface TimerState {
  status: TimerStatus;
  elapsedMs: number;
  startedAt: number | null;
}
export interface TimerSnapshot {
  elapsed: number;
  totalDuration: number;
  totalWater: number;
  stepIndex: number;
  stepElapsed: number;
  stepRemaining: number;
  stepStart: number;
  stepEnd: number;
  waterBefore: number;
  waterAfter: number;
  targetWater: number;
  flowRate: number;
  progress: number;
  completed: boolean;
}
