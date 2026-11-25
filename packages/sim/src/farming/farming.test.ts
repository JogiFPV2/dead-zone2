import { describe, expect, it } from 'vitest';
import type { FurnitureView } from '@deadzone/protocol';
import { MINUTES_PER_DAY } from '../core/clock.js';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { farmingOf, farmingSystem, inSeason, plotAt, plotStage, plotWater } from './farming.js';

const content = await baseContent();

/**
 * Grass west of x = 20, a pond from x = 20, asphalt in row y = 2. Player at (10.5, 10.5);
 * 3 July 10:00 (the game's start day, in season), weather off.
 */
function sim(opts: { x?: number; weather?: 'off' | 'snow' | 'rain'; load?: Uint8Array } = {}): Sim {
  return createSim({
    seed: 7,
    map: buildMap({
      width: 32,
      height: 32,
      floor: (x, y) => (x >= 20 ? 2 : y === 2 ? 3 : 1),
      floorTiles: [null, 'base:grass', 'base:water', 'base:asphalt'],
    }),
    spawn: { x: opts.x ?? 10.5, y: 10.5 },
    content,
    dev: true,
    weather: opts.weather ?? 'off',
    clockStart: { day: 1, hour: 10, minute: 0 },
    ...(opts.load ? { load: opts.load } : {}),
  });
}

function give(s: Sim, itemId: string, count = 1): number {
  send(s, { type: 'debugGiveItem', itemId, count });
  s.step();
  return findItem(s, itemId)!.id;
}

function equip(s: Sim, itemId: string): number {
  const id = give(s, itemId);
  send(s, { type: 'equip', item: id, slot: 'hand_primary' });
  s.step();
  return id;
}

let menu: readonly FurnitureView[] = [];
function view(s: Sim): readonly FurnitureView[] {
  // The menu list is built on ticks divisible by 4.
  s.step();
  while (s.world.tick % 4 !== 0) s.step();
  const v = s.drainView();
  if (v?.furnitureActions) menu = v.furnitureActions;
  return menu;
}

const entryAt = (s: Sim, x: number, y: number) =>
  view(s).find(
    (v) => v.x === x + 0.5 && v.y === y + 0.5 && (v.typeId === 'plot' || v.typeId === 'soil'),
  );

function use(s: Sim, x: number, y: number, prefix: string): void {
  const e = entryAt(s, x, y);
  if (!e) throw new Error(`no entry at ${x},${y}`);
  const a = e.actions.find((a) => a.id === prefix || a.id.startsWith(`${prefix}:`));
  if (!a) throw new Error(`no ${prefix} in ${e.actions.map((x) => x.id).join(',')}`);
  if (!a.enabled) throw new Error(`${a.id} disabled: ${a.reasonPl}`);
  send(s, { type: 'useFurniture', furnitureId: e.furnitureId, actionId: a.id });
}

const minuteNow = (s: Sim) => {
  const w = s.world;
  return w.clock.startMinute + Math.floor((w.tick * MINUTES_PER_DAY) / w.clock.ticksPerDay);
};

