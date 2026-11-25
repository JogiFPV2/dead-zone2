import type { WaterVessel } from '@deadzone/content';
import type { CommandRejectReason } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import type { SimWorld } from '../core/world.js';
import { nearWater } from '../fishing/fishing.js';
import { setTankLitres, sourceOf, type Tank } from '../furniture/water.js';
import { carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf, type ActionState, type ItemInstance } from '../items/store.js';

/**
 * Water vessels (protocol 53, docs 9.86): items with `waterVessel` (pot, glass, watering can,
 * bucket) hold `waterL` litres for watering plots (farming/farming.ts), not for drinking.
 * `fillVessel` fills one to its capacity at a tap, shower, bath or water tank in reach
 * (`a.fixture`: the furniture menu `fill-vessel:<itemId>`; a tank gives what it has) or at open
 * water within the fishing reach (`useItem` on the vessel; dirty water). Dirty water makes the
 * whole vessel dirty (`waterDirty`).
 */

const EPS = 1e-4;

export const vesselOf = (w: SimWorld, item: ItemInstance): WaterVessel | undefined =>
  w.items ? defOf(w.items, item).waterVessel : undefined;

/** Free litres in the vessel (0 when full). */
export const vesselRoom = (w: SimWorld, item: ItemInstance): number =>
  Math.max(0, (vesselOf(w, item)?.capacityL ?? 0) - (item.waterL ?? 0));

function fillCheck(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { item: ItemInstance; litres: number; dirty: boolean; tank?: Tank } | CommandRejectReason {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return 'invalid-state';
  const item = carriedItems(st, p.inventory).find((i) => i.id === a.item);
  if (!item || !vesselOf(w, item)) return 'missing-item';
  const room = vesselRoom(w, item);
  if (room <= EPS) return 'invalid-state';
  if (!a.fixture) {
    return nearWater(w, eid) ? { item, litres: room, dirty: true } : 'invalid-target';
  }
  const s = sourceOf(w, eid, a, true);
  if (typeof s === 'string') return s;
  return {
    item,
    litres: Math.min(room, s.litres),
    dirty: s.quality === 'tainted',
    ...(s.tank ? { tank: s.tank } : {}),
  };
}

export function registerVesselActions(): void {
  registerAction('fillVessel', {
    validate: (w, eid, a) => {
      const c = fillCheck(w, eid, a);
      return typeof c === 'string' ? c : undefined;
    },
    durationMin: (w) => w.items?.content.farming?.fillMin ?? 0.5,
    complete(w, eid, a) {
      const c = fillCheck(w, eid, a);
      if (typeof c === 'string') return;
      if (c.tank && a.fixture) {
        const s = sourceOf(w, eid, a, true);
        if (typeof s !== 'string') setTankLitres(w, a.fixture, c.tank, s.litres - c.litres);
      }
      c.item.waterL = Math.fround((c.item.waterL ?? 0) + c.litres);
      if (c.dirty) c.item.waterDirty = true;
      w.items!.version++;
    },
  });
}
