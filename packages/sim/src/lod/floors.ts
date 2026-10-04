import type { SimMap } from '@deadzone/protocol';
import { HashWriter, xxhash32 } from '../core/hash.js';
import { deriveSeed, Rng } from '../core/rng.js';
import { DEFAULT_SIM_LOD, levelCounts, pruneFloors, type LodWorld } from './state.js';

/**
 * Far simulation on several levels (docs 9.39). The ground keeps its counter (`lod.counts`, the
 * pre-floors layout); the other levels are sparse per-cell counters (`lod.floors`). A cell's
 * start population waits on the ground until the cell is activated for the first time; then it is
 * split over the levels by floor area (`resolveCell`) and the cell's stair mask is remembered
 * (`lod.links`). Vertical drift happens only through levels joined by stairs in that cell.
 */

type At = [Uint16Array, number];

const floorsCfg = (lod: LodWorld) => lod.cfg.floors ?? DEFAULT_SIM_LOD.floors;

const bit = (mask: number, k: number): boolean => k >= 0 && k < 31 && ((mask >>> k) & 1) === 1;

function total(lod: LodWorld, at: At | undefined): number {
  if (!at) return 0;
  let n = 0;
  for (let t = 0; t < lod.types; t++) n += at[0][at[1] + t] ?? 0;
  return n;
}

/**
 * Moves up to `k` zombies from one counter to another, types picked by count (`lod.rng`, same
 * draws as the pre-floors cell drift). Returns how many moved.
 */
export function moveBetween(lod: LodWorld, from: At, to: At, k: number): number {
  let left = total(lod, from);
  let moved = 0;
  for (; moved < k && left > 0; moved++) {
    let r = lod.types > 1 ? lod.rng.int(0, left - 1) : 0;
    let t = 0;
    for (; t < lod.types; t++) {
      r -= from[0][from[1] + t] ?? 0;
      if (r < 0) break;
    }
    t = Math.min(t, lod.types - 1);
    const dst = to[1] + t;
    if ((to[0][dst] ?? 0) >= 0xffff) break;
    from[0][from[1] + t] = (from[0][from[1] + t] ?? 0) - 1;
    to[0][dst] = (to[0][dst] ?? 0) + 1;
    left--;
  }
  return moved;
}

/**
 * First activation of a cell on a multi-level world: reads its chunks on every level, splits the
 * ground counter over the levels (weight = floor tiles, `floors.weight` per tile off the ground;
 * own RNG stream per cell) and stores the stair mask. No-op on single-level worlds and for cells
 * already split (also after a load: `links` is saved).
 */
export function resolveCell(lod: LodWorld, map: Pick<SimMap, 'getChunk'>, cell: number): void {
  if (lod.levels === 1 || lod.links.has(cell)) return;
  const { cx0, cy0, cx1, cy1, z0 } = lod.bounds;
  const s = lod.cfg.cellSizeChunks;
  const bx = cx0 + (cell % lod.cellsW) * s;
  const by = cy0 + Math.floor(cell / lod.cellsW) * s;
  const weights = new Array<number>(lod.levels).fill(0);
  const per = Math.round(floorsCfg(lod).weight * 100);
  let mask = 0;
  for (let cy = by; cy < by + s && cy <= cy1; cy++) {
    for (let cx = bx; cx < bx + s && cx <= cx1; cx++) {
      for (let k = 0; k < lod.levels; k++) {
        const z = z0 + k;
        const ch = map.getChunk(cx, cy, z);
        if (!ch) continue;
        if (ch.stairs?.length && k < 31) mask |= 1 << k;
        let n = 0;
        const fl = ch.floor;
        for (let i = 0; i < fl.length; i++) if (fl[i]! > 0) n++;
        weights[k]! += z === 0 ? n * 100 : n * per;
      }
    }
  }
  lod.links.set(cell, mask >>> 0);
  const g = -z0;
  if (g < 0 || g >= lod.levels) return;
  let off = 0;
  for (let k = 0; k < lod.levels; k++) if (k !== g) off += weights[k]!;
  if (off === 0) return;
  const rng = Rng.fromSeed(deriveSeed(lod.source.seed, 'lod-floors', cell));
  for (let t = 0; t < lod.types; t++) {
    const gi = cell * lod.types + t;
    const n = lod.counts[gi] ?? 0;
    for (let j = 0; j < n; j++) {
      const k = rng.pickWeighted(weights);
      if (k < 0 || k === g) continue;
      const at = levelCounts(lod, cell, z0 + k, true)!;
      if ((at[0][at[1] + t] ?? 0) >= 0xffff) continue;
      at[0][at[1] + t]!++;
      lod.counts[gi]!--;
    }
  }
}

