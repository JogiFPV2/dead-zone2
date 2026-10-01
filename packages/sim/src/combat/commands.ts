import type { CommandRejectReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { canShoot, interruptSingleLoad } from './firearms.js';

/**
 * `attack` / `shove`: queued for `combat` this tick. One swing per player per tick; `busy` while
 * the previous swing cools down or the player sleeps.
 */
export function queueAttack(
  w: SimWorld,
  eid: number,
  shove: boolean,
): CommandRejectReason | undefined {
  const cb = w.ai?.combat;
  if (!cb) return 'invalid-state';
  if (w.survival?.asleep[eid]) return 'busy';
  if (!shove) interruptSingleLoad(w, eid);
  if (w.tick < (cb.readyTick[eid] ?? 0) || cb.pending.some((p) => p.eid === eid)) return 'busy';
  if (!shove) {
    const reason = canShoot(w, eid);
    if (reason) return reason;
  }
  cb.pending.push({ eid, shove });
  return undefined;
}
