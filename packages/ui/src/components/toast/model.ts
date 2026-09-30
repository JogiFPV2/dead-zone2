/** Toast queue rules (spec §3.4): pure functions, time passed in. */
import { tokens } from '../../tokens/tokens.generated.js';
import { ms } from '../../tokens/units.js';

export type ToastKind = 'damage' | 'gain' | 'info' | 'warning';
export const TOAST_KINDS = [
  'damage',
  'gain',
  'info',
  'warning',
] as const satisfies readonly ToastKind[];

/** What the game pushes. */
export interface ToastInput {
  kind: ToastKind;
  /** Short value in the kind colour: `−12 HP`, `+3`. */
  value?: string;
  text: string;
}

/** Spec §5 `ToastVM`. */
export interface ToastVM extends ToastInput {
  id: string;
  createdAt: number;
  count?: number;
}

/** Lifetime per kind (motion.toast.life.*). */
export const TOAST_LIFETIME_MS: Record<ToastKind, number> = {
  damage: ms(tokens.motion.toast.life.damage),
  gain: ms(tokens.motion.toast.life.gain),
  info: ms(tokens.motion.toast.life.info),
  warning: ms(tokens.motion.toast.life.warning),
};
/** Identical toasts within this window merge (motion.toast.merge). */
export const TOAST_MERGE_MS = ms(tokens.motion.toast.merge);
export const TOAST_EXIT_MS = ms(tokens.motion.toast.exit);
export const MAX_VISIBLE_TOASTS = 4;

const same = (a: ToastInput, b: ToastInput): boolean =>
  a.kind === b.kind && (a.value ?? '') === (b.value ?? '') && a.text === b.text;

export interface PushResult {
  /** Newest first. */
  list: ToastVM[];
  /** Toast created or merged into. */
  toast: ToastVM;
  merged: boolean;
  /** Pushed out by the limit: leave immediately. */
  evicted: ToastVM[];
}

/** Adds a toast on top; merges an identical one younger than the merge window (count + reset). */
export function pushToast(
  list: readonly ToastVM[],
  input: ToastInput,
  now: number,
  id: string,
): PushResult {
  const hit = list.find((t) => same(t, input) && now - t.createdAt <= TOAST_MERGE_MS);
  if (hit) {
    const toast: ToastVM = { ...hit, createdAt: now, count: (hit.count ?? 1) + 1 };
    return { list: list.map((t) => (t === hit ? toast : t)), toast, merged: true, evicted: [] };
  }
  const toast: ToastVM = { ...input, id, createdAt: now };
  const all = [toast, ...list];
  return {
    list: all.slice(0, MAX_VISIBLE_TOASTS),
    toast,
    merged: false,
    evicted: all.slice(MAX_VISIBLE_TOASTS),
  };
}

/** Whether a toast has outlived its kind's lifetime. */
export const isExpired = (t: ToastVM, now: number): boolean =>
  now - t.createdAt >= TOAST_LIFETIME_MS[t.kind];

/** Text with the merge counter: `Brodawka ×2`. */
export const toastText = (t: Pick<ToastVM, 'text' | 'count'>): string =>
  (t.count ?? 1) > 1 ? `${t.text} ×${t.count}` : t.text;

export const TOAST_ICON: Record<ToastKind, 'warning' | 'check' | 'info'> = {
  damage: 'warning',
  gain: 'check',
  info: 'info',
  warning: 'warning',
};
