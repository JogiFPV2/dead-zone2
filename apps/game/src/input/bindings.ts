import { ACTIONS, isAction, isInputCode, type Action, type InputCode } from './actions.js';

/** Up to MAX_SLOTS inputs per action (primary, secondary). */
export const MAX_SLOTS = 2;

export type Bindings = Readonly<Record<Action, readonly InputCode[]>>;

export const DEFAULT_BINDINGS: Bindings = {
  moveUp: ['KeyW'],
  moveDown: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  sprint: ['ShiftLeft'],
  crouch: ['KeyC'],
  vault: ['Space'],
  rotateCameraLeft: ['KeyQ'],
  rotateCameraRight: ['KeyE'],
  // Camera zoom: wheel, or X / Z held (HUD v2 chip `KAMERA 1,0× [Z X]`).
  zoomIn: ['WheelUp', 'KeyX'],
  zoomOut: ['WheelDown', 'KeyZ'],
  interact: ['KeyF'],
  primaryAction: ['Mouse0'],
  secondaryAction: ['Mouse2'],
  reload: ['KeyR'],
  quickslot1: ['Digit1'],
  quickslot2: ['Digit2'],
  quickslot3: ['Digit3'],
  quickslot4: ['Digit4'],
  quickslot5: ['Digit5'],
  inventory: ['KeyI'],
  crafting: ['KeyB'],
  sleep: ['KeyN'],
  watchTv: ['KeyT'],
  map: ['KeyM'],
  // HUD v2 top bar. `C` stays crouch (and combine in the inventory): „Postać i zdrowie” is H.
  character: ['KeyH'],
  skills: ['KeyK'],
  journal: ['KeyJ'],
  pause: ['Escape'],
  toggleHints: ['F1'],
};

/** Reverse index: input code → actions bound to it. */
export function indexBindings(b: Bindings): Map<InputCode, Action[]> {
  const index = new Map<InputCode, Action[]>();
  for (const action of ACTIONS) {
    for (const code of b[action]) {
      const list = index.get(code);
      if (list) list.push(action);
      else index.set(code, [action]);
    }
  }
  return index;
}

export interface Conflict {
  code: InputCode;
  actions: Action[];
}

/** Inputs bound to more than one action. */
export function findConflicts(b: Bindings): Conflict[] {
  return [...indexBindings(b)]
    .filter(([, actions]) => actions.length > 1)
    .map(([code, actions]) => ({ code, actions }));
}

/**
 * - `reject`: refuse when the input is used by another action;
 * - `steal`: remove it from the other actions;
 * - `swap`: the other actions get this action's previous input in that slot (or lose it).
 */
export type ConflictPolicy = 'reject' | 'steal' | 'swap';

export type RebindResult =
  { ok: true; bindings: Bindings; displaced: Action[] } | { ok: false; conflicts: Action[] };

const withSlot = (codes: readonly InputCode[], slot: number, code: InputCode | undefined) => {
  const next = [...codes];
  if (code === undefined) next.splice(slot, 1);
  else if (slot >= next.length) next.push(code);
  else next[slot] = code;
  return next.filter((c, i) => next.indexOf(c) === i);
};

/** Binds `code` to `action` in `slot` (pure; returns new bindings). */
export function rebind(
  b: Bindings,
  action: Action,
  code: InputCode,
  { slot = 0, policy = 'reject' }: { slot?: number; policy?: ConflictPolicy } = {},
): RebindResult {
  if (!isInputCode(code)) throw new Error(`nieprawidłowy kod wejścia: ${JSON.stringify(code)}`);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
    throw new Error(`slot poza zakresem 0..${MAX_SLOTS - 1}`);
  }
  const others = ACTIONS.filter((a) => a !== action && b[a].includes(code));
  if (others.length && policy === 'reject') return { ok: false, conflicts: others };
  const previous = b[action][slot];
  const next: Record<Action, readonly InputCode[]> = { ...b };
  for (const other of others) {
    const i = b[other].indexOf(code);
    const replacement = policy === 'swap' && previous !== code ? previous : undefined;
    next[other] = withSlot(b[other], i, replacement);
  }
  next[action] = withSlot(b[action], slot, code);
  return { ok: true, bindings: next, displaced: others };
}

export function unbind(b: Bindings, action: Action, slot = 0): Bindings {
  return { ...b, [action]: withSlot(b[action], slot, undefined) };
}

export function resetAction(b: Bindings, action: Action): Bindings {
  return { ...b, [action]: DEFAULT_BINDINGS[action] };
}

/**
 * Untrusted (persisted) data → bindings: unknown actions and invalid codes are dropped, actions
 * missing from the data (e.g. added in a newer build) get their defaults.
 */
export function sanitizeBindings(raw: unknown): Bindings {
  const out: Record<Action, readonly InputCode[]> = { ...DEFAULT_BINDINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const stored = new Set<Action>();
  for (const [action, codes] of Object.entries(raw)) {
    if (!isAction(action) || !Array.isArray(codes)) continue;
    const valid = codes.filter(isInputCode);
    out[action] = valid.filter((c, i) => valid.indexOf(c) === i).slice(0, MAX_SLOTS);
    stored.add(action);
  }
  // Defaults of actions new to this data must not steal inputs the player already uses.
  const used = new Set([...stored].flatMap((a) => out[a]));
  for (const action of ACTIONS) {
    if (!stored.has(action)) out[action] = out[action].filter((c) => !used.has(c));
  }
  return out;
}
