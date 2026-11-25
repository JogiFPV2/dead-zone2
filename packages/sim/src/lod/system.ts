import { CHUNK_SIZE, type SimZone } from '@deadzone/protocol';
import { hasComponent, removeComponent } from 'bitecs';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { deriveSeed, Rng } from '../core/rng.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { colKey } from '../world/chunk-events.js';
import { spawnZombie } from '../ai/zombies.js';
import { rebuildZones, ZombieState } from '../ai/state.js';
import { removeBody } from '../physics/step.js';
import { circleOverlaps } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { releaseChunks, spawnChunkLoot } from './chunks.js';
import { floorDrift, moveBetween, nextSpawn, resolveCell, takeSpawn } from './floors.js';
import {
  cellOfChunk,
  cellTotal,
  chunkIndex,
  ChunkLoot,
  groundTotal,
  levelCounts,
  registerStairs,
  type LodWorld,
} from './state.js';
import { floorZ } from '../world/levels.js';
import { safeStartActive, unsafeSpot } from './safe-start.js';

/** Zombies are checked for folding every this many ticks. */
const COLLAPSE_EVERY = 5;
/** Tries per zombie to find a free tile when spawning a cell (ground; other levels × 4). */
const SPAWN_TRIES = 12;
/** Most noises kept for coarse cells. */
const MAX_NOISES = 32;

/**
 * Pipeline step `lod` (right after `clock`, docs 9.24): keeps the detailed area around players
 * (union over players, Chebyshev radius in chunks with hysteresis), spawns loot in chunks that
 * enter it and releases unchanged chunks that leave it, folds zombies outside it into cell
 * counters and unfolds pending cell counters near players, and runs a slice of the coarse sweep
 * (drift, loud noises). No-op without LOD (small maps).
 */
export function lodSystem(w: SimWorld, grid: TileGrid): void {
  const lod = w.lod;
  const ai = w.ai;
  if (!lod || !ai) return;
  intakeNoises(w, lod);
  // Chunks that were not loaded yet: run the area update again (it is idempotent).
  if (lod.lootRetryAt !== undefined && w.tick >= lod.lootRetryAt) lod.playerKey = '';
  updateArea(w, lod, grid);
  if (w.tick % COLLAPSE_EVERY === 0) collapseFar(w, lod);
  spawnPending(w, lod, grid);
  coarseSweep(w, lod);
}

/** A centre of the detailed area: a player's chunk (radius `activeRadiusChunks`) or an interest. */
interface AreaCentre {
  cx: number;
  cy: number;
  r: number;
}

/** Player chunks (ascending player id), then `setInterest` areas (ascending player id). */
function areaCentres(w: SimWorld, R: number): AreaCentre[] {
  const out: AreaCentre[] = [];
  const { Position } = w.c;
  for (const eid of w.players.values()) {
    out.push({
      cx: Math.floor((Position.x[eid] ?? 0) / CHUNK_SIZE),
      cy: Math.floor((Position.y[eid] ?? 0) / CHUNK_SIZE),
      r: R,
    });
  }
  for (const id of [...w.interest.keys()].sort((a, b) => a - b)) {
    const it = w.interest.get(id)!;
    out.push({ cx: it.cx, cy: it.cy, r: it.r });
  }
  return out;
}

/**
 * How far the rect [x0..x1]×[y0..y1] lies outside the nearest centre's radius, in chunks
 * (Chebyshev; ≤ 0 = inside some centre's area).
 */
