import type { CommandRejectReason, SimEvent } from '@deadzone/protocol';
import {
  actionKindIndex,
  interruptActions,
  newAction,
  registerAction,
  startAction,
} from '../actions/queue.js';
import { gridOf } from '../ai/commands.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { playerItems } from '../items/inventory.js';
import { edgeAt, edgeInReach } from '../openings/actions.js';
import { isDoorLike, openingKey, openingView, OS, unpackKey } from '../openings/state.js';
import { clampStat } from '../survival/state.js';
import { floorZ } from '../world/levels.js';
import { PHYS_TICKS_PER_SECOND } from './constants.js';
import { furnitureStrengthKg } from './furniture.js';
import { canAct } from './modifiers.js';
import { setState } from './reactions.js';

/**
 * Holding a door / gate shut from the inside (docs 9.65, timed action `holdDoor`). The holder
 * resists crowd pressure in `edgePressure` with their furniture push strength (skill, fatigue,
 * wounds, load, endurance) × `crowd.holdUnitsPerKg` instead of the passive `holdForce`.
 * Endurance drains every tick (`holdEndurancePerSec`) and every crowd pulse in proportion to the
 * pressing units (`holdEndurancePerUnit`); below `holdMinEndurance` the hold ends (`exhausted`).
 * A crowd stronger than the hold (net ≥ `holdStaggerUnits`) staggers the holder (≥
 * `holdKnockUnits`: knocks them down) and the hold ends (`overpowered`); the excess then damages
 * the door through the usual `damageOpening` path. Moving, being hit, sleep or death interrupt
 * it; zombies nearby do not. Deterministic: holders in entity order, 1 `rng.physics` draw per
 * knock-down (its length). State = the action (`ActionState.edge`), saved with the queue.
 */

/** An edge given by key (`openingKey`) or by tile and side (`z` = the player's floor). */
export type DoorRef = number | { tx: number; ty: number; side: 'n' | 'w'; z?: number };

export interface HoldDoorCheck {
  ok: boolean;
  reason?: CommandRejectReason;
  /** The edge key (`openingKey`), −1 when unresolved. */
  edge: number;
  /** The holder's push strength (kg) and the resulting resistance (zombie units). */
  strengthKg: number;
  units: number;
}

const HOLD = 'holdDoor';

export function doorKey(w: SimWorld, eid: number, ref: DoorRef): number {
  if (typeof ref === 'number') return ref;
  return openingKey(ref.side === 'n' ? 0 : 1, ref.tx, ref.ty, ref.z ?? floorZ(w, eid));
}

/** Resistance (zombie units) of player `eid` actively holding a door. */
export function holdUnits(w: SimWorld, eid: number): number {
  return furnitureStrengthKg(w, eid, 'push') * w.physics.cfg.crowd.holdUnitsPerKg;
}

/** Can player `eid` hold edge `key` now (pure; the same check as the action start). */
export function checkHoldDoor(w: SimWorld, eid: number, key: number): HoldDoorCheck {
  const cc = w.physics.cfg.crowd;
  const fail = (reason: CommandRejectReason): HoldDoorCheck => ({
    ok: false,
    reason,
    edge: key,
    strengthKg: 0,
    units: 0,
  });
  if (!cc.enabled || !cc.holdEnabled) return fail('invalid-state');
  if (w.survival?.dead[eid] || w.survival?.asleep[eid]) return fail('invalid-state');
  const b = w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
  if (b && (b.vehicle || !canAct(b.state))) return fail('invalid-state');
  const k = unpackKey(key);
  const t = edgeAt(gridOf(w), w, key % 2, k.tx, k.ty, k.z);
  if (!isDoorLike(t.kind)) return fail('invalid-target');
  // Closed, locked or barricaded (planks on a closed door): something to lean on.
  if (t.state === OS.open || t.state === OS.broken) return fail('invalid-state');
  if (!edgeInReach(w, eid, key)) return fail('out-of-range');
  if ((w.survival?.vitals.endurance[eid] ?? 100) <= cc.holdMinEndurance) return fail('tired');
  const strengthKg = furnitureStrengthKg(w, eid, 'push');
  return { ok: true, edge: key, strengthKg, units: Math.fround(strengthKg * cc.holdUnitsPerKg) };
}

const holdingKey = (w: SimWorld, eid: number): number | undefined => {
  const a = playerItems(w, eid)?.current;
  return a && a.kind === HOLD_KIND() && a.edge !== undefined ? a.edge : undefined;
};
let holdKindIndex = -1;
const HOLD_KIND = (): number =>
  holdKindIndex >= 0 ? holdKindIndex : (holdKindIndex = actionKindIndex(HOLD));

/** Players actively holding edge `key`, in entity order. */
export function holdersOf(w: SimWorld, key: number): number[] {
  if (!w.items) return [];
  const out: number[] = [];
  for (const eid of [...w.players.values()].sort((a, b) => a - b))
    if (holdingKey(w, eid) === key) out.push(eid);
  return out;
}

/** The edge player `eid` holds (undefined = none). */
export const heldDoor = (w: SimWorld, eid: number): number | undefined => holdingKey(w, eid);

let ending = false;

function emitHeld(
  w: SimWorld,
  eid: number,
  key: number,
  state: Extract<SimEvent, { type: 'doorHeld' }>['state'],
  units: number,
): void {
  const k = unpackKey(key);
  const v = openingView(w.openings, key, edgeAt(gridOf(w), w, key % 2, k.tx, k.ty, k.z).kind);
  w.events.push({
    type: 'doorHeld',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    tx: k.tx,
    ty: k.ty,
    z: k.z,
    side: v.side,
    state,
    units: Math.round(units * 10) / 10,
  });
}

