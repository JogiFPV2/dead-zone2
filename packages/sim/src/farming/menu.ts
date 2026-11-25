import type { CommandRejectReason, FurnitureActionView } from '@deadzone/protocol';
import { newAction, previewAction, startAction } from '../actions/queue.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf, type ActionState, type ItemInstance } from '../items/store.js';
import { threatNearby } from '../systems/sleep.js';
import {
  cropById,
  cropForItem,
  digBlock,
  digTool,
  farmingOf,
  inSeason,
  plotAt,
  plotInReach,
  plotStage,
} from './farming.js';
import { vesselOf, vesselRoom } from './vessels.js';

/**
 * Furniture menu entries of farming (protocol 53, furniture/menu.ts): a dug plot (`plot`:
 * plant / water / harvest / clear) and, with a dig tool in hand, a diggable tile (`soil`: dig).
 * Under threat neither is listed, so a right click shoves as before.
 */

/** One menu entry before the menu adds labels (`run` starts the action). */
export interface FarmAct extends Omit<FurnitureActionView, 'labelPl'> {
  labelPl?: string;
  run?: () => CommandRejectReason | undefined;
}

/** Object index on a tile reserved for the plot / soil entry (`objectFurnitureId`). */
export const PLOT_N = 15;

const onSpot = (
  kind: Parameters<typeof newAction>[0],
  x: number,
  y: number,
  z: number,
  item = 0,
) => {
  const a: ActionState = newAction(kind, { item });
  a.spot = { x, y, z };
  return a;
};

function timedAct(
  w: SimWorld,
  eid: number,
  id: string,
  a: ActionState,
  extra: Partial<FarmAct> = {},
): FarmAct {
  const p = previewAction(w, eid, a);
  const reason = p.reason as NonNullable<FurnitureActionView['reason']> | undefined;
  return {
    id,
    enabled: !reason,
    ...(reason ? { reason } : {}),
    ...(p.durationMin !== undefined
      ? { durationMin: Math.round(p.durationMin * 1000) / 1000 }
      : {}),
    ...extra,
    ...(!reason ? { run: () => startAction(w, eid, a) } : {}),
  };
}

const off = (id: string, reason: FurnitureActionView['reason'], reasonPl: string): FarmAct => ({
  id,
  enabled: false,
  ...(reason ? { reason } : {}),
  reasonPl,
});

/** Distinct carried items (one per content id, lowest id first) matching `pick`. */
function carriedBy(w: SimWorld, eid: number, pick: (i: ItemInstance) => boolean): ItemInstance[] {
  const st = w.items!;
  const p = playerItems(w, eid);
  if (!p) return [];
  const seen = new Set<number>();
  return carriedItems(st, p.inventory)
    .sort((a, b) => a.id - b.id)
    .filter((i) => pick(i) && !seen.has(i.def) && (seen.add(i.def), true));
}

/** Kind of entry on tile (x, y, z) for this player: plot, diggable soil, or none. */
export function farmEntryKind(
  w: SimWorld,
  eid: number,
  x: number,
  y: number,
  z: number,
): 'plot' | 'soil' | undefined {
  if (!farmingOf(w) || !plotInReach(w, eid, x, y, z) || threatNearby(w, eid)) return undefined;
  if (plotAt(w, x, y, z)) return 'plot';
  return digTool(w, eid) && !digBlock(w, x, y, z) ? 'soil' : undefined;
}

/** Actions of the plot / soil entry on tile (x, y, z). */
export function farmActions(w: SimWorld, eid: number, x: number, y: number, z: number): FarmAct[] {
  const f = farmingOf(w);
  const st = w.items;
  if (!f || !st) return [];
  const plot = plotAt(w, x, y, z);
  if (!plot) return [timedAct(w, eid, 'dig', onSpot('dig', x, y, z))];
  const out: FarmAct[] = [];
  const crop = cropById(f, plot.crop);
  if (!crop) {
    const seeds = carriedBy(w, eid, (i) => !!cropForItem(f, defOf(st, i).id));
    if (!inSeason(f, gameMinuteAt(w.clock, w.tick)))
      out.push(off('plant', 'invalid-state', 'Poza sezonem (kwiecień–październik)'));
    else if (seeds.length === 0) out.push(off('plant', 'missing-item', 'Brak nasion'));
    for (const i of seeds) {
      out.push(
        timedAct(w, eid, `plant:${i.id}`, onSpot('plant', x, y, z, i.id), {
          item: { id: i.id, def: defOf(st, i).id },
        }),
      );
    }
    return out;
  }
  if (plot.dead) return [timedAct(w, eid, 'clear-plot', onSpot('clearPlot', x, y, z))];
  if (plotStage(f, plot) === 4) out.push(timedAct(w, eid, 'harvest', onSpot('harvest', x, y, z)));
  const vessels = carriedBy(w, eid, (i) => !!vesselOf(w, i));
  if (vessels.length === 0) out.push(off('water', 'missing-item', 'Brak naczynia z wodą'));
  for (const i of vessels) {
    const act = timedAct(w, eid, `water:${i.id}`, onSpot('waterPlot', x, y, z, i.id), {
      item: { id: i.id, def: defOf(st, i).id },
    });
    if (act.reason === 'no-water') act.reasonPl = 'Za mało wody w naczyniu';
    out.push(act);
  }
  return out;
}

/**
 * `fill-vessel:<itemId>` entries at a tap / shower / bath / tank (`fixture`): one per carried
 * vessel that is not full; none when the player carries no vessel.
 */
export function fillVesselActs(
  w: SimWorld,
  eid: number,
  fixture: [number, number, number, number],
): FarmAct[] {
  const st = w.items;
  if (!st) return [];
  const out: FarmAct[] = [];
  const p = playerItems(w, eid);
  if (!p) return out;
  for (const i of carriedItems(st, p.inventory).sort((a, b) => a.id - b.id)) {
    if (!vesselOf(w, i) || vesselRoom(w, i) <= 1e-4) continue;
    const a = newAction('fillVessel', { item: i.id });
    a.fixture = fixture;
    out.push(
      timedAct(w, eid, `fill-vessel:${i.id}`, a, { item: { id: i.id, def: defOf(st, i).id } }),
    );
  }
  return out;
}