describe('farming (docs 9.86)', () => {
  it('content: every crop plants from and gives an existing item', () => {
    const s = sim();
    const f = farmingOf(s.world)!;
    expect(f.crops.map((c) => c.id).sort()).toEqual(
      ['beans', 'cabbage', 'carrot', 'cucumber', 'onion', 'potato', 'strawberry', 'tomato'].sort(),
    );
    const idx = s.world.items!.content.itemIndex;
    for (const c of f.crops) {
      expect(idx.has(c.harvest), c.harvest).toBe(true);
      for (const p of c.plant) expect(idx.has(p), p).toBe(true);
      expect(c.growDays).toBeGreaterThanOrEqual(3);
      expect(c.growDays).toBeLessThanOrEqual(7);
    }
  });

  it('soil shows up only with a dig tool in hand, only on grass outdoors', () => {
    const s = sim();
    s.step();
    expect(entryAt(s, 10, 10)).toBeUndefined();
    equip(s, 'base:hoe');
    s.step();
    expect(entryAt(s, 10, 10)?.typeId).toBe('soil');
    expect(entryAt(s, 10, 10)?.actions[0]?.id).toBe('dig');
    // Pond and asphalt are not soil.
    const p = sim({ x: 19.5 });
    equip(p, 'base:shovel');
    p.step();
    expect(entryAt(p, 19, 10)?.typeId).toBe('soil');
    expect(entryAt(p, 20, 10)).toBeUndefined();
  });

  it('dig, plant, water from a filled vessel, grow, harvest', () => {
    const s = sim({ x: 18.5 });
    const f = farmingOf(s.world)!;
    equip(s, 'base:garden-rake');
    s.step();
    use(s, 18, 10, 'dig');
    runMinutes(s, f.digMin + 1);
    expect(plotAt(s.world, 18, 10, 0)).toBeDefined();
    expect(entryAt(s, 18, 10)?.typeId).toBe('plot');
    // No seeds yet.
    expect(entryAt(s, 18, 10)?.actions[0]).toMatchObject({ id: 'plant', enabled: false });
    give(s, 'base:seeds-carrot', 5);
    s.step();
    use(s, 18, 10, 'plant');
    runMinutes(s, f.plantMin + 1);
    expect(plotAt(s.world, 18, 10, 0)?.crop).toBe('carrot');
    expect(findItem(s, 'base:seeds-carrot')!.count).toBe(4);
    // Freshly planted in dug soil: dry, needs water; no vessel → disabled entry.
    expect(plotWater(f, plotAt(s.world, 18, 10, 0)!, minuteNow(s))).toBe('dry');
    s.step();
    expect(entryAt(s, 18, 10)?.actions.find((a) => a.id === 'water')?.enabled).toBe(false);
    // A glass filled at the pond (dirty water is fine for plants).
    const glass = give(s, 'base:glass');
    send(s, { type: 'useItem', item: glass });
    runMinutes(s, 1);
    const g = s.world.items!.items.get(glass)!;
    expect(g.waterL).toBeCloseTo(0.25);
    expect(g.waterDirty).toBe(true);
    s.step();
    use(s, 18, 10, 'water');
    runMinutes(s, f.waterMin + 1);
    expect(g.waterL).toBeUndefined();
    expect(plotWater(f, plotAt(s.world, 18, 10, 0)!, minuteNow(s))).toBe('wet');
    // Grow it to the end (the system per minute while wet).
    const plot = plotAt(s.world, 18, 10, 0)!;
    plot.growth = 5 * MINUTES_PER_DAY - 1;
    farmingSystem(s.world, minuteNow(s), 1, 20);
    expect(plotStage(f, plot)).toBe(4);
    s.step();
    s.drainEvents();
    use(s, 18, 10, 'harvest');
    runMinutes(s, f.harvestMin + 1);
    const ev = s.drainEvents().find((e) => e.type === 'harvested');
    expect(ev).toMatchObject({ defId: 'base:carrot' });
    const n = (ev as { count: number }).count;
    expect(n).toBeGreaterThanOrEqual(3);
    const carrot = s.world.items!.content.itemIndex.get('base:carrot');
    const got = [...s.world.items!.items.values()].filter((i) => i.def === carrot);
    expect(got.reduce((a, i) => a + i.count, 0)).toBe(n);
    expect(plotAt(s.world, 18, 10, 0)?.crop).toBeUndefined();
  });

  it('a sink fills a vessel with clean water (menu fill-vessel), mains off = no water', () => {
    const SINK = { contentId: 'base:kitchen-sink', x: 9, y: 10 };
    const mk = () =>
      createSim({
        seed: 4,
        map: buildMap({ width: 32, height: 32, objects: [SINK] }),
        spawn: { x: 10.5, y: 10.5 },
        content,
        dev: true,
        clockStart: { day: 1, hour: 12, minute: 0 },
      });
    const s = mk();
    const can = give(s, 'base:watering-can');
    const sink = view(s).find((v) => v.contentId === SINK.contentId)!;
    const act = sink.actions.find((a) => a.id === `fill-vessel:${can}`)!;
    expect(act).toMatchObject({ enabled: true, labelPl: 'Napełnij naczynie' });
    send(s, { type: 'useFurniture', furnitureId: sink.furnitureId, actionId: act.id });
    runMinutes(s, 2);
    const it = s.world.items!.items.get(can)!;
    expect(it.waterL).toBe(5);
    expect(it.waterDirty).toBeUndefined();
    // Full: no entry for it any more.
    const again = view(s).find((v) => v.contentId === SINK.contentId)!;
    expect(again.actions.some((a) => a.id === `fill-vessel:${can}`)).toBe(false);
    const off = mk();
    off.world.items!.water = false;
    const bucket = give(off, 'base:bucket');
    const a2 = view(off)
      .find((v) => v.contentId === SINK.contentId)!
      .actions.find((a) => a.id === `fill-vessel:${bucket}`)!;
    expect(a2).toMatchObject({ enabled: false, reason: 'no-water' });
  });

  it('a vessel fills from open water only near it', () => {
    const s = sim();
    const pot = give(s, 'base:cooking-pot');
    s.drainEvents();
    send(s, { type: 'useItem', item: pot });
    s.step();
    expect(
      s.drainEvents().some((e) => e.type === 'commandRejected' && e.reason === 'invalid-target'),
    ).toBe(true);
  });

  it('a dry plant stops growing, wilts and withers; rain waters it', () => {
    const s = sim();
    const f = farmingOf(s.world)!;
    const st = s.world.items!;
    const m = minuteNow(s);
    st.farm = new Map([['5,5,0', { crop: 'potato', growth: 0, watered: m }]]);
    const plot = st.farm.get('5,5,0')!;
    farmingSystem(s.world, m, 60, 20);
    expect(plot.growth).toBe(60);
    expect(plotWater(f, plot, m + f.moistMin)).toBe('dry');
    expect(plotWater(f, plot, m + f.wiltMin)).toBe('wilted');
    farmingSystem(s.world, m + f.moistMin, 10, 20);
    expect(plot.growth).toBe(60);
    farmingSystem(s.world, m + f.dieMin, 1, 20);
    expect(plot.dead).toBe(true);
    // Rain: a new plot gets watered.
    const r = sim({ weather: 'rain' });
    r.world.items!.farm = new Map([['5,5,0', { crop: 'potato', growth: 0, watered: 0 }]]);
    farmingSystem(r.world, m, 1, 20);
    expect(r.world.items!.farm.get('5,5,0')!.watered).toBe(m);
  });

  it('snow kills plants; the season runs from April to October', () => {
    const s = sim({ weather: 'snow' });
    const m = minuteNow(s);
    s.world.items!.farm = new Map([['5,5,0', { crop: 'potato', growth: 0, watered: m }]]);
    farmingSystem(s.world, m, 1, 20);
    expect(s.world.items!.farm.get('5,5,0')!.dead).toBe(true);
    const f = farmingOf(s.world)!;
    expect(inSeason(f, m)).toBe(true); // 3 July
    // 1 November = 121 days after 3 July.
    expect(inSeason(f, m + 121 * MINUTES_PER_DAY)).toBe(false);
  });

  it('plots and vessels survive save / load with the same hash', () => {
    const s = sim({ x: 18.5 });
    equip(s, 'base:hoe');
    s.step();
    use(s, 18, 10, 'dig');
    runMinutes(s, farmingOf(s.world)!.digMin + 1);
    const glass = give(s, 'base:glass');
    send(s, { type: 'useItem', item: glass });
    runMinutes(s, 1);
    const bytes = s.save();
    const t = sim({ x: 18.5, load: bytes });
    expect(t.hash()).toBe(s.hash());
    expect(plotAt(t.world, 18, 10, 0)).toBeDefined();
    expect(t.world.items!.items.get(glass)!.waterL).toBeCloseTo(0.25);
  });
});
