import type { HashWriter } from '../core/hash.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { floorZ } from '../world/levels.js';

/**
 * Stage 4 hash section (only with content, so movement-only golden hashes stay valid): player
 * gaits, the noise buffer, every zombie's brain (goal floor `tz` only when off its own floor) and
 * its path progress. Derived caches (flow
 * fields, spatial hash, visibility, threat) are not hashed; they follow from this state.
 */
export function hashAi(w: SimWorld, h: HashWriter): void {
  const ai = w.ai;
  if (!ai) return;
  const { Zombie, StableId, MoveIntent } = w.c;
  const players = sortedQuery(w, 'players', [w.c.Player]);
  h.u32(players.length);
  for (const eid of players) h.u32(StableId.value[eid] ?? 0).u32(MoveIntent.gait[eid] ?? 1);
  h.u32(ai.noises.length);
  for (const n of ai.noises) {
    h.u32(n.tick)
      .f32(n.x)
      .f32(n.y)
      .u32(n.z >>> 0)
      .f32(n.radius)
      .f32(n.volume)
      .u32(n.source);
    h.f32(n.lingerSec);
  }
  const zombies = sortedQuery(w, 'zombies', [Zombie]);
  h.u32(zombies.length).u32(ai.zombieCount);
  for (const eid of zombies) {
    h.u32(StableId.value[eid] ?? 0)
      .u32(Zombie.type[eid] ?? 0)
      .u32(Zombie.state[eid] ?? 0)
      .u32(Zombie.stateTick[eid] ?? 0)
      .u32(Zombie.targetId[eid] ?? 0);
    h.f32(Zombie.tx[eid] ?? 0)
      .f32(Zombie.ty[eid] ?? 0)
      .u32(Zombie.memoryUntil[eid] ?? 0)
      .f32(Zombie.alert[eid] ?? 0)
      .f32(Zombie.hp[eid] ?? 0)
      .f32(Zombie.speedMul[eid] ?? 0)
      .u32(Zombie.stuck[eid] ?? 0);
    const p = ai.paths.get(eid);
    h.u32(p ? p.goalTx >>> 0 : 0)
      .u32(p ? p.goalTy >>> 0 : 0)
      .u32(p?.len ?? 0)
      .u32(p?.cursor ?? 0);
    // Goal floor only when it differs from the zombie's floor (keeps single-floor goldens).
    const tz = Zombie.tz[eid] ?? 0;
    if (tz !== floorZ(w, eid)) h.u32(0x7f10_0001).u32(tz >>> 0);
  }
}