function rectDist(
  ps: readonly AreaCentre[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let best = Infinity;
  for (const p of ps) {
    const dx = Math.max(x0 - p.cx, 0, p.cx - x1);
    const dy = Math.max(y0 - p.cy, 0, p.cy - y1);
    best = Math.min(best, Math.max(dx, dy) - p.r);
  }
  return best;
}

/** Ticks between checks for chunk columns of a lazy world that were not loaded yet (1 s). */
const LOOT_RETRY_TICKS = 20;

/** Activates / deactivates cells and loot chunks when a player changed chunk or an interest changed. */
function updateArea(w: SimWorld, lod: LodWorld, grid: TileGrid): void {
  const R = lod.cfg.activeRadiusChunks;
  const ps = areaCentres(w, R);
  const key = ps.map((p) => `${p.cx},${p.cy},${p.r}`).join(';');
  if (key === lod.playerKey) return;
  lod.playerKey = key;
  const keepR = lod.cfg.hysteresisChunks;
  const s = lod.cfg.cellSizeChunks;
  const { cx0, cy0, cx1, cy1 } = lod.bounds;

  // Cells: deactivate beyond the hysteresis band (their zombies fold on the next check).
  const cellRect = (cell: number): [number, number, number, number] => {
    const x = cx0 + (cell % lod.cellsW) * s;
    const y = cy0 + Math.floor(cell / lod.cellsW) * s;
    return [x, y, Math.min(cx1, x + s - 1), Math.min(cy1, y + s - 1)];
  };
  const keepCells: number[] = [];
  for (const cell of lod.activeCells) {
    const [x0, y0, x1, y1] = cellRect(cell);
    if (rectDist(ps, x0, y0, x1, y1) <= keepR) keepCells.push(cell);
    else {
      lod.active[cell] = 0;
      lod.cellRng.delete(cell);
    }
  }
  // Activate cells within each centre's radius (window per centre, ascending cell order overall).
  const add = new Set<number>();
  for (const p of ps) {
    const c0 = cellOfChunk(lod, p.cx - p.r, p.cy - p.r);
    const c1 = cellOfChunk(lod, p.cx + p.r, p.cy + p.r);
    const xa = c0 % lod.cellsW;
    const ya = Math.floor(c0 / lod.cellsW);
    const xb = c1 % lod.cellsW;
    const yb = Math.floor(c1 / lod.cellsW);
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const cell = y * lod.cellsW + x;
        if (lod.active[cell]) continue;
        const [rx0, ry0, rx1, ry1] = cellRect(cell);
        if (rectDist(ps, rx0, ry0, rx1, ry1) <= 0) add.add(cell);
      }
    }
  }
  for (const cell of [...add].sort((a, b) => a - b)) {
    lod.active[cell] = 1;
    lod.epoch[cell] = ((lod.epoch[cell] ?? 0) + 1) & 0xffff;
    lod.cellRng.set(
      cell,
      Rng.fromSeed(deriveSeed(lod.source.seed, 'lod-cell', cell, lod.epoch[cell] ?? 0)),
    );
    keepCells.push(cell);
  }
  lod.activeCells = keepCells.sort((a, b) => a - b);
  // Split new cells over their levels (also cells active in a save from before floors).
  if (lod.levels > 1) for (const cell of lod.activeCells) resolveCell(lod, w.map, cell);

  // Loot chunks: same radii, chunk granularity.
  const release: number[] = [];
  const keepLive: number[] = [];
  for (const i of lod.liveChunks) {
    const cx = cx0 + (i % lod.wChunks);
    const cy = cy0 + Math.floor(i / lod.wChunks);
    if (rectDist(ps, cx, cy, cx, cy) <= keepR) keepLive.push(i);
    else release.push(i);
  }
  for (const i of release)
    w.chunkWatch.skip.add(colKey(cx0 + (i % lod.wChunks), cy0 + Math.floor(i / lod.wChunks)));
  releaseChunks(w, lod, release);
  const spawn = new Set<number>();
  let waiting = false;
  for (const p of ps) {
    for (let cy = Math.max(cy0, p.cy - p.r); cy <= Math.min(cy1, p.cy + p.r); cy++) {
      for (let cx = Math.max(cx0, p.cx - p.r); cx <= Math.min(cx1, p.cx + p.r); cx++) {
        const i = chunkIndex(lod, cx, cy);
        // Lazy world still loading this column (OSM tiles): no storage / stairs from an empty
        // placeholder; the area is checked again shortly (`LOOT_RETRY_TICKS`).
        if (w.map.ready && !w.map.ready(cx, cy)) {
          waiting = true;
          continue;
        }
        registerStairs(lod, grid, i);
        if (lod.chunkLoot[i] === ChunkLoot.none) spawn.add(i);
      }
    }
  }
  for (const i of [...spawn].sort((a, b) => a - b)) {
    w.chunkWatch.skip.add(colKey(cx0 + (i % lod.wChunks), cy0 + Math.floor(i / lod.wChunks)));
    spawnChunkLoot(w, lod, cx0 + (i % lod.wChunks), cy0 + Math.floor(i / lod.wChunks));
    keepLive.push(i);
  }
  lod.liveChunks = keepLive.sort((a, b) => a - b);
  lod.lootRetryAt = waiting ? w.tick + LOOT_RETRY_TICKS : undefined;
  syncChunkZones(w, lod);
}

