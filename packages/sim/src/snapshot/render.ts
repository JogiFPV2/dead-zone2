import {
  GAITS,
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotEntityKind,
  ensureSnapshotBuffer,
  type PlayerId,
} from '@deadzone/protocol';
import { ZombieState } from '../ai/state.js';
import { bamToRad } from '../core/dmath.js';
import { sortedQuery, type SimWorld } from '../core/world.js';

export function renderEntityCount(w: SimWorld): number {
  return sortedQuery(w, 'render', [w.c.Position, w.c.Facing]).length;
}

/**
 * Packs visible entities into the protocol snapshot layout. The local player goes first, the
 * rest (other players, zombies) follow in StableId order, with `kind` and `anim`. Reuses `buf`
 * when its size matches exactly.
 */
export function writeRenderSnapshot(
  w: SimWorld,
  localPlayer: PlayerId,
  buf?: ArrayBuffer,
): ArrayBuffer {
  const { Position, Facing, StableId, Velocity, Zombie, MoveIntent } = w.c;
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
    const moving = (Velocity.x[eid] ?? 0) !== 0 || (Velocity.y[eid] ?? 0) !== 0;
    if (Zombie.is[eid]) {
      f[o + 5] = SnapshotEntityKind.zombie;
      f[o + 6] = !moving
        ? SnapshotAnim.idle
        : Zombie.state[eid] === ZombieState.chase
          ? SnapshotAnim.run
          : SnapshotAnim.walk;
    } else {
      f[o + 5] = SnapshotEntityKind.player;
      const dead = w.survival?.dead[eid] === 1;
      f[o + 6] = dead
        ? SnapshotAnim.dead
        : !moving
          ? SnapshotAnim.idle
          : GAITS[MoveIntent.gait[eid] ?? 1] === 'run'
            ? SnapshotAnim.run
            : SnapshotAnim.walk;
    }
    o += SNAPSHOT_ENTITY_STRIDE;
  };
  if (first !== undefined) put(first);
  for (const eid of eids) if (eid !== first) put(eid);
  return out;
}
