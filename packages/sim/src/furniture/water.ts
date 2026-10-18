import type { WaterSettings } from '@deadzone/content';
import { CHUNK_SIZE, type CommandRejectReason, type WaterTankView } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import {
  createItem,
  defOf,
  destroyItem,
  fullUses,
  type ActionState,
  type ItemInstance,
} from '../items/store.js';
import { objectHasTag } from '../survival/hygiene.js';
import { clampStat } from '../survival/state.js';
import { rectDist2 } from '../world/furniture.js';
import { floorZ } from '../world/levels.js';
import { objectRect } from './footprint.js';

/**
 * Furniture water (protocol 36, docs 9.59): a placeable with `placeable.waterTank`
 * (`{capacityL, quality, refillFromMains}`, e.g. the toilet cistern) holds a finite supply.
 * Menu `drink-tank` drinks `worldSettings.water.tankDrinkL` (thirst − `hygiene.drinkTap.thirst`,
 * scaled when less is left); `fill-water` (`water.fillMin`) fills a carried bottle
 * (`water.bottles`, size `waterContainer.capacityL`) there or at a tap (mains). While mains water
 * is on a `refillFromMains` tank refills at once (stays full); after the cut it only drains.
 * Litres left of tanks that are not full: `ItemStore.waterTanks` (`x,y,z,n` → litres; saved only
 * then). Tainted water fills the tainted bottle (boil before drinking); drinking it straight has
 * no sickness yet, like `drink.sicknessChance` (not simulated).
 */

/**
 * Fallbacks when the content has no `worldSettings.water` / `waterContainer` (older bundles):
 * the values of #260. Litres one drink takes from a tank (`water.tankDrinkL`).
 */
export const TANK_DRINK_L = 0.25;
/** Litres of a full bottle without `waterContainer.capacityL` (`base:water-bottle`, 0.55 kg). */
export const BOTTLE_L = 0.5;
/** Game minutes to fill a bottle (`water.fillMin`). */
export const FILL_MIN = 0.5;
/** Bottles of `fill-water` (`water.bottles`): the empty one and what it becomes. */
export const WATER_ITEMS: WaterSettings['bottles'] = {
  empty: 'base:bottle',
  clean: 'base:water-bottle',
  tainted: 'base:dirty-water-bottle',
};

/** `worldSettings.water` of the content, with the fallbacks above. */
export function waterSettings(w: SimWorld): WaterSettings {
  const ws = w.items?.content.water;
  return {
    tankDrinkL: ws?.tankDrinkL ?? TANK_DRINK_L,
    fillMin: ws?.fillMin ?? FILL_MIN,
    bottles: { ...WATER_ITEMS, ...ws?.bottles },
  };
}

const EPS = 1e-4;

export type Fixture = [number, number, number, number];
const keyOf = (f: Fixture): string => f.join(',');

interface Tank {
  capacityL: number;
  quality: 'clean' | 'tainted';
  refillFromMains: boolean;
}

/** The tank of a map object's content id (placeable with `waterTank`). */
export function tankOf(w: SimWorld, contentId: string): Tank | undefined {
  const c = w.items?.content;
  const i = c?.itemIndex.get(contentId);
  const d = i === undefined ? undefined : c!.items[i];
  return d?.kind === 'placeable' ? d.placeable.waterTank : undefined;
}

/** Litres in a tank now (mains + `refillFromMains` = full; absent entry = full). */
export function tankLitres(w: SimWorld, f: Fixture, tank: Tank): number {
  const st = w.items!;
  if (tank.refillFromMains && st.water) return tank.capacityL;
  return st.waterTanks?.get(keyOf(f)) ?? tank.capacityL;
}

function setTankLitres(w: SimWorld, f: Fixture, tank: Tank, litres: number): void {
  const st = w.items!;
  const k = keyOf(f);
  if (litres >= tank.capacityL - EPS || (tank.refillFromMains && st.water)) {
    st.waterTanks?.delete(k);
    if (st.waterTanks?.size === 0) st.waterTanks = undefined;
  } else (st.waterTanks ??= new Map()).set(k, Math.fround(Math.max(0, litres)));
  st.version++;
}

export function tankView(w: SimWorld, f: Fixture, tank: Tank): WaterTankView {
  return {
    litres: Math.round(tankLitres(w, f, tank) * 100) / 100,
    capacityL: tank.capacityL,
    quality: tank.quality,
  };
}

function objectAt(
  w: SimWorld,
  f: Fixture,
): { contentId: string; rot?: number | undefined } | undefined {
  const [x, y, z, n] = f;
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  let i = 0;
  for (const o of w.map.getChunk(cx, cy, z)?.objects ?? []) {
    if (cx * CHUNK_SIZE + o.x !== x || cy * CHUNK_SIZE + o.y !== y) continue;
    if (i++ === n) return o;
  }
  return undefined;
}

/** Same reach as the furniture menu (tile centre, or the footprint with the flag on). */
function inReach(
  w: SimWorld,
  eid: number,
  f: Fixture,
  contentId: string,
  rot: number | undefined,
): boolean {
  const [x, y, z] = f;
  if (floorZ(w, eid) !== z) return false;
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const r = w.openings.cfg.reachTiles;
  if (w.furniture) return rectDist2(objectRect(w, x, y, contentId, rot), px, py) <= r * r;
  const dx = x + 0.5 - px;
  const dy = y + 0.5 - py;
  return dx * dx + dy * dy <= r * r;
}