/**
 * Lazy worlds (no `listChunks`): `SimChunk.zones` of live chunks (all levels) are in
 * `ai.chunkZones` exactly while the chunk is live; added on load, dropped on release.
 */
function syncChunkZones(w: SimWorld, lod: LodWorld): void {
  const ai = w.ai;
  if (!ai || w.map.listChunks) return;
  const live = new Set(lod.liveChunks);
  let changed = false;
  for (const k of [...ai.chunkZones.keys()]) {
    if (live.has(k)) continue;
    ai.chunkZones.delete(k);
    changed = true;
  }
  for (const i of lod.liveChunks) {
    if (ai.chunkZones.has(i)) continue;
    const cx = lod.bounds.cx0 + (i % lod.wChunks);
    const cy = lod.bounds.cy0 + Math.floor(i / lod.wChunks);
    const zones: SimZone[] = [];
    for (let z = lod.bounds.z0; z <= lod.bounds.z1; z++)
      zones.push(...(w.map.getChunk(cx, cy, z)?.zones ?? []));
    // Empty entries too: the chunk was checked (no lookups again while it stays live).
    ai.chunkZones.set(i, zones);
    if (zones.length > 0) changed = true;
  }
  if (changed) rebuildZones(ai);
}

/** Folds zombies standing in inactive cells into their cell's counter (keeps damaged hp). */
function collapseFar(w: SimWorld, lod: LodWorld): void {
  const { Position, Zombie } = w.c;
  const fold: number[] = [];
  for (const eid of sortedQuery(w, 'zombies', [Zombie])) {
    const cell = cellOfChunk(
      lod,
      Math.floor((Position.x[eid] ?? 0) / CHUNK_SIZE),
      Math.floor((Position.y[eid] ?? 0) / CHUNK_SIZE),
    );
    if (!lod.active[cell]) fold.push(eid);
  }
  for (const eid of fold) foldZombie(w, lod, eid);
}

/**
 * Folds one living zombie into its cell's counter (level counter off the ground; keeps damaged
 * hp) and removes the entity. The cell's pending count spawns it again later (if active).
 */
export function foldZombie(w: SimWorld, lod: LodWorld, eid: number): void {
  const ai = w.ai!;
  const { Position, Zombie } = w.c;
  const cell = cellOfChunk(
    lod,
    Math.floor((Position.x[eid] ?? 0) / CHUNK_SIZE),
    Math.floor((Position.y[eid] ?? 0) / CHUNK_SIZE),
  );
  const type = Math.min(lod.types - 1, Zombie.type[eid] ?? 0);
  // Off the ground: the zombie's level counter (split the cell first, so its start
  // population does not land on top of it later).
  const z = lod.levels > 1 ? floorZ(w, eid) : 0;
  if (z !== 0) resolveCell(lod, w.map, cell);
  const [arr, off] = levelCounts(lod, cell, z, true) ?? [lod.counts, cell * lod.types];
  const i = off + type;
  if ((arr[i] ?? 0) < 0xffff) {
    arr[i] = (arr[i] ?? 0) + 1;
    const hp = Zombie.hp[eid] ?? 0;
    const max = ai.types[type]?.def.health ?? hp;
    if (hp > 0 && hp < max && lod.cfg.keepDamagedPerCell > 0) {
      let list = lod.damaged.get(cell);
      if (!list) lod.damaged.set(cell, (list = []));
      if (list.length / 2 < lod.cfg.keepDamagedPerCell) list.push(type, Math.fround(hp));
    }
  }
  despawnZombie(w, eid);
}

/**
 * Removes a living zombie entity (LOD fold): physics body, path, every component, and puts the
 * eid into `w.freeEids` for the next spawn (bitecs never recycles it, so eids stay in step
 * after a load).
 */