/**
 * Coarse vertical step of an inactive cell (part of the sweep). With a loud noise in reach
 * (`pulled`) every level sends `noise.pullFraction` one level towards the ground; otherwise with
 * `drift.chance` one occupied level sends `drift.fraction` one level up (`floors.upShare`) or
 * down. Only along stairs of the cell (`lod.links`).
 */
export function floorDrift(lod: LodWorld, cell: number, pulled: boolean): void {
  const mask = lod.links.get(cell) ?? 0;
  if (mask === 0) return;
  const z0 = lod.bounds.z0;
  const g = -z0;
  const at = (k: number, create: boolean) => levelCounts(lod, cell, z0 + k, create);
  if (pulled) {
    const frac = lod.cfg.noise.pullFraction;
    // Outwards from the ground, so nobody moves twice in one step.
    for (let k = g + 1; k < lod.levels; k++) {
      const n = total(lod, at(k, false));
      if (n > 0 && bit(mask, k - 1))
        moveBetween(lod, at(k, false)!, at(k - 1, true)!, Math.ceil(n * frac));
    }
    for (let k = g - 1; k >= 0; k--) {
      const n = total(lod, at(k, false));
      if (n > 0 && bit(mask, k))
        moveBetween(lod, at(k, false)!, at(k + 1, true)!, Math.ceil(n * frac));
    }
    pruneFloors(lod, cell);
    return;
  }
  if (!lod.rng.chance(lod.cfg.drift.chance)) return;
  const from: number[] = [];
  for (let k = 0; k < lod.levels; k++) {
    if ((bit(mask, k) && k + 1 < lod.levels) || bit(mask, k - 1)) {
      if (total(lod, at(k, false)) > 0) from.push(k);
    }
  }
  if (from.length === 0) return;
  const k = from[lod.rng.int(0, from.length - 1)]!;
  const canUp = bit(mask, k) && k + 1 < lod.levels;
  const canDown = bit(mask, k - 1);
  const up = canUp && (!canDown || lod.rng.chance(floorsCfg(lod).upShare));
  const src = at(k, false)!;
  moveBetween(
    lod,
    src,
    at(up ? k + 1 : k - 1, true)!,
    Math.ceil(total(lod, src) * lod.cfg.drift.fraction),
  );
  pruneFloors(lod, cell);
}

/**
 * Level and type of the next pending zombie of an active cell: without floor counters the first
 * ground type with zombies (pre-floors order, no RNG), else picked by count with the cell RNG.
 */
export function nextSpawn(
  lod: LodWorld,
  cell: number,
  rng: Rng,
): { z: number; type: number } | undefined {
  const f = lod.floors.get(cell);
  const o = cell * lod.types;
  if (!f) {
    for (let t = 0; t < lod.types; t++) if ((lod.counts[o + t] ?? 0) > 0) return { z: 0, type: t };
    return undefined;
  }
  let n = 0;
  for (let t = 0; t < lod.types; t++) n += lod.counts[o + t] ?? 0;
  for (let i = 0; i < f.length; i++) n += f[i]!;
  if (n === 0) return undefined;
  let r = rng.int(0, n - 1);
  for (let t = 0; t < lod.types; t++) {
    r -= lod.counts[o + t] ?? 0;
    if (r < 0) return { z: 0, type: t };
  }
  for (let i = 0; i < f.length; i++) {
    r -= f[i]!;
    if (r < 0) return { z: lod.bounds.z0 + Math.floor(i / lod.types), type: i % lod.types };
  }
  return undefined;
}

/** Takes one zombie of (level, type) off the cell's counter (after a successful spawn). */
export function takeSpawn(lod: LodWorld, cell: number, z: number, type: number): void {
  const at = levelCounts(lod, cell, z, false);
  if (!at) return;
  const i = at[1] + type;
  if ((at[0][i] ?? 0) > 0) at[0][i]!--;
  if (z !== 0) pruneFloors(lod, cell);
}

const bytesOf = (a: Uint16Array): Uint8Array =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Floor counters and stair masks in the state hash (multi-level worlds only: goldens stay). */
export function hashFloors(lod: LodWorld, h: HashWriter): void {
  if (lod.levels === 1) return;
  const sub = new HashWriter();
  sub.u32(0x10d0_0003).u32(lod.floors.size);
  for (const k of [...lod.floors.keys()].sort((a, b) => a - b))
    sub.u32(k).u32(xxhash32(bytesOf(lod.floors.get(k)!)));
  sub.u32(lod.links.size);
  for (const k of [...lod.links.keys()].sort((a, b) => a - b)) sub.u32(k).u32(lod.links.get(k)!);
  h.u32(sub.digest());
}
