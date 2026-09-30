import { ModSlot } from '../content/adapter.js';
import { atan2Bam } from '../core/dmath.js';
import { modded } from '../survival/state.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { moveCircle, type Vec2 } from '../world/collision.js';
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
    // Asleep or dead: no movement (the held intent stays for after waking).
    if (s && (s.asleep[eid] || s.dead[eid])) speed = 0;
    else if (s) {
      speed = Math.fround(modded(s, eid, ModSlot['move-speed'], speed) * (s.bagSpeed[eid] ?? 1));
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
