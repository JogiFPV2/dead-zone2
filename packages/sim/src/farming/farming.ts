import type { Crop, FarmingSettings } from '@deadzone/content';
import {
  CHUNK_SIZE,
  dayOfYearForGameDay,
  FARM_PLOT_VIEW_TILES,
  tileIndex,
  type CommandRejectReason,
  type FarmPlotView,
} from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { gameMinuteAt, MINUTES_PER_DAY } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { addPieces, carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import {
  defOf,
  destroyItem,
  tileKey,
  type ActionState,
  type FarmPlot,
  type ItemInstance,
} from '../items/store.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { floorZ } from '../world/levels.js';
import { weatherNow } from '../world/weather.js';
import { vesselOf } from './vessels.js';

/**
 * Farming (protocol 53, docs 9.86, Paweł 25.11): with a dig tool (`farming.digTag`: hoe, rake,
 * shovel) in either hand the player digs an outdoor grass / dirt tile into a plot (`dig`), plants
 * a seed packet or a seed potato there (`plant`), waters it from a vessel (`waterPlot`,
 * `farming.waterPerPlotL`; farming/vessels.ts) and harvests the ripe crop (`harvest`). Rain and
 * storms water every plot. A plant grows only while the soil is wet (`moistMin` after watering);
 * without water it wilts (`wiltMin`) and withers (`dieMin`); frost / snow and the end of the
 * season (`season`) kill it. A dead plant is cleared (`clearPlot`). Plots live in
 * `ItemStore.farm` (saved, hashed); the menu offers them through the furniture menu
 * (furniture/menu.ts), the client draws them from `SimViewPatch.farmPlots`.
 */

/** Settings when farming is on (crops listed), else undefined. */
export function farmingOf(w: SimWorld): FarmingSettings | undefined {
  const f = w.items?.content.farming;
  return f && f.crops.length > 0 ? f : undefined;
}

export const cropById = (f: FarmingSettings, id: string | undefined): Crop | undefined =>
  id === undefined ? undefined : f.crops.find((c) => c.id === id);

/** Crop planted from this item (first crop listing it), else undefined. */
export const cropForItem = (f: FarmingSettings, defId: string): Crop | undefined =>
  f.crops.find((c) => c.plant.includes(defId));

export const plotAt = (w: SimWorld, x: number, y: number, z: number): FarmPlot | undefined =>
  w.items?.farm?.get(tileKey(x, y, z));

const nowOf = (w: SimWorld): number => gameMinuteAt(w.clock, w.tick);

/** Day of year (1..365) of an absolute game minute. */
const dayOfYear = (minute: number): number =>
  dayOfYearForGameDay(Math.floor(minute / MINUTES_PER_DAY) + 1);

export function inSeason(f: FarmingSettings, minute: number): boolean {
  const d = dayOfYear(minute);
  const { fromDay, toDay } = f.season;
  return fromDay <= toDay ? d >= fromDay && d <= toDay : d >= fromDay || d <= toDay;
}

/** Floor tile id at a world tile (undefined = no chunk / no floor). */
function floorAt(w: SimWorld, x: number, y: number, z: number): string | undefined {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const ch = w.map.getChunk(cx, cy, z);
  if (!ch) return undefined;
  const i = tileIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE);
  if (ch.room?.[i]) return undefined;
  const v = ch.floor[i] ?? 0;
  return v ? (w.map.floorTiles?.[v] ?? undefined) : undefined;
}

/**
 * Why tile (x, y, z) cannot be dug (undefined = it can): only outdoors on level 0, on a
 * `soilFloors` tile, with no map object or collision blocker on it and no plot yet.
 */
export function digBlock(
  w: SimWorld,
  x: number,
  y: number,
  z: number,
): CommandRejectReason | undefined {
  const f = farmingOf(w);
  if (!f) return 'invalid-state';
  if (z !== 0) return 'invalid-target';
  const floor = floorAt(w, x, y, z);
  if (!floor || !f.soilFloors.includes(floor)) return 'invalid-target';
  if (plotAt(w, x, y, z)) return 'invalid-state';
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const ch = w.map.getChunk(cx, cy, z);
  const lx = x - cx * CHUNK_SIZE;
  const ly = y - cy * CHUNK_SIZE;
  if (ch?.objects?.some((o) => o.x === lx && o.y === ly)) return 'blocked';
  if (ch?.blockers?.some((b) => b.x0 < lx + 1 && b.x1 > lx && b.y0 < ly + 1 && b.y1 > ly))
    return 'blocked';
  return undefined;
}

