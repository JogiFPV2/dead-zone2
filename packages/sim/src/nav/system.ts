import { sortedQuery, type SimWorld } from '../core/world.js';
import { ZombieState, type Path } from '../ai/state.js';
import type { TileGrid } from '../world/grid.js';
import { findPath } from './astar.js';
import { buildFlowField } from './flow.js';
import { floorZ } from '../world/levels.js';

/** Queues an A* request for a zombie towards tile (gx, gy) (no-op when one is pending or cached). */
export function requestPath(w: SimWorld, eid: number, gx: number, gy: number): Path {
  const ai = w.ai!;
  const cur = ai.paths.get(eid);
  if (cur && cur.goalTx === gx && cur.goalTy === gy) return cur;
  const p: Path = cur ?? {
    goalTx: gx,
    goalTy: gy,
    tiles: new Int32Array(0),
    len: 0,
    cursor: 0,
    requestedTick: w.tick,
    status: 'pending',
  };
  const wasPending = cur?.status === 'pending';
  p.goalTx = gx;
  p.goalTy = gy;
  p.len = 0;
  p.cursor = 0;
  p.requestedTick = w.tick;
  p.status = 'pending';
  ai.paths.set(eid, p);
  if (!wasPending) ai.pathQueue.push(eid);
  return p;
}

/**
 * Pipeline `nav` (docs 2.5): flow fields for chased players (rebuilt when the player changes tile,
 * at most every `ai.flowEveryTicks`), then A* requests FIFO within `ai.navBudgetPerTick` node
 * expansions. A request that does not fit the remaining budget waits for the next tick; one that
 * exceeds `ai.navMaxNodesPerRequest` fails (the zombie steers straight and retries when stuck).
 */
export function navSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai || ai.zombieCount === 0) return;
  const cfg = ai.cfg.ai;
  const { Position, StableId, Zombie } = w.c;

  // Flow fields for players chased by at least one zombie that cannot walk straight.
  const chased = new Set<number>();
  for (const eid of sortedQuery(w, 'zombies', [Zombie])) {
    if (Zombie.state[eid] === ZombieState.chase && !ai.direct[eid])
      chased.add(Zombie.targetId[eid] ?? 0);
  }
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const sid = StableId.value[eid] ?? 0;
    if (!chased.has(sid)) {
      ai.flows.delete(eid);
      continue;
    }
    const tx = Math.floor(Position.x[eid] ?? 0);
    const ty = Math.floor(Position.y[eid] ?? 0);
    const z = floorZ(w, eid);
    const f = ai.flows.get(eid);
    if (f && f.targetTx === tx && f.targetTy === ty && f.z === z) continue;
    if (f && w.tick - f.builtTick < cfg.flowEveryTicks) continue;
    ai.flows.set(eid, buildFlowField(f, grid, z, tx, ty, cfg.flowWindowTiles, w.tick));
  }

  // A* requests.
  let budget = cfg.navBudgetPerTick;
  let i = 0;
  for (; i < ai.pathQueue.length; i++) {
    const eid = ai.pathQueue[i]!;
    const p = ai.paths.get(eid);
    if (!p || p.status !== 'pending' || !Zombie.is[eid]) continue;
    const max = Math.min(cfg.navMaxNodesPerRequest, budget);
    if (max < cfg.navMaxNodesPerRequest && i > 0) break;
    const z = floorZ(w, eid);
    const r = findPath(
      grid,
      z,
      Math.floor(Position.x[eid] ?? 0),
      Math.floor(Position.y[eid] ?? 0),
      p.goalTx,
      p.goalTy,
      max,
    );
    budget -= Math.max(1, r.expanded);
    if (r.tiles) {
      p.tiles = r.tiles;
      p.len = r.tiles.length / 2;
      p.cursor = 0;
      p.status = 'ready';
    } else {
      p.status = 'failed';
    }
    if (budget <= 0) {
      i++;
      break;
    }
  }
  if (i > 0) ai.pathQueue = ai.pathQueue.slice(i);
}
