import { sortedQuery, type SimWorld } from '../core/world.js';
import {
  bagSpeedFactor,
  canReach,
  carriedLoad,
  carryCapacity,
  playerItems,
} from '../items/inventory.js';

/**
 * Pipeline step after movement: stat `carry-load` (carried kg after bag reduction / carry
 * capacity × 100; the `heavy-load` moodle slows movement from data), the worn-bag speed factor,
 * and closing the loot panel when the container went out of reach.
 */
export function inventorySystem(w: SimWorld): void {
  const st = w.items;
  const s = w.survival;
  if (!st || !s) return;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const p = playerItems(w, eid);
    if (!p) continue;
    const cap = carryCapacity(w, eid);
    const load = carriedLoad(st, p);
    s.carryLoad[eid] = Math.fround(cap > 0 ? (load / cap) * 100 : load > 0 ? 1000 : 0);
    s.bagSpeed[eid] = Math.fround(bagSpeedFactor(st, p));
    if (p.open && !canReach(w, eid, p.open)) {
      p.open = 0;
      st.version++;
    }
  }
}
