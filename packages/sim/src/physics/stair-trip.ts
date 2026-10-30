import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { canMove, enduranceLevel, loadLevel } from './modifiers.js';
import { setState } from './reactions.js';
import { stairDomino, stairOf } from './stairs.js';
import { sortedBodies } from './step.js';
import type { PhysicsBody, PhysicsEvent } from './types.js';

/** BODY_PARTS indices of the legs (thighs, shins, feet). */
const LEG_PARTS = new Set([11, 12, 13, 14, 15, 16]);

/** Unhealed leg wounds of a player (each one makes a misstep likelier). */
function legWounds(w: SimWorld, b: PhysicsBody): number {
  const list = w.survival?.wounds.get(b.id);
  if (!list) return 0;
  let n = 0;
  for (const wd of list) if (LEG_PARTS.has(wd.part) && wd.healed < 1) n++;
  return n;
}

/**
 * Chance per tick that player body `b` running down a flight in gait `gait` (2 run, 3 sprint)
 * misses a step: `physics.stairs.runDownFallPerSec` / TPS (× `runDownSprintMul` in a sprint)
 * × (1 + load + endurance + leg wounds terms). Walking and sneaking never fall.
 */
export function stairFallChance(w: SimWorld, b: PhysicsBody, gait: number): number {
  if (gait < 2) return 0;
  const c = w.physics.cfg.stairs;
  const mul =
    1 +
    (c.runDownFallLoad[loadLevel(b.carriedKg, b.capacityKg)] ?? 0) +
    (c.runDownFallEndurance[enduranceLevel(b.endurance)] ?? 0) +
    legWounds(w, b) * c.runDownFallPerLegWound;
  const base = (c.runDownFallPerSec / TICKS_PER_SECOND) * (gait >= 3 ? c.runDownSprintMul : 1);
  return Math.fround(Math.min(1, base * mul));
}

/**
 * Players running / sprinting down a flight (`MoveStats.gait` ≥ 2, moving down it) may fall (one `rng.physics` draw per running-down body per tick,
 * in body order): knock-down for `runDownFallTicks`, pushed down the flight (`stairDomino` takes
 * the bodies below), events `tripped` + `fellDown`.
 */
export function stairRunFalls(
  w: SimWorld,
  eidBySid: ReadonlyMap<number, number>,
  events: PhysicsEvent[],
): void {
  const pw = w.physics;
  const c = pw.cfg.stairs;
  if (c.runDownFallPerSec <= 0) return;
  for (const b of sortedBodies(pw)) {
    const eid = eidBySid.get(b.id);
    if (b.kind !== 'player' || !b.stair || eid === undefined || !canMove(b.state)) continue;
    const gait = w.c.MoveStats.gait[eid] ?? 1;
    if (gait < 2) continue;
    const s = stairOf(w, b);
    if (!s) continue;
    const down = -(b.vel.x * s.dx + b.vel.y * s.dy);
    if (down <= 0) continue;
    if (pw.rng.nextFloat() >= stairFallChance(w, b, gait)) continue;
    setState(b, 'knockdown', w.tick, c.runDownFallTicks);
    b.knockback = { dirX: -s.dx, dirY: -s.dy, strength: c.runDownFallPush };
    b.lastHitTick = w.tick;
    b.vel = { x: 0, y: 0 };
    events.push({ type: 'tripped', entityId: b.id, tick: w.tick });
    events.push({ type: 'fellDown', entityId: b.id, tick: w.tick });
    stairDomino(w, b, events);
  }
}