/** The dig tool in the player's hands (either hand), else undefined. */
export function digTool(w: SimWorld, eid: number): ItemInstance | undefined {
  const st = w.items;
  const f = farmingOf(w);
  const p = playerItems(w, eid);
  if (!st || !f || !p) return undefined;
  for (const slot of ['hand_primary', 'hand_secondary'] as const) {
    const item = st.items.get(p.slots.get(slot) ?? 0);
    if (item && defOf(st, item).tags.includes(f.digTag)) return item;
  }
  return undefined;
}

/** Plot tile within the menu reach of the player (tile centre, same floor). */
export function plotInReach(w: SimWorld, eid: number, x: number, y: number, z: number): boolean {
  if (floorZ(w, eid) !== z) return false;
  const dx = x + 0.5 - (w.c.Position.x[eid] ?? 0);
  const dy = y + 0.5 - (w.c.Position.y[eid] ?? 0);
  const r = w.openings.cfg.reachTiles;
  return dx * dx + dy * dy <= r * r;
}

export type PlotWater = FarmPlotView['water'];

/** How wet the plot is at `now` (`dead` for a withered / frozen plant). */
export function plotWater(f: FarmingSettings, plot: FarmPlot, now: number): PlotWater {
  if (plot.dead) return 'dead';
  const dry = now - plot.watered;
  if (dry < f.moistMin) return 'wet';
  return dry < f.wiltMin ? 'dry' : 'wilted';
}

/** Growth 0..1 of the plot's crop (0 without one). */
export function plotGrowth(f: FarmingSettings, plot: FarmPlot): number {
  const crop = cropById(f, plot.crop);
  if (!crop) return 0;
  return Math.min(1, plot.growth / (crop.growDays * MINUTES_PER_DAY));
}

/** 0 bare soil, 1 seed, 2 sprout, 3 young, 4 ripe. */
export function plotStage(f: FarmingSettings, plot: FarmPlot): FarmPlotView['stage'] {
  if (!cropById(f, plot.crop)) return 0;
  const g = plotGrowth(f, plot);
  if (g >= 1) return 4;
  return g < 0.15 ? 1 : g < 0.55 ? 2 : 3;
}

export function plotView(w: SimWorld, key: string, plot: FarmPlot): FarmPlotView {
  const f = farmingOf(w)!;
  const [x, y, z] = key.split(',').map(Number) as [number, number, number];
  const crop = cropById(f, plot.crop);
  return {
    x,
    y,
    z,
    ...(crop ? { crop: crop.id, harvest: crop.harvest } : {}),
    stage: plotStage(f, plot),
    growth: Math.floor(plotGrowth(f, plot) * 100) / 100,
    water: plotWater(f, plot, nowOf(w)),
  };
}

