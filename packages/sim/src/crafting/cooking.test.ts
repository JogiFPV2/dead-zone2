import { describe, expect, it } from 'vitest';
import { saveItemBurntSchema } from '@deadzone/protocol/schema';
import type { ContentBundle } from '@deadzone/content';
import { createSim, type Sim } from '../sim.js';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem, mainItems, rejectedReasons } from '../test/item-fixtures.js';
import { furnitureActionsView, objectFurnitureId } from '../furniture/menu.js';
import { TileGrid } from '../world/grid.js';
import { craftingView } from './crafting.js';

const base = await baseContent();
const burn = base.worldSettings.crafting.burn;

/** Base content with burning set to a fixed chance (skill no longer matters). */
const withBurn = (chance: number): ContentBundle => ({
  ...base,
  worldSettings: {
    ...base.worldSettings,
    crafting: {
      ...base.worldSettings.crafting,
      burn: { ...burn, chance, chancePerSkillLevel: 0 },
    },
  },
});

const RANGE = { contentId: 'base:range', x: 11, y: 10 };

function sim(content: ContentBundle = withBurn(0), load?: Uint8Array): Sim {
  return createSim({
    seed: 6,
    map: buildMap({ width: 32, height: 32, objects: [RANGE] }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...(load ? { load } : {}),
  });
}
const eid = (s: Sim) => s.world.players.get(0)!;
const recipe = (s: Sim, id: string) =>
  craftingView(s.world, eid(s))!.recipes.find((r) => r.id === id)!;
const stove = (s: Sim) =>
  furnitureActionsView(s.world, new TileGrid(s.world.openings.map, s.world.openings), eid(s)).find(
    (f) => f.furnitureId === objectFurnitureId(RANGE.x, RANGE.y, 0, 0),
  )!;
const give = (s: Sim, id: string) => {
  send(s, { type: 'debugGiveItem', itemId: id });
  s.step();
};

describe('cooking on a range (stage 6)', () => {
  it('electric oven needs power; gas burners work without it', () => {
    const s = sim();
    give(s, 'base:potato');
    send(s, { type: 'debugLearnRecipe', recipe: 'base:grill-fish' });
    give(s, 'base:fish-fillet');
    expect(recipe(s, 'base:bake-potato')).toMatchObject({
      state: 'available',
      station: { appliance: 'oven', level: 3 },
    });
    const st = craftingView(s.world, eid(s))!.stations.find((x) => x.id === 'base:station-fire');
    expect(st?.cooking).toEqual({
      burners: { heat: 'gas', on: true },
      oven: { heat: 'electric', on: true },
    });

    s.world.items!.powered = false;
    s.world.items!.version++;
    expect(recipe(s, 'base:bake-potato')).toMatchObject({
      state: 'stationLevelLocked',
      station: { level: 0, noPower: true },
    });
    expect(recipe(s, 'base:grill-fish')).toMatchObject({ state: 'available' });
    send(s, { type: 'craft', recipe: 'base:bake-potato' });
    s.step();
    expect(rejectedReasons(s)).toEqual(['no-power']);

    const menu = stove(s);
    expect(menu.contentId).toBe('base:range');
    const bake = menu.actions.find((a) => a.id === 'cook:base:bake-potato')!;
    expect(bake).toMatchObject({
      enabled: false,
      reason: 'no-power',
      labelPl: 'Baked potato',
      recipe: 'base:bake-potato',
    });
    const grill = menu.actions.find((a) => a.id === 'cook:base:grill-fish')!;
    expect(grill.enabled).toBe(true);
    send(s, { type: 'useFurniture', furnitureId: menu.furnitureId, actionId: grill.id });
    runMinutes(s, 25);
    expect(findItem(s, 'base:grilled-fish')).toBeTruthy();
    expect(findItem(s, 'base:fish-fillet')).toBeUndefined();
  });

  it('burning: chance from cooking skill, burnt food feeds less and saddens; save keeps it', () => {
    const v = (s: Sim) => s.world.survival!.vitals;
    const def = sim(base);
    expect(recipe(def, 'base:bake-potato').burnChance).toBe(burn.chance);
    send(def, { type: 'debugSkill', skill: burn.skill, level: 10 });
    def.step();
    expect(recipe(def, 'base:bake-potato').burnChance).toBeUndefined();

    const s = sim(withBurn(1));
    give(s, 'base:potato');
    send(s, { type: 'craft', recipe: 'base:bake-potato' });
    runMinutes(s, 50);
    const crafted = s.drainEvents().find((e) => e.type === 'crafted');
    expect(crafted).toMatchObject({ recipe: 'base:bake-potato', burnt: true });
    const burnt = findItem(s, 'base:baked-potato')!;
    expect(burnt.burnt).toBe(true);

    const ok = sim(withBurn(0));
    give(ok, 'base:potato');
    send(ok, { type: 'craft', recipe: 'base:bake-potato' });
    runMinutes(ok, 50);
    const good = findItem(ok, 'base:baked-potato')!;
    expect(good.burnt).toBeUndefined();

    for (const x of [s, ok]) {
      send(x, { type: 'debugStat', stat: 'hunger', value: 80 });
      send(x, { type: 'debugStat', stat: 'unhappiness', value: 20 });
    }
    const back = sim(withBurn(1), s.save());
    expect(findItem(back, 'base:baked-potato')!.burnt).toBe(true);
    expect(back.hash()).toBe(s.hash());

    for (const x of [s, ok]) {
      send(x, { type: 'useItem', item: findItem(x, 'base:baked-potato')!.id });
      runMinutes(x, 15);
    }
    const p = eid(s);
    const q = eid(ok);
    const fedBurnt = 80 - (v(s).hunger[p] ?? 0);
    const fedGood = 80 - (v(ok).hunger[q] ?? 0);
    expect(fedBurnt).toBeGreaterThan(0);
    expect(fedBurnt).toBeLessThan(fedGood);
    expect(v(s).unhappiness[p]).toBeGreaterThan(v(ok).unhappiness[q]!);
    expect(saveItemBurntSchema.parse({ burnt: true })).toEqual({ burnt: true });
    expect(saveItemBurntSchema.safeParse({ burnt: false }).success).toBe(false);
  });

  it('burnt and good pieces never stack together', () => {
    const s = sim(withBurn(1));
    give(s, 'base:potato');
    send(s, { type: 'craft', recipe: 'base:bake-potato' });
    runMinutes(s, 50);
    send(s, { type: 'debugGiveItem', itemId: 'base:baked-potato' });
    s.step();
    const baked = mainItems(s).filter((i) => i.def === 'base:baked-potato');
    expect(baked.map((i) => i.burnt ?? false).sort()).toEqual([false, true]);
  });
});
