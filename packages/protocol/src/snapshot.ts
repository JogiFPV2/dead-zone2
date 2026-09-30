/**
 * Render snapshot: a flat `Float32Array` over an `ArrayBuffer` (transferable), no header.
 *
 * Layout (all f32), SNAPSHOT_ENTITY_STRIDE floats per entity:
 * ```
 *   stableId, x, y, z, facingRad
 * ```
 * The first record is always the local player. The entity count is
 * `byteLength / (SNAPSHOT_ENTITY_STRIDE * 4)`, so pooled buffers are only reused when their size
 * matches exactly (the entity count changes rarely). `stableId` is exact up to 2^24 (f32 mantissa).
 * x/y are in tiles (+x east, +y south), z is the floor level, facingRad is in [0, 2π) measured
 * from +x towards +y (i.e. clockwise on screen when +y points down).
 */
export const SNAPSHOT_ENTITY_STRIDE = 5;
export const SnapshotField = { stableId: 0, x: 1, y: 2, z: 3, facingRad: 4 } as const;

export interface SnapshotEntity {
  stableId: number;
  x: number;
  y: number;
  z: number;
  facingRad: number;
}

export const snapshotFloatLength = (entityCount: number): number =>
  entityCount * SNAPSHOT_ENTITY_STRIDE;

export const snapshotByteLength = (entityCount: number): number =>
  snapshotFloatLength(entityCount) * Float32Array.BYTES_PER_ELEMENT;

/** Returns a buffer of exactly `entityCount` records: `reuse` if its size matches, else a new one. */
export function ensureSnapshotBuffer(entityCount: number, reuse?: ArrayBuffer): ArrayBuffer {
  const bytes = snapshotByteLength(entityCount);
  return reuse?.byteLength === bytes ? reuse : new ArrayBuffer(bytes);
}

/** Writes entities into `buf` if its size matches, otherwise into a new buffer. */
export function encodeSnapshot(
  entities: readonly SnapshotEntity[],
  buf?: ArrayBuffer,
): ArrayBuffer {
  const out = ensureSnapshotBuffer(entities.length, buf);
  const f = new Float32Array(out);
  let o = 0;
  for (const e of entities) {
    f[o] = e.stableId;
    f[o + 1] = e.x;
    f[o + 2] = e.y;
    f[o + 3] = e.z;
    f[o + 4] = e.facingRad;
    o += SNAPSHOT_ENTITY_STRIDE;
  }
  return out;
}

export const snapshotEntityCount = (buf: ArrayBuffer | Float32Array): number =>
  Math.floor(buf.byteLength / (SNAPSHOT_ENTITY_STRIDE * Float32Array.BYTES_PER_ELEMENT));

/** Reads record `index` into `out` (no allocation when `out` is reused). */
export function readSnapshotEntity(
  view: Float32Array,
  index: number,
  out: SnapshotEntity = { stableId: 0, x: 0, y: 0, z: 0, facingRad: 0 },
): SnapshotEntity {
  const o = index * SNAPSHOT_ENTITY_STRIDE;
  out.stableId = view[o] ?? 0;
  out.x = view[o + 1] ?? 0;
  out.y = view[o + 2] ?? 0;
  out.z = view[o + 3] ?? 0;
  out.facingRad = view[o + 4] ?? 0;
  return out;
}

/** Convenience decoder (allocates; for tests and tools, not the render hot path). */
export function decodeSnapshot(buf: ArrayBuffer): SnapshotEntity[] {
  const view = new Float32Array(buf);
  const n = snapshotEntityCount(buf);
  const out: SnapshotEntity[] = [];
  for (let i = 0; i < n; i++) out.push(readSnapshotEntity(view, i));
  return out;
}
