import {
  BODY_PARTS,
  type ActionInterruptReason,
  type ActionKind,
  type CommandRejectReason,
  type PlayerNoiseKind,
} from '@deadzone/protocol';
import { ticksPerGameMinute } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { playerItems } from '../items/inventory.js';
import type { ActionState, PlayerItems } from '../items/store.js';
import { threatNearby } from '../systems/sleep.js';
import { emitNoise, type PlayerNoiseBy } from '../ai/noise.js';
import { Pen, penaltyMul } from '../survival/penalties.js';
import { floorZ } from '../world/levels.js';

/**
 * Timed actions (docs 2.5 `actions`), the Stage 6 foundation: one current action per player plus
 * a short FIFO queue. The duration is fixed when the action starts; movement, sleep, death or a
 * threat interrupt it and clear the queue. Handlers validate again on completion. `search` is
 * never interrupted by zombies (threat, being hit): only the player's own movement / attack,
 * sleep and death stop it.
 */
export const ACTION_KINDS: readonly ActionKind[] = [
  'search',
  'eat',
  'drink',
  'bandage',
  'unpack',
  'craft',
  'read',
  'watch',
  'smashWindow',
  'climbThrough',
  'removeGlass',
  'barricade',
  'removeBarricade',
  'forceDoor',
  'enterVehicle',
  'exitVehicle',
  'hotwire',
  'refuel',
  'fillFuel',
  'siphonFuel',
  'repairVehicle',
  'pickLock',
  'useKey',
  'disinfect',
  'stitch',
  'rest',
];
export const actionKindIndex = (k: ActionKind): number => ACTION_KINDS.indexOf(k);
export const MAX_QUEUED_ACTIONS = 8;

/** Actions zombies never interrupt (no `threat`): Paweł's rule — only the player stops a search. */
const THREAT_IMMUNE: ReadonlySet<number> = new Set([actionKindIndex('search')]);

export interface ActionHandler {
  /** Reject reason when the action cannot run (checked at start and at completion). */
  validate(w: SimWorld, eid: number, a: ActionState): CommandRejectReason | undefined;
  /** Duration in game minutes. */
  durationMin(w: SimWorld, eid: number, a: ActionState): number;
  complete(w: SimWorld, eid: number, a: ActionState): void;
  /** Exact duration in ticks (overrides `durationMin` and the wound slowdown). */
  ticks?(w: SimWorld, eid: number, a: ActionState): number;
  /** Called when the action starts (after the timer is set): e.g. the climb, hammer noise. */
  begin?(w: SimWorld, eid: number, a: ActionState): void;
  /** Check on completion instead of `validate` (e.g. the climb already moved the player). */
  validateEnd?(w: SimWorld, eid: number, a: ActionState): CommandRejectReason | undefined;
  /** Interrupt reasons that do not stop this action (`threat`, `moved`). */
  ignore?: readonly ActionInterruptReason[];
  /** Called when the running action is interrupted (e.g. pour the fuel moved so far). */
  interrupted?(w: SimWorld, eid: number, a: ActionState): void;
}

const handlers = new Map<number, ActionHandler>();

/** Modules register their handlers (items → eat, drink, bandage, unpack, search). */
export function registerAction(kind: ActionKind, h: ActionHandler): void {
  handlers.set(actionKindIndex(kind), h);
}

export function newAction(
  kind: ActionKind,
  args: {
    item?: number;
    container?: number;
    part?: number;
    recipe?: number;
    use?: number[];
    edge?: number;
  } = {},
): ActionState {
  return {
    ...(args.edge !== undefined ? { edge: args.edge } : {}),
    kind: actionKindIndex(kind),
    startTick: 0,
    endTick: 0,
    item: args.item ?? 0,
    container: args.container ?? 0,
    part: args.part ?? -1,
    recipe: args.recipe ?? 0,
    use: args.use ?? [],
  };
}

const kindName = (a: ActionState): ActionKind => ACTION_KINDS[a.kind] ?? 'search';

/** Validates and starts (or queues behind the current one) a timed action. */
export function startAction(
  w: SimWorld,
  eid: number,
  a: ActionState,
): CommandRejectReason | undefined {
  const p = playerItems(w, eid);
  const h = handlers.get(a.kind);
  if (!p || !h) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'invalid-state';
  const reason = h.validate(w, eid, a);
  if (reason) return reason;
  if (!p.current) begin(w, eid, p, a, h);
  else if (p.queue.length < MAX_QUEUED_ACTIONS) p.queue.push(a);
  else return 'busy';
  w.items!.version++;
  return undefined;
}

const ACTION_NOISE_KINDS: Partial<Record<ActionKind, PlayerNoiseKind>> = {
  search: 'search',
  eat: 'eat',
  drink: 'drink',
  bandage: 'bandage',
  unpack: 'unpack',
  craft: 'craft',
  watch: 'watch',
};

/** `playerNoise` kind of a timed action's start noise (none for kinds without a mapping). */
const actionNoiseKind = (kind: ActionKind, eid: number): PlayerNoiseBy | undefined => {
  const k = ACTION_NOISE_KINDS[kind];
  return k ? { eid, kind: k } : undefined;
};

