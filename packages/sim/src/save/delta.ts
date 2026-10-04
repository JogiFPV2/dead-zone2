import { Rng } from '../core/rng.js';
import { ChunkLoot, rebuildLodDerived, type LodWorld } from '../lod/state.js';
import { fromBase64, toBase64 } from './codec.js';

/**
 * Compact codecs for the world delta (docs 9.24): small unsigned integers as LEB128 varints with
 * runs of zeros folded (`0, runLength`), base64 like the map contracts. A 250×250 cell grid of
 * zombie counters or a chunk bitmap of a mostly untouched world is a few kB before gzip.
 */
export function encodeZeroRle(values: ArrayLike<number>): string {
  const out: number[] = [];
  const varint = (v: number): void => {
    let x = v >>> 0;
    while (x >= 0x80) {
      out.push((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    out.push(x);
  };
  for (let i = 0; i < values.length;) {
    const v = values[i]!;
    if (v !== 0) {
      varint(v);
      i++;
      continue;
    }
    let j = i;
    while (j < values.length && values[j] === 0) j++;
    varint(0);
    varint(j - i);
    i = j;
  }
  return toBase64(Uint8Array.from(out));
}

/** Decodes `encodeZeroRle` into `out` (exact length expected; throws on a mismatch). */
export function decodeZeroRle(s: string, out: Uint8Array | Uint16Array): void {
  const b = fromBase64(s);
  let p = 0;
  const varint = (): number => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (p >= b.length) throw new Error('save: truncated varint');
      const x = b[p++]!;
      v += (x & 0x7f) * 2 ** shift;
      if (x < 0x80) return v;
      shift += 7;
    }
  };
  let i = 0;
  out.fill(0);
  while (p < b.length) {
    const v = varint();
    if (v === 0) {
      i += varint();
      continue;
    }
    if (i >= out.length) throw new Error('save: delta longer than the world');
    out[i++] = v;
  }
  if (i !== out.length) throw new Error('save: delta size does not match the world');
}

/** LOD part of a save: cell counters, cell / chunk flags, chunk signatures, coarse noises. */
export interface LodSave {
  cellsW: number;
  cellsH: number;
  types: number;
  counts: string;
  active: string;
  epoch: string;
  /** Chunk loot flags (`ChunkLoot`); only `live` and `dirty` chunks are non-zero. */
  chunks: string;
  /** `[chunk, signature]` of live chunks. */
  sig: [number, number][];
  cellRng: [number, [number, number, number, number]][];
  damaged: [number, number[]][];
  lures: [number, number[]][];
  noises: number[][];
  /** Stair chunks in registration order (absent = none). */
  stairs?: number[];
  cursor: number;
  rng: [number, number, number, number];
}

export function encodeLod(lod: LodWorld): LodSave {
  const sorted = <T>(m: Map<number, T>): [number, T][] =>
    [...m.entries()].sort((a, b) => a[0] - b[0]);
  return {
    cellsW: lod.cellsW,
    cellsH: lod.cellsH,
    types: lod.types,
    counts: encodeZeroRle(lod.counts),
    active: encodeZeroRle(lod.active),
    epoch: encodeZeroRle(lod.epoch),
    chunks: encodeZeroRle(lod.chunkLoot),
    sig: sorted(lod.chunkSig),
    cellRng: sorted(lod.cellRng).map(([k, r]) => [k, r.state()]),
    damaged: sorted(lod.damaged).map(([k, v]) => [k, [...v]]),
    lures: sorted(lod.lures).map(([k, v]) => [k, [...v]]),
    noises: lod.noises.map((n) => [...n]),
    ...(lod.stairChunks.length > 0 ? { stairs: [...lod.stairChunks] } : {}),
    cursor: lod.cursor,
    rng: lod.rng.state(),
  };
}

/** Restores the LOD part (same world source and `simLod` grid as when saved, else throws). */
export function decodeLod(lod: LodWorld, s: LodSave): void {
  if (s.cellsW !== lod.cellsW || s.cellsH !== lod.cellsH || s.types !== lod.types)
    throw new Error('save: LOD grid differs (world size, cellSizeChunks or zombie types)');
  decodeZeroRle(s.counts, lod.counts);
  decodeZeroRle(s.active, lod.active);
  decodeZeroRle(s.epoch, lod.epoch);
  decodeZeroRle(s.chunks, lod.chunkLoot);
  lod.chunkSig.clear();
  for (const [k, v] of s.sig) lod.chunkSig.set(k, v);
  lod.cellRng.clear();
  for (const [k, st] of s.cellRng) lod.cellRng.set(k, new Rng(st));
  lod.damaged.clear();
  for (const [k, v] of s.damaged) lod.damaged.set(k, [...v]);
  lod.lures.clear();
  for (const [k, v] of s.lures) lod.lures.set(k, [...v]);
  lod.noises = s.noises.map((n) => [...n]);
  lod.stairChunks.length = 0;
  lod.stairChunks.push(...(s.stairs ?? []));
  lod.cursor = s.cursor;
  lod.rng = new Rng(s.rng);
  for (let i = 0; i < lod.chunkLoot.length; i++)
    if ((lod.chunkLoot[i] ?? 0) > ChunkLoot.dirty) throw new Error('save: bad chunk flag');
  rebuildLodDerived(lod);
}