/** Ends the hold of `eid` with `state` (one `doorHeld`, then `actionInterrupted`). */
function endHold(
  w: SimWorld,
  eid: number,
  key: number,
  state: 'released' | 'exhausted' | 'overpowered' | 'interrupted',
  reason: 'cancelled' | 'hit' | 'target-lost',
  units = 0,
): void {
  emitHeld(w, eid, key, state, units);
  ending = true;
  try {
    interruptActions(w, eid, reason);
  } finally {
    ending = false;
  }
}

export function registerHoldDoorAction(): void {
  registerAction(HOLD, {
    validate: (w, eid, a) =>
      a.edge === undefined ? 'invalid-target' : checkHoldDoor(w, eid, a.edge).reason,
    // Endurance may be low at the end; the door must still be there and in reach.
    validateEnd: (w, eid, a) => {
      if (a.edge === undefined) return 'invalid-target';
      const r = checkHoldDoor(w, eid, a.edge).reason;
      return r === 'tired' ? undefined : r;
    },
    durationMin: () => 0,
    ticks: (w) => w.physics.cfg.crowd.holdMaxTicks,
    ignore: ['threat'],
    begin(w, eid, a) {
      emitHeld(w, eid, a.edge!, 'holding', 0);
    },
    complete(w, eid, a) {
      emitHeld(w, eid, a.edge!, 'released', 0);
    },
    interrupted(w, eid, a) {
      if (!ending && a.edge !== undefined) emitHeld(w, eid, a.edge, 'interrupted', 0);
    },
  });
}

/** `sim.holdDoor`: starts the timed action (undefined = started / queued, else the reason). */
export function startHoldDoor(
  w: SimWorld,
  eid: number,
  ref: DoorRef,
): CommandRejectReason | undefined {
  const key = doorKey(w, eid, ref);
  const c = checkHoldDoor(w, eid, key);
  if (!c.ok) return c.reason;
  if (holdingKey(w, eid) === key) return 'busy';
  return startAction(w, eid, newAction(HOLD, { edge: key }));
}

/** `sim.releaseDoor`: lets go (`doorHeld released`); `invalid-state` when not holding. */
export function releaseDoor(w: SimWorld, eid: number): CommandRejectReason | undefined {
  const key = holdingKey(w, eid);
  if (key === undefined) return 'invalid-state';
  endHold(w, eid, key, 'released', 'cancelled');
  return undefined;
}

/**
 * Crowd pulse hook (`crowd.ts`): holders of `key` pay endurance for the pressing `units`; net
 * pressure over the hold staggers / knocks them down (`sign`: side of the crowd).
 */
export function holdPulse(
  w: SimWorld,
  key: number,
  sign: number,
  units: number,
  net: number,
): void {
  const cc = w.physics.cfg.crowd;
  const holders = holdersOf(w, key);
  if (!holders.length) return;
  const sec = cc.pulseTicks / PHYS_TICKS_PER_SECOND;
  const v = w.survival?.vitals;
  for (const eid of holders) {
    if (v)
      v.endurance[eid] = clampStat(
        (v.endurance[eid] ?? 100) - cc.holdEndurancePerUnit * units * sec,
      );
    if (net < cc.holdStaggerUnits) continue;
    const knock = net >= cc.holdKnockUnits;
    const pw = w.physics;
    const b = pw.bodies.get(w.c.StableId.value[eid] ?? 0);
    if (b) {
      const d = pw.cfg.durations;
      const dur = knock
        ? pw.rng.int(d.knockdownPlayer.min, d.knockdownPlayer.max)
        : d.staggerBase + Math.round(0.5 * d.staggerPerImpulse);
      setState(b, knock ? 'knockdown' : 'stagger', w.tick, dur);
      // Thrown back into the room, away from the door.
      const side = key % 2;
      const dirX = side === 1 ? -sign : 0;
      const dirY = side === 0 ? -sign : 0;
      const imp = Math.fround(knock ? 0.6 : 0.3);
      b.knockback = { dirX, dirY, strength: imp };
      const s = imp * pw.cfg.knockback.maxSpeed;
      b.vel = { x: Math.fround(dirX * s), y: Math.fround(dirY * s) };
      b.lastHitTick = w.tick;
      w.events.push({
        type: 'physics',
        tick: w.tick,
        kind: knock ? 'fellDown' : 'staggered',
        entity: b.id,
      });
    }
    endHold(w, eid, key, 'overpowered', 'hit', net);
  }
}

/**
 * Per tick (after crowd pressure): base endurance drain of every holder; the hold ends when
 * endurance runs out (`exhausted`), the holder lost control (`interrupted`: hit, staggered) or
 * the door was opened / broken / left (`released`).
 */
export function holdDoorSystem(w: SimWorld): void {
  const cc = w.physics.cfg.crowd;
  if (!w.items) return;
  const v = w.survival?.vitals;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const key = holdingKey(w, eid);
    if (key === undefined) continue;
    const b = w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
    if (b && !canAct(b.state)) {
      endHold(w, eid, key, 'interrupted', 'hit');
      continue;
    }
    if (v)
      v.endurance[eid] = clampStat(
        (v.endurance[eid] ?? 100) - cc.holdEndurancePerSec / PHYS_TICKS_PER_SECOND,
      );
    const r = checkHoldDoor(w, eid, key).reason;
    if (r === 'tired') endHold(w, eid, key, 'exhausted', 'cancelled');
    else if (r) endHold(w, eid, key, 'released', 'target-lost');
  }
}
