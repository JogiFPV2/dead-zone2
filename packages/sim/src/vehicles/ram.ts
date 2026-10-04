import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { damageZombie, killZombieByWorld } from '../combat/system.js';
import { physicsVehicleHit } from '../physics/system.js';
import type { TileGrid } from '../world/grid.js';
import type { Impact, UnderBody } from './collide.js';
import type { VehicleConfig } from './config.js';
import { playerEidOf } from './seats.js';
import type { Vehicle } from './types.js';

const DT = 1 / TICKS_PER_SECOND;
const f = Math.fround;

/** Reaction of a standing body rammed at `closing` m/s (thresholds in `VehicleConfig`). */
export function ramReaction(
  closing: number,
  cfg: VehicleConfig,
): 'push' | 'stagger' | 'knockdown' | 'kill' {
  if (closing >= cfg.ramKillSpeed) return 'kill';
  if (closing >= cfg.ramKnockdownSpeed) return 'knockdown';
  if (closing >= cfg.ramStaggerSpeed) return 'stagger';
  return 'push';
}

/** Kills zombie `zid` hit by car `v`: the driver gets the kill (`hit` source `vehicle`). */
function killZombie(w: SimWorld, grid: TileGrid, v: Vehicle, zid: number): void {
  const ai = w.ai;
  if (!ai || w.c.Zombie.is[zid] !== 1 || (w.c.Zombie.hp[zid] ?? 0) <= 0) return;
  const driver = v.occupants[0] ? playerEidOf(w, v.occupants[0]) : undefined;
  if (driver === undefined) killZombieByWorld(w, zid);
  else damageZombie(w, ai, ai.combat, grid, zid, driver, w.c.Zombie.hp[zid] ?? 0, 'vehicle');
}

/**
 * A standing player or zombie hit by a car (contact `hit`, closing speed `hit.closing`): stagger,
 * knock-down or (zombies) death by the speed thresholds, pushed away from the car. A body rammed
 * less than `ramCooldownTicks` ago is only pushed (the car is still shoving it along). Draws one
 * `rng.physics` value per reaction.
 */
export function ramBody(w: SimWorld, grid: TileGrid, hit: Impact, cfg: VehicleConfig): void {
  if (hit.eid < 0 || (hit.targetKind !== 'zombie' && hit.targetKind !== 'player')) return;
  const reaction = ramReaction(hit.closing, cfg);
  if (reaction === 'push') return;
  const b = w.physics.bodies.get(hit.target);
  if (b && b.lastHitTick > 0 && w.tick - b.lastHitTick < cfg.ramCooldownTicks) return;
  const zombie = hit.targetKind === 'zombie';
  const lethal = reaction === 'kill' && zombie;
  // The body flies away from the car: along the contact normal (n points into the car).
  physicsVehicleHit(
    w,
    hit.eid,
    hit.vehicle.id,
    reaction === 'stagger' ? 'stagger' : 'knockdown',
    -hit.nx,
    -hit.ny,
    hit.closing / cfg.ramKillSpeed,
    lethal,
  );
  if (lethal) killZombie(w, grid, hit.vehicle, hit.eid);
}

/**
 * Bodies under the wheels: the car loses `underWheelDecel` per body (never reversing), the wheel
 * nearest to the body bumps up, and a knocked-down zombie run over at `crushSpeed` or more dies.
 */
export function rollOver(w: SimWorld, grid: TileGrid, u: UnderBody, cfg: VehicleConfig): void {
  const v = u.vehicle;
  const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
  if (sp < 0.05) return;
  const k = Math.max(0, sp - cfg.underWheelDecel * DT) / sp;
  v.vx = f(v.vx * k);
  v.vy = f(v.vy * k);
  // Nearest wheel: front / rear by the body's position along the nose, left / right across it.
  const dx = u.x - v.x;
  const dy = u.y - v.y;
  const front = dx * v.hx + dy * v.hy >= 0;
  const right = -dx * v.hy + dy * v.hx >= 0;
  const wheel = (front ? 0 : 2) + (right ? 1 : 0);
  v.susp[wheel] = f(Math.min(1, (v.susp[wheel] ?? 0.5) + 0.35));
  if (u.down && u.zombie && sp >= cfg.crushSpeed) {
    physicsVehicleHit(w, u.eid, v.id, 'knockdown', v.vx / sp, v.vy / sp, 0, true);
    killZombie(w, grid, v, u.eid);
  }
}