function begin(w: SimWorld, eid: number, p: PlayerItems, a: ActionState, h: ActionHandler): void {
  // Slower with wounds (woundPenalties.actionSpeed, capped at maxPenalty < 1).
  const speed = Math.max(0.1, penaltyMul(w, eid, Pen.action));
  const ticks = h.ticks
    ? Math.max(1, h.ticks(w, eid, a))
    : Math.max(1, Math.round((h.durationMin(w, eid, a) * ticksPerGameMinute(w.clock)) / speed));
  a.startTick = w.tick;
  a.endTick = w.tick + ticks;
  p.current = a;
  const actionNoise: Partial<Record<ActionKind, { radiusTiles: number; volume: number }>> =
    w.ai?.cfg.noise.actions ?? {};
  const noise = actionNoise[kindName(a)];
  if (noise && noise.radiusTiles > 0) {
    const { Position } = w.c;
    emitNoise(
      w,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      floorZ(w, eid),
      noise.radiusTiles,
      noise.volume,
      'action',
      0,
      actionNoiseKind(kindName(a), eid),
    );
  }
  w.events.push({
    type: 'actionStarted',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    action: kindName(a),
    endTick: a.endTick,
    ...(a.item ? { item: a.item } : {}),
    ...(a.container ? { container: a.container } : {}),
    ...(a.vehicle !== undefined ? { vehicleId: a.vehicle } : {}),
  });
  h.begin?.(w, eid, a);
}

export function interruptActions(w: SimWorld, eid: number, reason: ActionInterruptReason): void {
  const p = playerItems(w, eid);
  if (!p?.current) return;
  handlers.get(p.current.kind)?.interrupted?.(w, eid, p.current);
  w.events.push({
    type: 'actionInterrupted',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    action: kindName(p.current),
    reason,
  });
  p.current = undefined;
  p.queue.length = 0;
  w.items!.version++;
}

/**
 * Movement by other means than `MoveIntent` (the driver's throttle / brake): interrupts the
 * current action with `moved` unless its handler ignores it (like walking does).
 */
export function interruptOnMove(w: SimWorld, eid: number): void {
  const a = playerItems(w, eid)?.current;
  if (!a || handlers.get(a.kind)?.ignore?.includes('moved')) return;
  interruptActions(w, eid, 'moved');
}

/** Starts queued actions until one is valid (invalid ones are dropped as `target-lost`). */
function next(w: SimWorld, eid: number, p: PlayerItems): void {
  for (let a = p.queue.shift(); a; a = p.queue.shift()) {
    const h = handlers.get(a.kind);
    if (h && !h.validate(w, eid, a)) {
      begin(w, eid, p, a, h);
      return;
    }
    w.events.push({
      type: 'actionInterrupted',
      tick: w.tick,
      playerId: w.c.Player.id[eid] ?? 0,
      action: kindName(a),
      reason: 'target-lost',
    });
  }
}

/**
 * Pipeline step 3 (before movement, after commands): interrupts (movement intent, sleep, death,
 * threat — except for `search`), completion, next queued action.
 */
export function actionsSystem(w: SimWorld): void {
  const st = w.items;
  if (!st) return;
  const s = w.survival;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const p = playerItems(w, eid);
    const a = p?.current;
    if (!p || !a) continue;
    const h = handlers.get(a.kind)!;
    const moving = (w.c.MoveIntent.dx[eid] ?? 0) !== 0 || (w.c.MoveIntent.dy[eid] ?? 0) !== 0;
    const can = (r: ActionInterruptReason): boolean => !h.ignore?.includes(r);
    const reason: ActionInterruptReason | undefined = s?.dead[eid]
      ? 'died'
      : s?.asleep[eid]
        ? 'asleep'
        : !THREAT_IMMUNE.has(a.kind) && can('threat') && threatNearby(w, eid)
          ? 'threat'
          : can('moved') && moving
            ? 'moved'
            : undefined;
    if (reason) {
      interruptActions(w, eid, reason);
      continue;
    }
    if (w.tick < a.endTick) continue;
    p.current = undefined;
    st.version++;
    if ((h.validateEnd ?? h.validate)(w, eid, a)) {
      w.events.push({
        type: 'actionInterrupted',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        action: kindName(a),
        reason: 'target-lost',
      });
    } else {
      h.complete(w, eid, a);
      w.events.push({
        type: 'actionCompleted',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        action: kindName(a),
      });
    }
    next(w, eid, p);
  }
}

/**
 * Context menu preview (furniture/menu.ts): the reason `startAction` would reject with — or
 * `threat` when zombies near would interrupt it at once — and its base duration (game minutes,
 * before the wound slowdown; undefined for actions timed in ticks).
 */
export function previewAction(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { reason: CommandRejectReason | undefined; durationMin: number | undefined } {
  const h = handlers.get(a.kind);
  const p = playerItems(w, eid);
  if (!h || !p) return { reason: 'invalid-state', durationMin: undefined };
  let reason = w.survival?.asleep[eid] ? 'invalid-state' : h.validate(w, eid, a);
  if (!reason && p.current && p.queue.length >= MAX_QUEUED_ACTIONS) reason = 'busy';
  if (
    !reason &&
    !THREAT_IMMUNE.has(a.kind) &&
    !h.ignore?.includes('threat') &&
    threatNearby(w, eid)
  )
    reason = 'threat';
  return { reason, durationMin: h.ticks ? undefined : h.durationMin(w, eid, a) };
}

export const actionPart = (a: ActionState) => (a.part >= 0 ? BODY_PARTS[a.part] : undefined);
