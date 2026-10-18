import { describe, expect, it } from 'vitest';
import { saveWaterTanksSchema } from '@deadzone/protocol/schema';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { rejectedReasons } from '../test/item-fixtures.js';
import { furnitureActionsView, objectFurnitureId } from './menu.js';
import { TileGrid } from '../world/grid.js';
import { carriedItems } from '../items/actions.js';
import { defOf } from '../items/store.js';
import { playerItems } from '../items/inventory.js';
import { utf8Decode } from '../save/codec.js';
import { BOTTLE_L, TANK_DRINK_L } from './water.js';

const content = await baseContent();
const hy = content.worldSettings.survival.hygiene;

const TOILET = { contentId: 'base:toilet', x: 11, y: 10 };
const SINK = { contentId: 'base:kitchen-sink', x: 9, y: 10 };
const TOILET_ID = objectFurnitureId(TOILET.x, TOILET.y, 0, 0);
const SINK_ID = objectFurnitureId(SINK.x, SINK.y, 0, 0);

function sim(load?: Uint8Array): Sim {
  return createSim({
    seed: 4,
    map: buildMap({ width: 32, height: 32, objects: [TOILET, SINK] }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(load ? { load } : {}),
  });
}
const eid = (s: Sim) => s.world.players.get(0)!;
const menu = (s: Sim, id: number) =>
  furnitureActionsView(s.world, new TileGrid(s.world.openings.map, s.world.openings), eid(s)).find(
    (f) => f.furnitureId === id,
  )!;
const act = (s: Sim, id: number, actionId: string) =>
  menu(s, id).actions.find((a) => a.id === actionId)!;
const use = (s: Sim, furnitureId: number, actionId: string, min = 2) => {
  send(s, { type: 'useFurniture', furnitureId, actionId });
  runMinutes(s, min);
};
const thirst = (s: Sim) => s.world.survival!.vitals.thirst[eid(s)] ?? 0;
const carried = (s: Sim) => {
  const st = s.world.items!;
  const p = playerItems(s.world, eid(s))!;
  return carriedItems(st, p.inventory).map((it) => ({ id: defOf(st, it).id, uses: it.uses }));
};
const litres = (s: Sim) => menu(s, TOILET_ID).waterTank!.litres;

describe('furniture water tanks (placeable.waterTank)', () => {
  it('toilet: menu shows the tank; full and refilled while the mains run', () => {
    const s = sim();
    const m = menu(s, TOILET_ID);
    expect(m.typeId).toBe('toilet');
    expect(m.waterTank).toEqual({ litres: 10, capacityL: 10, quality: 'tainted' });
    expect(m.actions.map((a) => a.id)).toEqual(['drink-tank', 'fill-water']);
    send(s, { type: 'debugStat', stat: 'thirst', value: 60 });
    use(s, TOILET_ID, 'drink-tank', hy.drinkTap.durationMin + 1);
    expect(thirst(s)).toBeLessThan(60 - hy.drinkTap.thirst + 2);
    expect(litres(s)).toBe(10);
    expect(s.world.items!.waterTanks).toBeUndefined();
  });

  it('mains off: the tank only drains; empty = greyed out with a reason; save keeps litres', () => {
    const s = sim();
    s.world.items!.water = false;
    send(s, { type: 'debugStat', stat: 'thirst', value: 90 });
    use(s, TOILET_ID, 'drink-tank', hy.drinkTap.durationMin + 1);
    expect(litres(s)).toBeCloseTo(10 - TANK_DRINK_L, 3);
    // Tainted water fills a dirty-water bottle.
    send(s, { type: 'debugGiveItem', itemId: 'base:bottle', count: 2 });
    s.step();
    use(s, TOILET_ID, 'fill-water');
    expect(carried(s)).toContainEqual({ id: 'base:dirty-water-bottle', uses: 5 });
    expect(carried(s).map((c) => c.id)).toContain('base:bottle');
    expect(litres(s)).toBeCloseTo(10 - TANK_DRINK_L - BOTTLE_L, 3);

    // Save: the field is written only while not full; the load gives the same state.
    const bytes = s.save();
    const back = sim(bytes);
    expect(back.hash()).toBe(s.hash());
    expect(litres(back)).toBeCloseTo(litres(s), 5);
    expect([...back.world.items!.waterTanks!.entries()]).toEqual([
      ['11,10,0,0', expect.any(Number)],
    ]);
    expect(
      saveWaterTanksSchema.parse({ waterTanks: [...s.world.items!.waterTanks!.entries()] }),
    ).toBeTruthy();

    // Drain it: greyed out with „Pusty zbiornik”.
    s.world.items!.waterTanks!.set('11,10,0,0', 0);
    const drink = act(s, TOILET_ID, 'drink-tank');
    expect(drink).toMatchObject({ enabled: false, reason: 'no-water', reasonPl: 'Pusty zbiornik' });
    expect(act(s, TOILET_ID, 'fill-water')).toMatchObject({ enabled: false, reason: 'no-water' });
    send(s, { type: 'useFurniture', furnitureId: TOILET_ID, actionId: 'drink-tank' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-water']);
  });

  it('older saves (no waterTanks) = full tanks; a full tank writes nothing', () => {
    const s = sim();
    runMinutes(s, 5);
    const text = utf8Decode(s.save());
    expect(text).not.toContain('waterTanks');
    expect(litres(sim(s.save()))).toBe(10);
  });

  it('sink (tap on mains): fill a bottle with clean water, top up a partial one; no-water when off', () => {
    const s = sim();
    expect(menu(s, SINK_ID).waterTank).toBeUndefined();
    expect(menu(s, SINK_ID).actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(['drink-tap', 'fill-water', 'wash']),
    );
    expect(act(s, SINK_ID, 'fill-water')).toMatchObject({ enabled: false, reason: 'missing-item' });
    send(s, { type: 'debugGiveItem', itemId: 'base:bottle' });
    s.step();
    use(s, SINK_ID, 'fill-water');
    expect(carried(s)).toEqual([{ id: 'base:water-bottle', uses: 5 }]);
    const st = s.world.items!;
    const bottle = [...st.items.values()].find((it) => defOf(st, it).id === 'base:water-bottle')!;
    bottle.uses = 2;
    use(s, SINK_ID, 'fill-water');
    expect(bottle.uses).toBe(5);
    bottle.uses = 2;
    st.water = false;
    expect(act(s, SINK_ID, 'fill-water')).toMatchObject({
      enabled: false,
      reason: 'no-water',
      reasonPl: 'Brak wody w sieci',
    });
  });
});
