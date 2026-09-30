/** ObjectiveCard (spec §3.1). */
import { tokens } from '../../tokens/tokens.generated.js';
import { ms } from '../../tokens/units.js';

export type ObjectiveState = 'active' | 'updated' | 'completed' | 'none';
export const OBJECTIVE_STATES = [
  'active',
  'updated',
  'completed',
  'none',
] as const satisfies readonly ObjectiveState[];

/** Spec §5 `ObjectiveVM`, plus an optional step counter for multi-step modes (rescue). */
export interface ObjectiveVM {
  id: string;
  title: string;
  /** 0..1 (clamped). */
  progress: number;
  state: ObjectiveState;
  /** Current step, 1-based, and step count: shows `2/3` in the header. */
  step?: number;
  steps?: number;
}

export const OBJECTIVE_HEADER: Record<'current' | 'completed', string> = {
  current: 'Cel bieżący',
  completed: 'Cel ukończony',
};

/** Border highlight after a change (motion.highlight = 600 ms). */
export const OBJECTIVE_HIGHLIGHT_MS = ms(tokens.motion.highlight);
/** A completed card stays for motion.objective.hold (3 s), then fades in motion.slow. */
export const OBJECTIVE_HOLD_MS = ms(tokens.motion.objective.hold);

export const clampProgress = (p: number): number =>
  Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;

export const stepLabel = (vm: Pick<ObjectiveVM, 'step' | 'steps'>): string =>
  vm.step !== undefined && vm.steps !== undefined && vm.steps > 1 ? `${vm.step}/${vm.steps}` : '';
