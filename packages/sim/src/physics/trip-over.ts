import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { tileKey } from '../items/store.js';
import { floorZ } from '../world/levels.js';
import { canMove, enduranceLevel, loadLevel } from './modifiers.js';
import { setState } from './reactions.js';
import { sortedBodies } from './step.js';
import type { PhysicsBody, PhysicsEvent } from './types.js';

/** BODY_PARTS indices of the legs (thighs, shins, feet). */
const LEG_PARTS = new Set([11, 12, 13, 14, 15, 16]);

const lying = (b: PhysicsBody) =>
  b.state === 'knockdown' || b.state === 'getup' || b.state === 'dead';

/** What lies under player body `b` (entity `eid`): a body, a ground pile, or nothing. */
export function underfoot(
  w: SimWorld,
  eid: number,
  b: PhysicsBody,
  bodies: readonly PhysicsBody[],
  eidBySid: ReadonlyMap<number, number>,
): 'body' | 'item' | undefined {
  const c = w.physics.cfg.tripOver;
  const reach = (w.c.Collider.radius[eid] ?? 0) + c.bodyReach;
  const z = floorZ(w, eid);
  for (const o of bodies) {
    const oe = eidBySid.get(o.id);
    if (o === b || oe === undefined || !lying(o)) continue;
    const dx = o.x - b.x;
    const dy = o.y - b.y;
    if (dx * dx + dy * dy <= reach * reach && floorZ(w, oe) === z) return 'body';
  }
  const st = w.items;
  if (st) {
    const id = st.ground.get(tileKey(Math.floor(b.x), Math.floor(b.y), z));
    const pile = id === undefined ? undefined : st.containers.get(id);
    if (pile && pile.items.length > 0) return 'item';
  }
  return undefined;
}

/**
 * Chance per tick of tripping over `what` in gait `gait` (2 run, 3 sprint; 0 below a run):
 * `tripOver.bodyPerSec` / `itemPerSec` / TPS (× `sprintMul`) × (1 + load + endurance + leg
 * wounds terms).
 */
export function tripOverChance(
  w: SimWorld,
  b: PhysicsBody,
  gait: number,
  what: 'body' | 'item',
): number {
  if (gait < 2) return 0;
  const c = w.physics.cfg.tripOver;
  let legs = 0;
  for (const wd of w.survival?.wounds.get(b.id) ?? [])
    if (LEG_PARTS.has(wd.part) && wd.healed < 1) legs++;
  const mul =
    1 +
    (c.load[loadLevel(b.carriedKg, b.capacityKg)] ?? 0) +
    (c.endurance[enduranceLevel(b.endurance)] ?? 0) +
    legs * c.perLegWound;
  const perSec = what === 'body' ? c.bodyPerSec : c.itemPerSec;
  const base = (perSec / TICKS_PER_SECOND) * (gait >= 3 ? c.sprintMul : 1);
  return Math.fround(Math.min(1, base * mul));
}

/**
 * Players running / sprinting (`MoveStats.gait` ≥ 2, moving, off the stairs) over a lying body or
 * a ground pile: one `rng.physics` draw per such player per tick (body order); a trip is a
 * knock-down for `tripOver.knockdownTicks`, thrown forward, events `tripped` + `fellDown`.
 */
export function tripOverSystem(
  w: SimWorld,
  eidBySid: ReadonlyMap<number, number>,
  events: PhysicsEvent[],
): void {
  const pw = w.physics;
  const c = pw.cfg.tripOver;
  const bodies = sortedBodies(pw);
  for (const b of bodies) {
    const eid = eidBySid.get(b.id);
    if (b.kind !== 'player' || eid === undefined || b.stair || !canMove(b.state)) continue;
    const gait = w.c.MoveStats.gait[eid] ?? 1;
    const sp2 = b.vel.x * b.vel.x + b.vel.y * b.vel.y;
    if (gait < 2 || sp2 <= 0) continue;
    const what = underfoot(w, eid, b, bodies, eidBySid);
    if (!what) continue;
    if (pw.rng.nextFloat() >= tripOverChance(w, b, gait, what)) continue;
    const sp = Math.sqrt(sp2);
    setState(b, 'knockdown', w.tick, c.knockdownTicks);
    b.knockback = { dirX: b.vel.x / sp, dirY: b.vel.y / sp, strength: c.push };
    b.lastHitTick = w.tick;
    b.vel = { x: 0, y: 0 };
    events.push({ type: 'tripped', entityId: b.id, tick: w.tick });
    events.push({ type: 'fellDown', entityId: b.id, tick: w.tick });
  }
}
