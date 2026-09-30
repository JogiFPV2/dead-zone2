import { SNAPSHOT_ENTITY_STRIDE, SnapshotField } from '@deadzone/protocol';

export interface EntityState {
  id: number;
  x: number;
  y: number;
  z: number;
  facing: number;
}

export const entityCount = (buf: Float32Array): number =>
  Math.floor(buf.length / SNAPSHOT_ENTITY_STRIDE);

/** Reads entity `index` from a snapshot buffer; undefined if out of range. */
export function readEntity(buf: Float32Array, index: number): EntityState | undefined {
  if (index < 0 || index >= entityCount(buf)) return undefined;
  const o = index * SNAPSHOT_ENTITY_STRIDE;
  return {
    id: buf[o + SnapshotField.stableId] ?? 0,
    x: buf[o + SnapshotField.x] ?? 0,
    y: buf[o + SnapshotField.y] ?? 0,
    z: buf[o + SnapshotField.z] ?? 0,
    facing: buf[o + SnapshotField.facingRad] ?? 0,
  };
}

export function writeEntities(entities: readonly EntityState[]): Float32Array<ArrayBuffer> {
  const buf = new Float32Array(entities.length * SNAPSHOT_ENTITY_STRIDE);
  entities.forEach((e, i) => buf.set([e.id, e.x, e.y, e.z, e.facing], i * SNAPSHOT_ENTITY_STRIDE));
  return buf;
}