export function despawnZombie(w: SimWorld, eid: number): void {
  const ai = w.ai;
  if (!ai || w.c.Zombie.is[eid] !== 1) return;
  removeBody(w.physics, w.c.StableId.value[eid] ?? 0);
  ai.paths.delete(eid);
  const qi = ai.pathQueue.indexOf(eid);
  if (qi >= 0) ai.pathQueue.splice(qi, 1);
  ai.combat.zombieReady[eid] = 0;
  ai.combat.zombieHitAt[eid] = 0;
  ai.combat.zombieNext[eid] = 0;
  ai.zombieCount--;
  for (const comp of Object.values(w.c)) {
    if (hasComponent(w.ecs, eid, comp)) removeComponent(w.ecs, eid, comp);
  }
  w.c.Zombie.is[eid] = 0;
  w.freeEids.push(eid);
  w.structureVersion++;
}

/** Unfolds pending zombies of active cells (budget per tick and `maxActiveZombies`). */
function spawnPending(w: SimWorld, lod: LodWorld, grid: TileGrid): void {
  const ai = w.ai!;
  let budget = Math.min(lod.cfg.maxSpawnPerTick, lod.cfg.maxActiveZombies - ai.zombieCount);
  if (budget <= 0) return;
  const players = [...w.players.values()];
  const { Position } = w.c;
  const minD2 = lod.cfg.minSpawnDistTiles * lod.cfg.minSpawnDistTiles;
  const safe = safeStartActive(w);
  const radius = ai.cfg.ai.zombieRadius;
  const s = lod.cfg.cellSizeChunks;
  const { cx0, cy0, cx1, cy1 } = lod.bounds;
  for (const cell of lod.activeCells) {
    if (budget <= 0) return;
    if (cellTotal(lod, cell) === 0) continue;
    const rng = lod.cellRng.get(cell);
    if (!rng) continue;
    const bx = cx0 + (cell % lod.cellsW) * s;
    const by = cy0 + Math.floor(cell / lod.cellsW) * s;
    const bw = Math.min(cx1, bx + s - 1) - bx + 1;
    const bh = Math.min(cy1, by + s - 1) - by + 1;
    while (budget > 0) {
      const next = nextSpawn(lod, cell, rng);
      if (!next) break;
      const { z, type } = next;
      let spot: { x: number; y: number } | undefined;
      const tries = z === 0 ? SPAWN_TRIES : SPAWN_TRIES * 4;
      for (let k = 0; k < tries && !spot; k++) {
        const x = (bx + rng.int(0, bw - 1)) * CHUNK_SIZE + rng.int(0, CHUNK_SIZE - 1) + 0.5;
        const y = (by + rng.int(0, bh - 1)) * CHUNK_SIZE + rng.int(0, CHUNK_SIZE - 1) + 0.5;
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        if (grid.isBlocked(tx, ty, z) || grid.stairAt(tx, ty, z)) continue;
        // Off the ground also not over a flight coming up from below.
        if (z !== 0 && grid.stairAt(tx, ty, z - 1)) continue;
        if (circleOverlaps(grid, z, x, y, radius)) continue;
        if (safe && unsafeSpot(w, grid, safe, x, y, z)) continue;
        let near = false;
        for (const p of players) {
          if (z !== 0 && floorZ(w, p) !== z) continue; // other levels: out of sight
          const dx = (Position.x[p] ?? 0) - x;
          const dy = (Position.y[p] ?? 0) - y;
          if (dx * dx + dy * dy < minD2) near = true;
        }
        if (!near) spot = { x, y };
      }
      if (!spot) break; // try again next tick (players move, the RNG advances)
      takeSpawn(lod, cell, z, type);
      const eid = spawnZombie(w, ai, type, spot.x, spot.y, z);
      const dmg = lod.damaged.get(cell);
      if (dmg) {
        for (let j = 0; j < dmg.length; j += 2) {
          if (dmg[j] !== type) continue;
          w.c.Zombie.hp[eid] = Math.fround(dmg[j + 1]!);
          dmg.splice(j, 2);
          break;
        }
        if (dmg.length === 0) lod.damaged.delete(cell);
      }
      const lure = lod.lures.get(cell);
      if (lure && w.tick < lure[4]!) {
        const Z = w.c.Zombie;
        Z.state[eid] = ZombieState.investigate;
        Z.targetId[eid] = 0;
        Z.tx[eid] = Math.fround(lure[0]!);
        Z.ty[eid] = Math.fround(lure[1]!);
        Z.tz[eid] = lure[2]!;
        Z.alert[eid] = Math.fround(lure[3]!);
        Z.stateTick[eid] = 0;
        Z.memoryUntil[eid] = 0;
      } else if (lure) lod.lures.delete(cell);
      budget--;
    }
  }
}

