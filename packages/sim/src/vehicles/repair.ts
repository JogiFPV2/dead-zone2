import { VEHICLE_PARTS, type CommandRejectReason, type VehiclePart } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { ticksPerGameMinute } from '../core/clock.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems, hasToolTag } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { destroyItem, type ActionState, type ItemInstance } from '../items/store.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { partHp, setVehiclePartHp } from './damage.js';
import { onFootNear } from './near.js';
import { vehicleSettings, type VehicleGameplay } from './settings.js';

/**
 * Repairs (docs/sim-architecture.md 9.36): timed `repairVehicle` on one part through
 * `setVehiclePartHp` (#128; a repaired engine starts by itself only with a key, `keys.ts`).
 * Group per part: `engine`, `tire*` → `tire`, `window*` → `window`, `body*` → `body`; tools
 * (tags, all needed, not used up) and parts (consumed on completion) from content, Mechanics.
 */

export type RepairGroup = 'engine' | 'tire' | 'window' | 'body';

export function repairGroup(part: VehiclePart): RepairGroup {
  if (part === 'engine') return 'engine';
  if (part.startsWith('tire')) return 'tire';
  if (part.startsWith('window')) return 'window';
  return 'body';
}

const groupCfg = (w: SimWorld, part: VehiclePart): VehicleGameplay['repair']['engine'] =>
  vehicleSettings(w).repair[repairGroup(part)];

const partOf = (a: ActionState): VehiclePart | undefined => VEHICLE_PARTS[a.seat ?? -1];

/** Carried pieces of item content id `id`. */
function carriedOf(w: SimWorld, eid: number, id: string): ItemInstance[] {
  const st = w.items!;
  const p = playerItems(w, eid);
  const def = st.content.itemIndex.get(id);
  if (!p || def === undefined) return [];
  return carriedItems(st, p.inventory).filter((i) => i.def === def);
}

/** Why player `eid` cannot repair `part` of `vehicleId` now (undefined = it can). */
export function repairBlock(
  w: SimWorld,
  eid: number,
  a: ActionState,
): CommandRejectReason | undefined {
  const v = a.vehicle === undefined ? undefined : w.physics.vehicles.get(a.vehicle);
  const part = partOf(a);
  if (!v || !part || !w.items) return 'invalid-target';
  const hp = partHp(v, part);
  if (hp === undefined || hp >= 100) return 'invalid-target';
  const r = vehicleSettings(w).repair;
  if (!onFootNear(w, eid, v, r.reachTiles)) return 'out-of-range';
  const g = groupCfg(w, part);
  if (skillLevel(w, eid, r.skill) < g.minSkill) return 'skill-too-low';
  if (!g.tools.every((t) => hasToolTag(w, eid, t))) return 'missing-tool';
  for (const need of g.parts) {
    const have = carriedOf(w, eid, need.item).reduce((s, i) => s + i.count, 0);
    if (have < need.count) return 'missing-parts';
  }
  return undefined;
}

let registered = false;

export function registerRepairActions(): void {
  if (registered) return;
  registered = true;
  registerAction('repairVehicle', {
    validate: repairBlock,
    durationMin: (w, _eid, a) =>
      (groupCfg(w, partOf(a)!).sec * TICKS_PER_SECOND) / ticksPerGameMinute(w.clock),
    complete(w, eid, a) {
      const v = w.physics.vehicles.get(a.vehicle!)!;
      const part = partOf(a)!;
      const r = vehicleSettings(w).repair;
      const g = groupCfg(w, part);
      const st = w.items!;
      for (const need of g.parts) {
        let n = need.count;
        for (const item of carriedOf(w, eid, need.item)) {
          if (n <= 0) break;
          const k = Math.min(n, item.count);
          n -= k;
          if (k >= item.count) destroyItem(st, item);
          else item.count -= k;
        }
      }
      st.version++;
      const hp = Math.min(
        100,
        (partHp(v, part) ?? 0) + g.hpBase + skillLevel(w, eid, r.skill) * g.hpPerLevel,
      );
      setVehiclePartHp(w, v, part, hp);
      addXp(w, eid, r.skill, g.xp);
      w.events.push({
        type: 'partRepaired',
        tick: w.tick,
        vehicleId: v.id,
        playerId: w.c.Player.id[eid] ?? 0,
        part,
        hp: partHp(v, part) ?? hp,
      });
    },
  });
}
