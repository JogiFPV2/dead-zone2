import {
  BODY_PARTS,
  type ActionInterruptReason,
  type ActionKind,
  type CommandRejectReason,
} from '@deadzone/protocol';
import { ticksPerGameMinute } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { playerItems } from '../items/inventory.js';
import type { ActionState, PlayerItems } from '../items/store.js';
import { threatNearby } from '../systems/sleep.js';
import { emitNoise } from '../ai/noise.js';
import { Pen, penaltyMul } from '../survival/penalties.js';

/**
 * Timed actions (docs 2.5 `actions`), the Stage 6 foundation: one current action per player plus
 * a short FIFO queue. The duration is fixed when the action starts; movement, sleep, death or a
 * threat interrupt it and clear the queue. Handlers validate again on completion.
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
];
export const actionKindIndex = (k: ActionKind): number => ACTION_KINDS.indexOf(k);
export const MAX_QUEUED_ACTIONS = 8;

export interface ActionHandler {
  /** Reject reason when the action cannot run (checked at start and at completion). */
  validate(w: SimWorld, eid: number, a: ActionState): CommandRejectReason | undefined;
  /** Duration in game minutes. */
  durationMin(w: SimWorld, eid: number, a: ActionState): number;
  complete(w: SimWorld, eid: number, a: ActionState): void;
}

const handlers = new Map<number, ActionHandler>();

/** Modules register their handlers (items → eat, drink, bandage, unpack, search). */
export function registerAction(kind: ActionKind, h: ActionHandler): void {
  handlers.set(actionKindIndex(kind), h);
}

export function newAction(
  kind: ActionKind,
  args: { item?: number; container?: number; part?: number; recipe?: number; use?: number[] } = {},
): ActionState {
  return {
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

function begin(w: SimWorld, eid: number, p: PlayerItems, a: ActionState, h: ActionHandler): void {
  // Slower with wounds (woundPenalties.actionSpeed, capped at maxPenalty < 1).
  const speed = Math.max(0.1, penaltyMul(w, eid, Pen.action));
  const ticks = Math.max(
    1,
    Math.round((h.durationMin(w, eid, a) * ticksPerGameMinute(w.clock)) / speed),
  );
  a.startTick = w.tick;
  a.endTick = w.tick + ticks;
  p.current = a;
  const noise = w.ai?.cfg.noise.actions[kindName(a)];
  if (noise && noise.radiusTiles > 0) {
    const { Position } = w.c;
    emitNoise(
      w,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      Position.z[eid] ?? 0,
      noise.radiusTiles,
      noise.volume,
      'action',
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
  });
}

export function interruptActions(w: SimWorld, eid: number, reason: ActionInterruptReason): void {
  const p = playerItems(w, eid);
  if (!p?.current) return;
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
 * threat), completion, next queued action.
 */
export function actionsSystem(w: SimWorld): void {
  const st = w.items;
  if (!st) return;
  const s = w.survival;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const p = playerItems(w, eid);
    const a = p?.current;
    if (!p || !a) continue;
    const moving = (w.c.MoveIntent.dx[eid] ?? 0) !== 0 || (w.c.MoveIntent.dy[eid] ?? 0) !== 0;
    const reason: ActionInterruptReason | undefined = s?.dead[eid]
      ? 'died'
      : s?.asleep[eid]
        ? 'asleep'
        : threatNearby(w, eid)
          ? 'threat'
          : moving
            ? 'moved'
            : undefined;
    if (reason) {
      interruptActions(w, eid, reason);
      continue;
    }
    if (w.tick < a.endTick) continue;
    const h = handlers.get(a.kind)!;
    p.current = undefined;
    st.version++;
    if (h.validate(w, eid, a)) {
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

export const actionPart = (a: ActionState) => (a.part >= 0 ? BODY_PARTS[a.part] : undefined);
