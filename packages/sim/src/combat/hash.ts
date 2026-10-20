import type { HashWriter } from '../core/hash.js';
import { sortedQuery, type SimWorld } from '../core/world.js';

/** Combat state in StableId order of every rendered entity (players, zombies, corpses). */
export function hashCombat(w: SimWorld, h: HashWriter): void {
  const cb = w.ai?.combat;
  if (!cb) return;
  const { StableId, Zombie } = w.c;
  const eids = sortedQuery(w, 'render', [w.c.Position, w.c.Facing]);
  h.u32(eids.length);
  for (const eid of eids) {
    h.u32(StableId.value[eid] ?? 0)
      .u32(cb.readyTick[eid] ?? 0)
      .u32(cb.swingTick[eid] ?? 0)
      .u32(cb.zombieReady[eid] ?? 0)
      .u32(cb.zombieHitAt[eid] ?? 0)
      .u32(cb.zombieNext[eid] ?? 0)
      .u32(cb.kills[eid] ?? 0)
      .f32(Zombie.hp[eid] ?? 0)
      .f32(w.c.Position.x[eid] ?? 0)
      .f32(w.c.Position.y[eid] ?? 0);
    // Firearms (only while reloading, older goldens stay).
    if (cb.reloadUntil[eid])
      h.u32(cb.reloadUntil[eid] ?? 0)
        .u32(cb.reloadItem[eid] ?? 0)
        .u32(cb.reloadStart[eid] ?? 0)
        .u32(cb.reloadKind[eid] ?? 0);
  }
}