/** Water source of the fixture: its tank, or a tap on mains (unlimited while it runs). */
function sourceOf(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { litres: number; quality: 'clean' | 'tainted'; tank?: Tank } | CommandRejectReason {
  const st = w.items;
  const f = a.fixture;
  if (!st || !f || !playerItems(w, eid)) return 'invalid-state';
  const obj = objectAt(w, f);
  if (!obj) return 'no-station';
  if (!inReach(w, eid, f, obj.contentId, obj.rot)) return 'out-of-range';
  const tank = tankOf(w, obj.contentId);
  if (tank) {
    const litres = tankLitres(w, f, tank);
    return litres > EPS ? { litres, quality: tank.quality, tank } : 'no-water';
  }
  const tap = w.survival?.content.survival.hygiene.tapTag;
  if (!tap || !objectHasTag(w, obj.contentId, tap)) return 'no-station';
  return st.water ? { litres: Infinity, quality: 'clean' } : 'no-water';
}

const idOf = (w: SimWorld, id: string): number | undefined => w.items!.content.itemIndex.get(id);

/**
 * Bottle `fill-water` fills for `quality`: a carried water bottle that is not full (clean only
 * from clean water; a dirty one from either), else an empty bottle; lowest item id first.
 */
export function fillTarget(
  w: SimWorld,
  eid: number,
  quality: 'clean' | 'tainted',
): ItemInstance | undefined {
  const st = w.items!;
  const p = playerItems(w, eid);
  if (!p) return undefined;
  const b = waterSettings(w).bottles;
  const clean = idOf(w, b.clean);
  const dirty = idOf(w, b.tainted);
  const empty = idOf(w, b.empty);
  const items = carriedItems(st, p.inventory).sort((a, b) => a.id - b.id);
  const partial = items.find(
    (it) =>
      ((it.def === dirty && dirty !== undefined) ||
        (it.def === clean && clean !== undefined && quality === 'clean')) &&
      it.uses < fullUses(defOf(st, it)),
  );
  if (partial) return partial;
  const target = quality === 'clean' ? clean : dirty;
  return target === undefined ? undefined : items.find((it) => it.def === empty);
}

function drinkCheck(w: SimWorld, eid: number, a: ActionState) {
  const s = sourceOf(w, eid, a);
  if (typeof s === 'string') return s;
  if (!w.survival || !w.survival.content.survival.hygiene) return 'invalid-state';
  if ((w.survival.vitals.thirst[eid] ?? 0) <= 0) return 'invalid-state';
  return s;
}

function fillCheck(w: SimWorld, eid: number, a: ActionState) {
  const s = sourceOf(w, eid, a);
  if (typeof s === 'string') return s;
  const item = fillTarget(w, eid, s.quality);
  if (!item) return 'missing-item';
  const st = w.items!;
  const b = waterSettings(w).bottles;
  const def =
    item.def === idOf(w, b.empty)
      ? idOf(w, s.quality === 'clean' ? b.clean : b.tainted)!
      : item.def;
  const d = st.content.items[def]!;
  // Bottle size: `waterContainer.capacityL` of the filled item, else of the empty one, else 0.5 l.
  const capacityL =
    d.waterContainer?.capacityL ?? defOf(st, item).waterContainer?.capacityL ?? BOTTLE_L;
  const perUse = capacityL / fullUses(d);
  // Less than one sip left in the tank: nothing to fill.
  return s.litres + EPS < perUse ? 'no-water' : { ...s, item, def, perUse };
}

const reasonOf = (r: unknown): CommandRejectReason | undefined =>
  typeof r === 'string' ? (r as CommandRejectReason) : undefined;

export function registerWaterActions(): void {
  registerAction('drinkTank', {
    validate: (w, eid, a) => reasonOf(drinkCheck(w, eid, a)),
    durationMin: (w) => w.survival?.content.survival.hygiene.drinkTap.durationMin ?? 1,
    complete(w, eid, a) {
      const s = drinkCheck(w, eid, a);
      if (typeof s === 'string') return;
      const sip = waterSettings(w).tankDrinkL;
      const taken = Math.min(sip, s.litres);
      if (s.tank) setTankLitres(w, a.fixture!, s.tank, s.litres - taken);
      const sv = w.survival!;
      const h = sv.content.survival.hygiene;
      const v = sv.vitals;
      v.thirst[eid] = clampStat((v.thirst[eid] ?? 0) - (h.drinkTap.thirst * taken) / sip);
    },
  });
  registerAction('fillWater', {
    validate: (w, eid, a) => reasonOf(fillCheck(w, eid, a)),
    durationMin: (w) => waterSettings(w).fillMin,
    complete(w, eid, a) {
      const s = fillCheck(w, eid, a);
      if (typeof s === 'string') return;
      const st = w.items!;
      let item = s.item;
      if (item.def !== s.def) {
        const loc = item.loc;
        if (item.count > 1) {
          item.count--;
          st.version++;
        } else destroyItem(st, item);
        item = createItem(st, s.def, loc, 1, gameMinuteAt(w.clock, w.tick));
        item.uses = 0;
      }
      const perUse = s.perUse;
      const uses = Math.min(
        fullUses(defOf(st, item)) - item.uses,
        Math.floor((s.litres + EPS) / perUse),
      );
      item.uses += uses;
      if (s.tank) setTankLitres(w, a.fixture!, s.tank, s.litres - uses * perUse);
      st.version++;
    },
  });
}
