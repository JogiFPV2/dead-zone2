import {
  GAITS,
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotEntityKind,
  ensureSnapshotBuffer,
  physStateIndex,
  type PlayerId,
} from '@deadzone/protocol';
import { ZombieState } from '../ai/state.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { bamToRad } from '../core/dmath.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { bodyOf } from '../physics/system.js';

const attackTicks = (w: SimWorld): number =>
  Math.max(1, Math.round((w.ai?.combat.cfg.attackAnimSec ?? 0) * TICKS_PER_SECOND));

export function renderEntityCount(w: SimWorld): number {
  return sortedQuery(w, 'render', [w.c.Position, w.c.Facing]).length;
}

/**
 * Packs visible entities into the protocol snapshot layout. The local player goes first, the
 * rest (other players, zombies) follow in StableId order, with `kind`, `anim`, `hpPct` and the
 * physics body (state, timers, knockback, hit direction, gait seed). Reuses `buf`
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
  const u = new Uint32Array(out);
  const first = w.players.get(localPlayer);
  let o = 0;
  const put = (eid: number): void => {
    f[o] = StableId.value[eid] ?? 0;
    f[o + 1] = Position.x[eid] ?? 0;
    f[o + 2] = Position.y[eid] ?? 0;
    f[o + 3] = Position.z[eid] ?? 0;
    f[o + 4] = bamToRad(Facing.angle[eid] ?? 0);
    const moving = (Velocity.x[eid] ?? 0) !== 0 || (Velocity.y[eid] ?? 0) !== 0;
    const cb = w.ai?.combat;
    const swing = cb?.swingTick[eid] ?? 0;
    const attacking = swing > 0 && w.tick - swing < attackTicks(w);
    if (Zombie.is[eid]) {
      f[o + 5] = SnapshotEntityKind.zombie;
      f[o + 6] =
        (Zombie.hp[eid] ?? 0) <= 0
          ? SnapshotAnim.dead
          : attacking
            ? SnapshotAnim.attack
            : !moving
              ? SnapshotAnim.idle
              : Zombie.state[eid] === ZombieState.chase
                ? SnapshotAnim.run
                : SnapshotAnim.walk;
      const max = w.ai?.types[Zombie.type[eid] ?? 0]?.def.health ?? 0;
      const hp = Zombie.hp[eid] ?? 0;
      f[o + 7] = max > 0 && hp > 0 ? Math.min(1, hp / max) : 0;
    } else {
      f[o + 5] = SnapshotEntityKind.player;
      const dead = w.survival?.dead[eid] === 1;
      f[o + 6] = dead
        ? SnapshotAnim.dead
        : attacking
          ? SnapshotAnim.attack
          : !moving
            ? SnapshotAnim.idle
            : GAITS[MoveIntent.gait[eid] ?? 1] === 'run'
              ? SnapshotAnim.run
              : SnapshotAnim.walk;
      const s = w.survival;
      f[o + 7] = !s ? 1 : dead ? 0 : Math.min(1, Math.max(0, (s.vitals.health[eid] ?? 0) / 100));
    }
    const b = bodyOf(w, eid);
    f[o + 8] = physStateIndex(b?.state);
    u[o + 9] = b?.stateStartTick ?? 0;
    f[o + 10] = b?.stateDuration ?? 0;
    f[o + 11] = b?.knockback.dirX ?? 0;
    f[o + 12] = b?.knockback.dirY ?? 0;
    f[o + 13] = b?.knockback.strength ?? 0;
    f[o + 14] = b?.hitFromDir ?? 0;
    u[o + 15] = b?.gaitSeed ?? 0;
    o += SNAPSHOT_ENTITY_STRIDE;
  };
  if (first !== undefined) put(first);
  for (const eid of eids) if (eid !== first) put(eid);
  return out;
}