/** Plots within `FARM_PLOT_VIEW_TILES` of the player (`SimViewPatch.farmPlots`), sorted. */
export function farmPlotViews(w: SimWorld, eid: number): FarmPlotView[] {
  const farm = w.items?.farm;
  if (!farm || farm.size === 0 || !farmingOf(w)) return [];
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const r = FARM_PLOT_VIEW_TILES;
  const out: FarmPlotView[] = [];
  for (const [key, plot] of farm) {
    const v = plotView(w, key, plot);
    if (Math.abs(v.x + 0.5 - px) > r || Math.abs(v.y + 0.5 - py) > r) continue;
    out.push(v);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
}

function kill(w: SimWorld, key: string, plot: FarmPlot, reason: 'dry' | 'frost' | 'season') {
  plot.dead = true;
  w.items!.version++;
  const [x, y, z] = key.split(',').map(Number) as [number, number, number];
  w.events.push({ type: 'plantDied', tick: w.tick, x, y, z, crop: plot.crop ?? '', reason });
}

/**
 * Pipeline step `farming` (after `clock`): per game minute, rain / storm waters every plot, a
 * wet plant grows a minute, a dry one wilts and withers, frost / snow and the end of the
 * season kill it. No plots = nothing to do.
 */
export function farmingSystem(w: SimWorld, first: number, count: number, ambientC: number): void {
  const farm = w.items?.farm;
  const f = farmingOf(w);
  if (!farm || farm.size === 0 || !f) return;
  for (let m = first; m < first + count; m++) {
    const wx = weatherNow(w, m);
    const rain = wx?.kind === 'rain' || wx?.kind === 'storm';
    const frost = !!wx && (ambientC + wx.tempC <= f.frostC || wx.snow >= f.snowKill);
    const season = inSeason(f, m);
    for (const [key, plot] of farm) {
      if (rain) plot.watered = m;
      const crop = cropById(f, plot.crop);
      if (!crop || plot.dead) continue;
      if (!season) kill(w, key, plot, 'season');
      else if (frost) kill(w, key, plot, 'frost');
      else if (m - plot.watered >= f.dieMin) kill(w, key, plot, 'dry');
      else if (m - plot.watered < f.moistMin) {
        const full = crop.growDays * MINUTES_PER_DAY;
        if (plot.growth < full) plot.growth = Math.fround(Math.min(full, plot.growth + 1));
      }
    }
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────

/** The plot of the action's tile (`a.spot`) when it is in reach. */
function spotPlot(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { f: FarmingSettings; key: string; plot: FarmPlot | undefined } | CommandRejectReason {
  const f = farmingOf(w);
  const s = a.spot;
  if (!f || !s || !w.items) return 'invalid-state';
  if (!plotInReach(w, eid, s.x, s.y, s.z)) return 'out-of-range';
  const key = tileKey(s.x, s.y, s.z);
  return { f, key, plot: w.items.farm?.get(key) };
}

/** A carried item by id (inventory or bags), else undefined. */
function carried(w: SimWorld, eid: number, id: number): ItemInstance | undefined {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return undefined;
  return carriedItems(st, p.inventory).find((i) => i.id === id);
}

function digCheck(w: SimWorld, eid: number, a: ActionState): CommandRejectReason | undefined {
  const s = spotPlot(w, eid, a);
  if (typeof s === 'string') return s;
  if (!digTool(w, eid)) return 'missing-tool';
  return digBlock(w, a.spot!.x, a.spot!.y, a.spot!.z);
}

export function plantCheck(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { crop: Crop; plot: FarmPlot; item: ItemInstance } | CommandRejectReason {
  const s = spotPlot(w, eid, a);
  if (typeof s === 'string') return s;
  if (!s.plot || s.plot.crop !== undefined) return 'invalid-state';
  const item = carried(w, eid, a.item);
  if (!item) return 'missing-item';
  const crop = cropForItem(s.f, defOf(w.items!, item).id);
  if (!crop) return 'invalid-target';
  if (!inSeason(s.f, nowOf(w))) return 'invalid-state';
  return { crop, plot: s.plot, item };
}

export function waterCheck(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { plot: FarmPlot; item: ItemInstance; litres: number } | CommandRejectReason {
  const s = spotPlot(w, eid, a);
  if (typeof s === 'string') return s;
  if (!s.plot || s.plot.crop === undefined || s.plot.dead) return 'invalid-state';
  const item = carried(w, eid, a.item);
  if (!item || !vesselOf(w, item)) return 'missing-item';
  if ((item.waterL ?? 0) + 1e-4 < s.f.waterPerPlotL) return 'no-water';
  return { plot: s.plot, item, litres: s.f.waterPerPlotL };
}

export function harvestCheck(
  w: SimWorld,
  eid: number,
  a: ActionState,
): { f: FarmingSettings; crop: Crop; plot: FarmPlot } | CommandRejectReason {
  const s = spotPlot(w, eid, a);
  if (typeof s === 'string') return s;
  const crop = cropById(s.f, s.plot?.crop);
  if (!s.plot || !crop || s.plot.dead || plotStage(s.f, s.plot) !== 4) return 'invalid-state';
  return { f: s.f, crop, plot: s.plot };
}

function clearCheck(w: SimWorld, eid: number, a: ActionState) {
  const s = spotPlot(w, eid, a);
  if (typeof s === 'string') return s;
  return s.plot?.dead ? { plot: s.plot } : ('invalid-state' as const);
}

const reasonOf = (r: unknown): CommandRejectReason | undefined =>
  typeof r === 'string' ? (r as CommandRejectReason) : undefined;

const xp = (w: SimWorld, eid: number, f: FarmingSettings, amount: number) => {
  if (amount > 0) addXp(w, eid, f.skill, amount);
};

export function registerFarmingActions(): void {
  registerAction('dig', {
    validate: digCheck,
    durationMin: (w) => farmingOf(w)?.digMin ?? 20,
    complete(w, eid, a) {
      if (digCheck(w, eid, a)) return;
      const f = farmingOf(w)!;
      const st = w.items!;
      const s = a.spot!;
      // Fresh soil is dry: a seed planted in it needs water.
      (st.farm ??= new Map()).set(tileKey(s.x, s.y, s.z), {
        growth: 0,
        watered: nowOf(w) - f.moistMin,
      });
      st.version++;
      xp(w, eid, f, f.xp.dig);
    },
  });
  registerAction('plant', {
    validate: (w, eid, a) => reasonOf(plantCheck(w, eid, a)),
    durationMin: (w) => farmingOf(w)?.plantMin ?? 5,
    complete(w, eid, a) {
      const c = plantCheck(w, eid, a);
      if (typeof c === 'string') return;
      const st = w.items!;
      const f = farmingOf(w)!;
      if (c.item.count > 1) c.item.count--;
      else destroyItem(st, c.item);
      c.plot.crop = c.crop.id;
      c.plot.growth = 0;
      // Soil dug long ago counts as just dry (the seed starts its own clock).
      c.plot.watered = Math.max(c.plot.watered, nowOf(w) - f.moistMin);
      delete c.plot.dead;
      st.version++;
      xp(w, eid, f, f.xp.plant);
    },
  });
  registerAction('waterPlot', {
    validate: (w, eid, a) => reasonOf(waterCheck(w, eid, a)),
    durationMin: (w) => farmingOf(w)?.waterMin ?? 1,
    complete(w, eid, a) {
      const c = waterCheck(w, eid, a);
      if (typeof c === 'string') return;
      const left = (c.item.waterL ?? 0) - c.litres;
      if (left > 1e-4) c.item.waterL = Math.fround(left);
      else {
        delete c.item.waterL;
        delete c.item.waterDirty;
      }
      c.plot.watered = nowOf(w);
      w.items!.version++;
      xp(w, eid, farmingOf(w)!, farmingOf(w)!.xp.water);
    },
  });
  registerAction('harvest', {
    validate: (w, eid, a) => reasonOf(harvestCheck(w, eid, a)),
    durationMin: (w) => farmingOf(w)?.harvestMin ?? 5,
    complete(w, eid, a) {
      const c = harvestCheck(w, eid, a);
      if (typeof c === 'string') return;
      const st = w.items!;
      const p = playerItems(w, eid)!;
      const def = st.content.itemIndex.get(c.crop.harvest);
      const rng = w.rng.actions;
      const bonus = skillLevel(w, eid, c.f.skill) * c.f.yieldPerLevel;
      const whole = Math.floor(bonus);
      const count =
        rng.int(c.crop.yield.min, Math.max(c.crop.yield.min, c.crop.yield.max)) +
        whole +
        (rng.chance(bonus - whole) ? 1 : 0);
      if (def !== undefined) addPieces(st, def, p.inventory, count, nowOf(w));
      delete c.plot.crop;
      c.plot.growth = 0;
      st.version++;
      xp(w, eid, c.f, c.f.xp.harvest);
      w.events.push({
        type: 'harvested',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        defId: c.crop.harvest,
        count,
      });
    },
  });
  registerAction('clearPlot', {
    validate: (w, eid, a) => reasonOf(clearCheck(w, eid, a)),
    durationMin: (w) => farmingOf(w)?.clearMin ?? 5,
    complete(w, eid, a) {
      const c = clearCheck(w, eid, a);
      if (typeof c === 'string') return;
      delete c.plot.crop;
      delete c.plot.dead;
      c.plot.growth = 0;
      w.items!.version++;
    },
  });
}
