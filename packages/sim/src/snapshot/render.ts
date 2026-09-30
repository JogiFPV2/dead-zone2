import { SNAPSHOT_ENTITY_STRIDE, ensureSnapshotBuffer, type PlayerId } from '@deadzone/protocol';
import { bamToRad } from '../core/dmath.js';
import { sortedQuery, type SimWorld } from '../core/world.js';

export function renderEntityCount(w: SimWorld): number {
  return sortedQuery(w, 'render', [w.c.Position, w.c.Facing]).length;
}

/**
 * Packs visible entities into the protocol snapshot layout. The local player goes first, the
 * rest follow in StableId order. Reuses `buf` when its size matches exactly.
 */
export function writeRenderSnapshot(
  w: SimWorld,
  localPlayer: PlayerId,
  buf?: ArrayBuffer,
): ArrayBuffer {
  const { Position, Facing, StableId } = w.c;
  const eids = sortedQuery(w, 'render', [Position, Facing]);
  const out = ensureSnapshotBuffer(eids.length, buf);
  const f = new Float32Array(out);
  const first = w.players.get(localPlayer);
  let o = 0;
  const put = (eid: number): void => {
    f[o] = StableId.value[eid] ?? 0;
    f[o + 1] = Position.x[eid] ?? 0;
    f[o + 2] = Position.y[eid] ?? 0;
    f[o + 3] = Position.z[eid] ?? 0;
    f[o + 4] = bamToRad(Facing.angle[eid] ?? 0);
    o += SNAPSHOT_ENTITY_STRIDE;
  };
  if (first !== undefined) put(first);
  for (const eid of eids) if (eid !== first) put(eid);
  return out;
}
