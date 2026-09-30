import { sortedQuery, type SimWorld } from '../core/world.js';
import { requestPath } from '../nav/system.js';
import { flowStep } from '../nav/flow.js';
import type { TileGrid } from '../world/grid.js';
import { findPlayer } from './brain.js';
import { ZombieState } from './state.js';

/**
 * Pipeline `ai.locomotion` (docs 2.5): turns the zombie's goal into a move intent for the shared
 * `movement` system (same collisions as the player, so zombies never pass walls). Chasers read
 * the player's flow field, others walk straight when the line is clear or follow a cached A*
 * path. Neighbours push each other apart softly (spatial hash). Speed: chase and investigate
 * use `chaseTilesPerSec`, the rest `wanderTilesPerSec` (× spawn spread).
 */
export function aiLocomotionSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai || ai.zombieCount === 0) return;
  const { Position, MoveIntent, MoveStats, AimIntent, Zombie, Collider } = w.c;
  const cfg = ai.cfg.ai;
  const sep = cfg.separationTiles;
  for (const eid of sortedQuery(w, 'zombies', [Zombie])) {
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    const z = Position.z[eid] ?? 0;
    const state = Zombie.state[eid] ?? 0;
    const type = ai.types[Zombie.type[eid] ?? 0]!;

    // Progress since the last tick (stuck detection).
    const speed = MoveStats.speedPerTick[eid] ?? 0;
    const wanted = (MoveIntent.dx[eid] ?? 0) !== 0 || (MoveIntent.dy[eid] ?? 0) !== 0;
    const mx = x - (ai.lastX[eid] ?? x);
    const my = y - (ai.lastY[eid] ?? y);
    if (wanted && mx * mx + my * my < speed * speed * 0.04) {
      Zombie.stuck[eid] = Math.min(0xffff, (Zombie.stuck[eid] ?? 0) + 1);
      if (Zombie.stuck[eid] === cfg.stuckTicks) {
        // Re-plan from here: drop the cached path and the straight-line shortcut.
        ai.paths.delete(eid);
        ai.direct[eid] = 0;
      }
    } else if (wanted) Zombie.stuck[eid] = 0;
    ai.lastX[eid] = x;
    ai.lastY[eid] = y;

    // Staggered by a hit or a shove (combat): stands still.
    if (w.tick < (ai.combat.staggerUntil[eid] ?? 0)) {
      MoveIntent.dx[eid] = 0;
      MoveIntent.dy[eid] = 0;
      continue;
    }
    let gx = Zombie.tx[eid] ?? x;
    let gy = Zombie.ty[eid] ?? y;
    let dx = 0;
    let dy = 0;
    AimIntent.active[eid] = 0;
    const moving =
      state === ZombieState.wander ||
      state === ZombieState.chase ||
      state === ZombieState.search ||
      (state === ZombieState.investigate && (Zombie.stateTick[eid] ?? 0) === 0);
    if (moving) {
      if (state === ZombieState.chase) {
        const p = findPlayer(w, Zombie.targetId[eid] ?? 0);
        if (p !== undefined) {
          const px = Position.x[p] ?? 0;
          const py = Position.y[p] ?? 0;
          const rx = px - x;
          const ry = py - y;
          const reach = cfg.reachTiles + (Collider.radius[p] ?? 0);
          if (rx * rx + ry * ry <= reach * reach) {
            // In reach: stop and face the player (attacks come with combat).
            AimIntent.x[eid] = Math.fround(px);
            AimIntent.y[eid] = Math.fround(py);
            AimIntent.active[eid] = 1;
            gx = x;
            gy = y;
          }
        }
      }
      const ex = gx - x;
      const ey = gy - y;
      const d2 = ex * ex + ey * ey;
      if (d2 > 0.01) {
        let wx = gx;
        let wy = gy;
        const stuck = (Zombie.stuck[eid] ?? 0) >= cfg.stuckTicks;
        if (!ai.direct[eid]) {
          const tx = Math.floor(x);
          const ty = Math.floor(y);
          const f = state === ZombieState.chase ? flowFor(w, eid) : undefined;
          const step = f ? flowStep(f, grid, tx, ty) : undefined;
          if (step && !stuck) {
            wx = step.x + 0.5;
            wy = step.y + 0.5;
          } else {
            const path = requestPath(w, eid, Math.floor(gx), Math.floor(gy));
            if (path.status === 'ready') {
              while (path.cursor < path.len) {
                const cx = path.tiles[path.cursor * 2]! + 0.5;
                const cy = path.tiles[path.cursor * 2 + 1]! + 0.5;
                const qx = cx - x;
                const qy = cy - y;
                if (qx * qx + qy * qy > 0.35 * 0.35) break;
                path.cursor++;
              }
              if (path.cursor < path.len) {
                wx = path.tiles[path.cursor * 2]! + 0.5;
                wy = path.tiles[path.cursor * 2 + 1]! + 0.5;
              }
            } else if (path.status === 'failed' && (Zombie.stuck[eid] ?? 0) >= cfg.stuckTicks * 2) {
              // Unreachable: give up the goal (chasers keep trying through their memory).
              if (state !== ZombieState.chase) {
                Zombie.tx[eid] = Math.fround(x);
                Zombie.ty[eid] = Math.fround(y);
              }
              ai.paths.delete(eid);
              Zombie.stuck[eid] = 0;
            }
          }
        }
        const vx = wx - x;
        const vy = wy - y;
        const len = Math.sqrt(vx * vx + vy * vy);
        if (len > 1e-6) {
          dx = vx / len;
          dy = vy / len;
        }
      }
      // Soft separation from neighbours.
      if (dx !== 0 || dy !== 0) {
        let sx = 0;
        let sy = 0;
        ai.spatial.query(x, y, sep, (o) => {
          if (o === eid || (Position.z[o] ?? 0) !== z) return;
          const ox = x - (Position.x[o] ?? 0);
          const oy = y - (Position.y[o] ?? 0);
          const od2 = ox * ox + oy * oy;
          if (od2 >= sep * sep || od2 === 0) return;
          const od = Math.sqrt(od2);
          const k = (1 - od / sep) / od;
          sx += ox * k;
          sy += oy * k;
        });
        dx += sx;
        dy += sy;
        const l2 = dx * dx + dy * dy;
        if (l2 > 1) {
          const inv = 1 / Math.sqrt(l2);
          dx *= inv;
          dy *= inv;
        }
      }
    }
    MoveIntent.dx[eid] = Math.fround(dx);
    MoveIntent.dy[eid] = Math.fround(dy);
    const fast = state === ZombieState.chase || state === ZombieState.investigate;
    MoveStats.speedPerTick[eid] = Math.fround(
      (fast ? type.chasePerTick : type.wanderPerTick) * (Zombie.speedMul[eid] ?? 1),
    );
  }
}

function flowFor(w: SimWorld, eid: number) {
  const p = findPlayer(w, w.c.Zombie.targetId[eid] ?? 0);
  return p === undefined ? undefined : w.ai?.flows.get(p);
}
