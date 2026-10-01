import { GAITS } from '@deadzone/protocol';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { ModSlot } from '../content/adapter.js';
import { atan2Bam } from '../core/dmath.js';
import { modded } from '../survival/state.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { moveCircle, type Vec2 } from '../world/collision.js';
import { EF } from '../openings/state.js';
import type { TileGrid } from '../world/grid.js';

const tmp: Vec2 = { x: 0, y: 0 };

/** Pipeline step 4: intent → velocity (tiles per tick) → collisions → position. */
export function movementSystem(w: SimWorld, grid: TileGrid): void {
  const { Position, Velocity, MoveIntent, MoveStats, Collider } = w.c;
  for (const eid of sortedQuery(w, 'movement', [
    Position,
    Velocity,
    MoveIntent,
    MoveStats,
    Collider,
  ])) {
    const s = w.survival;
    let speed = MoveStats.speedPerTick[eid] ?? 0;
    if (w.c.Zombie.is[eid]) {
      // Zombies: speed set by ai.locomotion, no survival modifiers.
    } else if (s && (s.asleep[eid] || s.dead[eid])) {
      // Asleep or dead: no movement (the held intent stays for after waking).
      speed = 0;
    } else {
      const gait = effectiveGait(w, eid);
      if (gait !== 'walk') {
        const g = (w.ai?.cfg ?? DEFAULT_STAGE4_CONFIG).gait;
        speed = Math.fround(speed * (gait === 'run' ? g.runSpeedMul : g.sneakSpeedMul));
      }
      if (s) {
        speed = Math.fround(modded(s, eid, ModSlot['move-speed'], speed) * (s.bagSpeed[eid] ?? 1));
      }
    }
    // Climbing through an open / broken window: slower (players and zombies).
    if (speed > 0 && nearSlowEdge(grid, eid, w)) {
      speed = Math.fround(speed * w.openings.cfg.windowSpeedMul);
    }
    const vx = Math.fround((MoveIntent.dx[eid] ?? 0) * speed);
    const vy = Math.fround((MoveIntent.dy[eid] ?? 0) * speed);
    Velocity.x[eid] = vx;
    Velocity.y[eid] = vy;
    if (vx === 0 && vy === 0) continue;
    const z = Position.z[eid] ?? 0;
    moveCircle(
      grid,
      z,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      vx,
      vy,
      Collider.radius[eid] ?? 0,
      tmp,
    );
    Position.x[eid] = tmp.x;
    Position.y[eid] = tmp.y;
  }
}

/** The entity's circle touches an open / broken window edge of its tile. */
function nearSlowEdge(grid: TileGrid, eid: number, w: SimWorld): boolean {
  if (w.openings.states.size === 0) return false;
  const x = w.c.Position.x[eid] ?? 0;
  const y = w.c.Position.y[eid] ?? 0;
  const z = w.c.Position.z[eid] ?? 0;
  const r = (w.c.Collider.radius[eid] ?? 0) + 0.05;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const slow = (f: number): boolean => (f & EF.slow) !== 0;
  return (
    (x - tx < r && slow(grid.flagsW(tx, ty, z))) ||
    (tx + 1 - x < r && slow(grid.flagsW(tx + 1, ty, z))) ||
    (y - ty < r && slow(grid.flagsN(tx, ty, z))) ||
    (ty + 1 - y < r && slow(grid.flagsN(tx, ty + 1, z)))
  );
}

/**
 * Facing after movement: towards the aim point when the entity has aimed at least once,
 * otherwise along the movement direction. Uses the deterministic atan2 (see core/dmath.ts).
 */
export function facingSystem(w: SimWorld): void {
  const { Position, Facing, AimIntent, Velocity } = w.c;
  for (const eid of sortedQuery(w, 'facing', [Position, Facing, AimIntent, Velocity])) {
    let dx: number;
    let dy: number;
    if (AimIntent.active[eid]) {
      dx = (AimIntent.x[eid] ?? 0) - (Position.x[eid] ?? 0);
      dy = (AimIntent.y[eid] ?? 0) - (Position.y[eid] ?? 0);
    } else {
      dx = Velocity.x[eid] ?? 0;
      dy = Velocity.y[eid] ?? 0;
    }
    if (dx !== 0 || dy !== 0) Facing.angle[eid] = atan2Bam(dy, dx);
  }
}

/** Gait of a player this tick: `run` needs endurance > 0 (with survival), else walks. */
export function effectiveGait(w: SimWorld, eid: number): (typeof GAITS)[number] {
  const gait = GAITS[w.c.MoveIntent.gait[eid] ?? 1] ?? 'walk';
  if (gait === 'run' && w.survival && (w.survival.vitals.endurance[eid] ?? 0) <= 0) return 'walk';
  return gait;
}
