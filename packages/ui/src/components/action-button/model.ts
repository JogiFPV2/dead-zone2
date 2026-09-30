/** ActionButton rules (spec §3.10, §5 ActionVM). */

export type ActionVariant = 'primary' | 'secondary';
export type ActionState = 'default' | 'hover' | 'pressed' | 'disabled';
/** Interaction forced from code: `pressed` while the bound key is held, `hover`/`focus` for previews. */
export type ForcedActionState = 'hover' | 'pressed' | 'focus';

export const ACTION_VARIANTS = ['primary', 'secondary'] as const satisfies readonly ActionVariant[];
export const ACTION_STATES = [
  'default',
  'hover',
  'pressed',
  'disabled',
] as const satisfies readonly ActionState[];

export interface ActionVM {
  id: string;
  label: string;
  icon: string;
  key: string;
  variant: ActionVariant;
  enabled: boolean;
  holdMs?: number;
  /** Hold progress 0..1 (3 px bar at the bottom). */
  progress?: number;
}

/** Visual state; `disabled` wins over any forced interaction. */
export function actionState(enabled: boolean, forced?: ForcedActionState): ActionState {
  if (!enabled) return 'disabled';
  if (forced === 'hover' || forced === 'pressed') return forced;
  return 'default';
}