/** Loud noises of the last tick act on coarse cells for `noise.memorySec`. */
function intakeNoises(w: SimWorld, lod: LodWorld): void {
  const ai = w.ai!;
  const nc = lod.cfg.noise;
  for (const n of ai.noises) {
    if (n.tick !== w.tick - 1 || n.radius < nc.minRadiusTiles) continue;
    lod.noises.push([n.x, n.y, Math.fround(n.radius * nc.radiusMul), n.volume, n.tick]);
  }
  const keep = w.tick - Math.round(nc.memorySec * TICKS_PER_SECOND);
  if (lod.noises.length > 0 && (lod.noises[0]![4]! < keep || lod.noises.length > MAX_NOISES)) {
    lod.noises = lod.noises.filter((n) => n[4]! >= keep).slice(-MAX_NOISES);
  }
}

/**
 * A slice of the coarse sweep (all cells once per `coarseTickEvery` ticks): an inactive cell in
 * reach of a loud noise sends `pullFraction` of its zombies one cell towards it, otherwise with
 * `drift.chance` a `drift.fraction` drifts to a random neighbour. Zombies entering an active cell
 * wait there as pending spawns (and investigate the noise).
 */
function coarseSweep(w: SimWorld, lod: LodWorld): void {
  const cells = lod.active.length;
  const n = Math.ceil(cells / lod.cfg.coarseTickEvery);
  const s = lod.cfg.cellSizeChunks * CHUNK_SIZE;
  const memory = Math.round(lod.cfg.noise.memorySec * TICKS_PER_SECOND);
  for (let k = 0; k < n; k++) {
    const cell = lod.cursor;
    lod.cursor = (lod.cursor + 1) % cells;
    if (lod.active[cell]) continue;
    const total = groundTotal(lod, cell);
    const multi = lod.levels > 1 && lod.links.has(cell);
    if (total === 0 && !multi) continue;
    const gx = cell % lod.cellsW;
    const gy = Math.floor(cell / lod.cellsW);
    // Cell centre in world tiles.
    const x = lod.bounds.cx0 * CHUNK_SIZE + (gx + 0.5) * s;
    const y = lod.bounds.cy0 * CHUNK_SIZE + (gy + 0.5) * s;
    let pulled = false;
    for (let j = lod.noises.length - 1; j >= 0; j--) {
      const nz = lod.noises[j]!;
      const dx = nz[0]! - x;
      const dy = nz[1]! - y;
      if (dx * dx + dy * dy > nz[2]! * nz[2]!) continue;
      const tx = gx + Math.sign(Math.abs(dx) >= Math.abs(dy) ? Math.round(dx / s) : 0);
      const ty = gy + Math.sign(Math.abs(dx) >= Math.abs(dy) ? 0 : Math.round(dy / s));
      if (tx === gx && ty === gy) {
        pulled = true; // already at the noise
        break;
      }
      const moved = moveZombies(lod, cell, tx, ty, Math.ceil(total * lod.cfg.noise.pullFraction));
      const to = ty * lod.cellsW + tx;
      if (moved > 0 && lod.active[to])
        lod.lures.set(to, [nz[0]!, nz[1]!, 0, nz[3]!, nz[4]! + memory]);
      pulled = true;
      break;
    }
    if (multi) floorDrift(lod, cell, pulled);
    if (pulled || total === 0 || !lod.rng.chance(lod.cfg.drift.chance)) continue;
    const dir = lod.rng.int(0, 3);
    const tx = gx + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
    const ty = gy + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
    moveZombies(lod, cell, tx, ty, Math.ceil(total * lod.cfg.drift.fraction));
  }
}

/**
 * Moves up to `k` ground zombies (types picked by count, `lod.rng`) from `cell` to cell (tx, ty)
 * (horizontal drift stays on the ground; other levels move only through stairs, `floorDrift`).
 */
function moveZombies(lod: LodWorld, cell: number, tx: number, ty: number, k: number): number {
  if (tx < 0 || ty < 0 || tx >= lod.cellsW || ty >= lod.cellsH) return 0;
  const to = ty * lod.cellsW + tx;
  return moveBetween(lod, [lod.counts, cell * lod.types], [lod.counts, to * lod.types], k);
}
