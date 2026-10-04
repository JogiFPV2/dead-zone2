import { CHUNK_CHANGE_REASONS, CHUNK_SIZE, type ChunkChangeReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import type { ItemStore } from '../items/store.js';

/**
 * `chunkChanged` events (docs 9.24): tells the client streamer which chunks changed visibly, so
 * it rebuilds them (`streamer.invalidate(cx, cy)`). Openings mark their chunk directly
 * (`markChunk`); placed storage in ground piles is diffed at the end of a tick against the
 * previous one, only when the item store changed (`ItemStore.version`). Loose loot on the ground
 * emits nothing (the client gets piles in the view); the save delta does not depend on these
 * events (`releaseChunks` compares chunk signatures). Not state: not saved, not hashed, rebuilt
 * by `primeChunkWatch` after creation or a load.
 */
export interface ChunkWatch {
  /** Pending marks: chunk key → reason bits. */
  readonly marks: Map<number, number>;
  /** Ground pile id → [x, y, z, placed signature] at the last diff. */
  piles: Map<number, [number, number, number, number]>;
  /** `ItemStore.version` at the last diff (−1 = not primed). */
  version: number;
  /** Chunk columns (`colKey`) the LOD loaded or released this tick: generated state, no events. */
  readonly skip: Set<number>;
}

const BIT: Record<ChunkChangeReason, number> = { opening: 1, object: 2, loot: 4 };

export function createChunkWatch(): ChunkWatch {
  return { marks: new Map(), piles: new Map(), version: -1, skip: new Set() };
}

// Keys: chunk coords and level packed into one safe integer, ordered (z, cy, cx).
const OFF = 0x8000;
const chunkKey = (cx: number, cy: number, z: number): number =>
  ((z + 128) * 0x10000 + (cy + OFF)) * 0x10000 + (cx + OFF);
/** Chunk column key (any level) for `ChunkWatch.skip`. */
export const colKey = (cx: number, cy: number): number => (cy + OFF) * 0x10000 + (cx + OFF);

/** Marks the chunk of tile (tx, ty) on level z as changed for `reason` (once per tick). */
export function markChunk(
  w: SimWorld,
  tx: number,
  ty: number,
  z: number,
  reason: ChunkChangeReason,
): void {
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const k = chunkKey(cx, cy, z);
  w.chunkWatch.marks.set(k, (w.chunkWatch.marks.get(k) ?? 0) | BIT[reason]);
}

function mix(h: number, v: number): number {
  return Math.imul(h ^ v, 0x9e3779b1) >>> 0;
}

function snapshotPiles(st: ItemStore): ChunkWatch['piles'] {
  const out: ChunkWatch['piles'] = new Map();
  for (const c of st.containers.values()) {
    if (c.kind !== 'ground') continue;
    let placed = 1;
    for (const id of c.items) {
      if (st.items.get(id)?.placed) placed = mix(placed, id);
    }
    out.set(c.id, [c.x, c.y, c.z, placed]);
  }
  return out;
}

/** Baseline of the ground piles (after createSim / a load): no events for the initial state. */
export function primeChunkWatch(w: SimWorld): void {
  const cw = w.chunkWatch;
  cw.marks.clear();
  cw.skip.clear();
  cw.piles = w.items ? snapshotPiles(w.items) : (new Map() as ChunkWatch['piles']);
  cw.version = w.items?.version ?? 0;
}

/** End of tick: diffs ground piles and emits the pending `chunkChanged` events in key order. */
export function flushChunkEvents(w: SimWorld): void {
  const cw = w.chunkWatch;
  const st = w.items;
  if (st && st.version !== cw.version) {
    const next = snapshotPiles(st);
    const note = (x: number, y: number, z: number, bits: number): void => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      if (bits === 0 || cw.skip.has(colKey(cx, cy))) return;
      const k = chunkKey(cx, cy, z);
      cw.marks.set(k, (cw.marks.get(k) ?? 0) | bits);
    };
    for (const [id, n] of next) {
      const o = cw.piles.get(id);
      note(n[0], n[1], n[2], (o ? o[3] !== n[3] : n[3] !== 1) ? BIT.object : 0);
    }
    for (const [id, o] of cw.piles) {
      if (!next.has(id)) note(o[0], o[1], o[2], o[3] !== 1 ? BIT.object : 0);
    }
    cw.piles = next;
    cw.version = st.version;
  }
  cw.skip.clear();
  if (cw.marks.size === 0) return;
  for (const k of [...cw.marks.keys()].sort((a, b) => a - b)) {
    const bits = cw.marks.get(k)!;
    const cx = (k % 0x10000) - OFF;
    const cy = (Math.floor(k / 0x10000) % 0x10000) - OFF;
    const z = Math.floor(k / 0x1_0000_0000) - 128;
    for (const reason of CHUNK_CHANGE_REASONS) {
      if (bits & BIT[reason])
        w.events.push({ type: 'chunkChanged', tick: w.tick, cx, cy, z, reason });
    }
  }
  cw.marks.clear();
}
