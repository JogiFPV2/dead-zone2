import {
  ENTITY_FACING,
  ENTITY_ID,
  ENTITY_STRIDE,
  ENTITY_X,
  ENTITY_Y,
  ENTITY_Z,
} from './protocol.js';

export interface EntityState {
  id: number;
  x: number;
  y: number;
  z: number;
  facing: number;
}

export const entityCount = (buf: Float32Array): number => Math.floor(buf.length / ENTITY_STRIDE);

/** Reads entity `index` from a snapshot buffer; undefined if out of range. */
export function readEntity(buf: Float32Array, index: number): EntityState | undefined {
  if (index < 0 || index >= entityCount(buf)) return undefined;
  const o = index * ENTITY_STRIDE;
  return {
    id: buf[o + ENTITY_ID] ?? 0,
    x: buf[o + ENTITY_X] ?? 0,
    y: buf[o + ENTITY_Y] ?? 0,
    z: buf[o + ENTITY_Z] ?? 0,
    facing: buf[o + ENTITY_FACING] ?? 0,
  };
}

export function writeEntities(entities: readonly EntityState[]): Float32Array<ArrayBuffer> {
  const buf = new Float32Array(entities.length * ENTITY_STRIDE);
  entities.forEach((e, i) => buf.set([e.id, e.x, e.y, e.z, e.facing], i * ENTITY_STRIDE));
  return buf;
}
