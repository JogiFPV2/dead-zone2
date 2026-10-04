import { HashWriter, xxhash32 } from '../core/hash.js';
import type { SimWorld } from '../core/world.js';

const bytesOf = (a: Uint8Array | Uint16Array): Uint8Array =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** LOD section of the state hash (absent without LOD, so small-map goldens stay valid). */
export function hashLod(w: SimWorld, h: HashWriter): void {
  const lod = w.lod;
  if (!lod && w.freeEids.length === 0 && w.interest.size === 0) return;
  h.u32(0x10d0_0001).u32(w.freeEids.length);
  for (const e of w.freeEids) h.u32(e);
  if (w.interest.size > 0) {
    h.u32(0x10d0_0002).u32(w.interest.size);
    for (const id of [...w.interest.keys()].sort((a, b) => a - b)) {
      const it = w.interest.get(id)!;
      h.u32(id)
        .u32(it.cx + 0x8000)
        .u32(it.cy + 0x8000)
        .u32(it.r);
    }
  }
  if (!lod) return;
  h.u32(xxhash32(bytesOf(lod.counts)))
    .u32(xxhash32(bytesOf(lod.active)))
    .u32(xxhash32(bytesOf(lod.epoch)))
    .u32(xxhash32(bytesOf(lod.chunkLoot)));
  h.u32(lod.cursor);
  for (const word of lod.rng.state()) h.u32(word);
  const sub = new HashWriter();
  for (const k of [...lod.chunkSig.keys()].sort((a, b) => a - b))
    sub.u32(k).u32(lod.chunkSig.get(k)!);
  for (const k of [...lod.cellRng.keys()].sort((a, b) => a - b)) {
    sub.u32(k);
    for (const word of lod.cellRng.get(k)!.state()) sub.u32(word);
  }
  for (const k of [...lod.damaged.keys()].sort((a, b) => a - b)) {
    const list = lod.damaged.get(k)!;
    sub.u32(k).u32(list.length);
    for (let i = 0; i < list.length; i += 2) sub.u32(list[i]!).f32(list[i + 1]!);
  }
  for (const k of [...lod.lures.keys()].sort((a, b) => a - b)) {
    const l = lod.lures.get(k)!;
    sub
      .u32(k)
      .f32(l[0]!)
      .f32(l[1]!)
      .u32((l[2]! | 0) + 128)
      .f32(l[3]!)
      .u32(l[4]!);
  }
  sub.u32(lod.noises.length);
  for (const n of lod.noises) sub.f32(n[0]!).f32(n[1]!).f32(n[2]!).f32(n[3]!).u32(n[4]!);
  h.u32(sub.digest());
}
