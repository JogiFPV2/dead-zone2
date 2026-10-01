import type { NearbyContainerView, SimEvent } from '@deadzone/protocol';
import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { createSim, type Sim } from '../sim.js';
import { aiSim, eventsOf, NOON, runTicks, zombie } from '../test/ai-fixtures.js';
import { fixturePack, runMinutes, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { itemsSim, mainItems, rejectedReasons, worldContainer } from '../test/item-fixtures.js';

/** 3.5 s at 20 Hz. */
const SEARCH_TICKS = 70;

const DEAF = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

/** Player with a bat next to a zombie that does not wander; kills it and returns its corpse id. */
function killZombie(seed = 11): {
  sim: Sim;
  sid: number;
  corpse: number;
  near: NearbyContainerView;
  events: SimEvent[];
} {
  const sim = aiSim({ seed, zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
  send(sim, { type: 'debugGiveItem', itemId: 'fixture:bat' });
  sim.step();
  send(sim, { type: 'equip', item: mainItems(sim)[0]!.id, slot: 'hand_primary' });
  send(sim, { type: 'aim', x: 12, y: 10.5 });
  sim.step();
  const sid = zombie(sim).stableId;
  const events: SimEvent[] = [];
  for (let i = 0; i < 400 && sim.getZombies().length > 0; i++) {
    send(sim, { type: 'attack' });
    sim.step();
    events.push(...sim.drainEvents());
  }
  expect(sim.getZombies()).toEqual([]);
  // Let the swing cooldown pass.
  runTicks(sim, 30);
  events.push(...sim.drainEvents());
  const near = sim.drainView()!.nearby!.find((c) => c.kind === 'corpse')!;
  return { sim, sid, corpse: near.id, near, events };
}

describe('search: containers', () => {
  it('storage without searchMin takes searchSec (3.5 s) with progress 0..1 in the view', () => {
    const sim = itemsSim();
    const fridge = worldContainer(sim, 9, 10);
    send(sim, { type: 'search', container: fridge.id });
    sim.step();
    const a = sim.getAction()!;
    expect(a).toMatchObject({ kind: 'search', container: fridge.id });
    expect(a.endTick - a.startTick).toBe(SEARCH_TICKS);
    expect(sim.drainView()!.action).toMatchObject({ kind: 'search', progress: 0 });
    runTicks(sim, 35);
    expect(sim.drainView()!.action!.progress).toBeCloseTo(0.5, 1);
    // Contents stay hidden while searching.
    expect(sim.getContainer(fridge.id)!.items).toEqual([]);
    runTicks(sim, 40);
    const ev = sim.drainEvents();
    expect(ev).toContainEqual(
      expect.objectContaining({ type: 'containerOpened', container: fridge.id, firstSearch: true }),
    );
    expect(sim.getAction()).toBeNull();
    const view = sim.drainView()!;
    expect(view.container!.id).toBe(fridge.id);
    expect(view.nearby!.find((c) => c.id === fridge.id)!.searched).toBe(true);
  });

  it('contents of unsearched storage are not reachable; storage with searchMin keeps it', () => {
    const sim = itemsSim();
    const cab = worldContainer(sim, 11, 10);
    send(sim, { type: 'takeAll', container: cab.id });
    sim.step();
    expect(rejectedReasons(sim)).toHaveLength(1);
    expect(sim.drainView()!.container ?? null).toBeNull();
    send(sim, { type: 'search', container: cab.id });
    sim.step();
    const a = sim.getAction()!;
    expect(a.endTick - a.startTick).toBe(100); // searchMin 2 (50 ticks / game minute)
  });

  it('rejects bad targets: none, both, own inventory, out of reach', () => {
    const sim = itemsSim();
    const inv = sim.getInventory()!.container;
    send(sim, { type: 'search' });
    send(sim, { type: 'search', container: worldContainer(sim, 11, 10).id, x: 10, y: 10 });
    send(sim, { type: 'search', container: inv });
    send(sim, { type: 'search', x: 30, y: 30 });
    send(sim, { type: 'search', container: worldContainer(sim, 40, 40).id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual([
      'invalid-target',
      'invalid-target',
      'invalid-target',
      'out-of-range',
      'out-of-range',
    ]);
    expect(sim.getAction()).toBeNull();
  });

  it('moving cancels the search (actionInterrupted moved), nothing is revealed', () => {
    const sim = itemsSim();
    const fridge = worldContainer(sim, 9, 10);
    send(sim, { type: 'search', container: fridge.id });
    runTicks(sim, 20);
    send(sim, { type: 'move', dx: 0, dy: 1 });
    sim.step();
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'actionInterrupted', action: 'search', reason: 'moved' }),
    );
    expect(sim.getAction()).toBeNull();
    expect(sim.drainView()!.nearby!.find((c) => c.id === fridge.id)?.searched ?? false).toBe(false);
  });
});

describe('search: zombie corpses', () => {
  it('a killed zombie leaves a corpse container; loot only after search; takeAll → itemPicked', () => {
    const { sim, sid, corpse, near } = killZombie();
    expect(near).toMatchObject({ kind: 'corpse', corpse: sid, searched: false, x: 11, y: 10 });
    expect(sim.getContainer(corpse)!.items).toEqual([]);
    send(sim, { type: 'takeAll', container: corpse });
    sim.step();
    expect(rejectedReasons(sim)).toHaveLength(1);
    send(sim, { type: 'search', container: corpse });
    sim.step();
    const a = sim.getAction()!;
    expect(a.endTick - a.startTick).toBe(SEARCH_TICKS);
    runTicks(sim, SEARCH_TICKS + 1);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'containerOpened', container: corpse, firstSearch: true }),
    );
    const items = sim.getContainer(corpse)!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => ['fixture:bandage', 'fixture:beans'].includes(i.def))).toBe(true);
    send(sim, { type: 'takeAll', container: corpse });
    sim.step();
    const picked = eventsOf(sim.drainEvents(), 'itemPicked');
    expect(picked.map((e) => e.defId).sort()).toEqual(items.map((i) => i.def).sort());
    expect(picked.every((e) => e.source === 'corpse' && e.container === corpse)).toBe(true);
    expect(sim.getContainer(corpse)!.items).toEqual([]);
  });

  it('the drop is deterministic per seed and kill', () => {
    const drop = (seed: number) => {
      const { sim, corpse } = killZombie(seed);
      send(sim, { type: 'search', container: corpse });
      runTicks(sim, SEARCH_TICKS + 2);
      return JSON.stringify(sim.getContainer(corpse)!.items.map((i) => [i.def, i.count]));
    };
    expect(drop(11)).toBe(drop(11));
    const runs = new Set([11, 12, 13, 14, 15, 16].map(drop));
    expect(runs.size).toBeGreaterThan(1);
  });

  it('attacking cancels the search (actionInterrupted attack)', () => {
    const { sim, corpse } = killZombie();
    send(sim, { type: 'search', container: corpse });
    runTicks(sim, 10);
    send(sim, { type: 'attack' });
    sim.step();
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'actionInterrupted', action: 'search', reason: 'attack' }),
    );
    expect(sim.getAction()).toBeNull();
    expect(sim.getContainer(corpse)!.items).toEqual([]);
  });
});

/** Extra pack: asphalt (tag road) / grass floor, street scatter + hidden bush caches. */
function scatterContent(): ContentBundle {
  const fixture = fixturePack();
  return buildContentBundle([
    { ...fixture, files: [...fixture.files] },
    {
      dir: 'scat',
      files: [
        {
          path: 'mod.json',
          json: {
            id: 'scat',
            name: 'Scatter',
            version: '0.0.0',
            dependencies: [{ id: 'fixture' }],
          },
        },
        {
          path: 'tiles/floor.json',
          json: [
            {
              id: 'scat:asphalt',
              name: 'tile.scat.asphalt',
              category: 'floor',
              tags: ['scat:road'],
            },
            { id: 'scat:grass', name: 'tile.scat.grass', category: 'floor', tags: [] },
          ],
        },
        {
          path: 'loot-tables/scatter.json',
          json: [
            {
              id: 'scat:street',
              rolls: { min: 1, max: 1 },
              scatter: { terrain: ['scat:road'], perChunk: { min: 3, max: 3 } },
              entries: [{ item: 'fixture:brick', weight: 1 }],
            },
            {
              id: 'scat:bushes',
              rolls: { min: 1, max: 1 },
              scatter: { zones: ['bushes'], perChunk: { min: 2, max: 2 }, hiddenChance: 1 },
              entries: [{ item: 'fixture:bandage', weight: 1 }],
            },
          ],
        },
      ],
    },
  ]);
}

const BUSH = { x: 40, y: 40, w: 4, h: 4 };
const scatterMap = buildMap({
  floor: (x) => (x < 32 ? 1 : 2),
  floorTiles: [null, 'scat:asphalt', 'scat:grass'],
  zones: [{ id: 'bush-1', role: 'bushes', z: 0, rects: [BUSH] }],
});
const scatterSim = (seed: number, spawn = { x: 10.5, y: 10.5 }): Sim =>
  createSim({
    seed,
    map: scatterMap,
    spawn,
    content: scatterContent(),
    dev: true,
    clockStart: NOON,
    floorLoot: true,
  });

const hiddenTiles = (sim: Sim): { x: number; y: number }[] =>
  [...sim.world.items!.hidden.values()].map((id) => {
    const c = sim.world.items!.containers.get(id)!;
    return { x: c.x, y: c.y };
  });

describe('scattered loot', () => {
  it('scatters by terrain tag and zone, deterministically per seed; hidden caches stay out of view', () => {
    const sim = scatterSim(3);
    const st = sim.world.items!;
    const ground = [...st.ground.values()].map((id) => st.containers.get(id)!);
    expect(ground.length).toBeGreaterThan(0);
    // Street table: asphalt only (x < 32), 2 chunks × 3 bricks.
    expect(ground.every((c) => c.x < 32)).toBe(true);
    const bricks = ground.flatMap((c) => c.items).map((id) => st.items.get(id)!);
    expect(bricks.reduce((n, i) => n + i.count, 0)).toBe(6);
    // Bush table: only hidden caches inside the zone.
    const hidden = hiddenTiles(sim);
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) {
      expect(t.x >= BUSH.x && t.x < BUSH.x + BUSH.w && t.y >= BUSH.y && t.y < BUSH.y + BUSH.h).toBe(
        true,
      );
    }
    const layout = (s: Sim) => JSON.stringify([[...s.world.items!.ground.keys()], hiddenTiles(s)]);
    expect(layout(scatterSim(3))).toBe(layout(sim));
    expect(layout(scatterSim(4))).not.toBe(layout(sim));
  });

  it('without a floor palette terrain tables find nothing', () => {
    const sim = createSim({
      seed: 3,
      map: buildMap({ zones: [{ id: 'bush-1', role: 'bushes', z: 0, rects: [BUSH] }] }),
      content: scatterContent(),
      floorLoot: true,
    });
    expect(sim.world.items!.ground.size).toBe(0);
    expect(sim.world.items!.hidden.size).toBeGreaterThan(0);
  });

  it('spot search reveals hidden caches in the radius as ground piles (spotSearched)', () => {
    const cache = hiddenTiles(scatterSim(3))[0]!;
    const sim = scatterSim(3, { x: cache.x + 0.5, y: cache.y + 0.5 });
    const st = sim.world.items!;
    const cacheId = st.hidden.get([...st.hidden.keys()][0]!)!;
    const hiddenItem = st.containers.get(cacheId)!.items[0]!;
    sim.step();
    const before = sim.drainView()!;
    expect((before.nearby ?? []).some((c) => c.x === cache.x && c.y === cache.y)).toBe(false);
    send(sim, { type: 'pickUp', item: hiddenItem });
    sim.step();
    expect(rejectedReasons(sim)).toHaveLength(1);

    send(sim, { type: 'search', x: cache.x, y: cache.y });
    sim.step();
    expect(sim.drainView()!.action).toMatchObject({
      kind: 'search',
      progress: 0,
      spot: { x: cache.x, y: cache.y, z: 0 },
    });
    runTicks(sim, SEARCH_TICKS + 1);
    const ev = sim.drainEvents();
    const spot = eventsOf(ev, 'spotSearched');
    expect(spot).toHaveLength(1);
    expect(spot[0]).toMatchObject({ playerId: 0, z: 0 });
    expect(spot[0]!.found.length).toBeGreaterThan(0);
    expect(spot[0]!.found.every((f) => f.defId === 'fixture:bandage')).toBe(true);
    const pileId = spot[0]!.found[0]!.container;
    const pile = sim.drainView()!.nearby!.find((c) => c.id === pileId)!;
    expect(pile).toMatchObject({ kind: 'ground' });
    send(sim, { type: 'takeAll', container: pileId });
    sim.step();
    const picked = eventsOf(sim.drainEvents(), 'itemPicked');
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((e) => e.source === 'ground' && e.defId === 'fixture:bandage')).toBe(true);
    // A second search of the same spot finds nothing.
    send(sim, { type: 'search', x: cache.x, y: cache.y });
    runTicks(sim, SEARCH_TICKS + 2);
    const again = eventsOf(sim.drainEvents(), 'spotSearched');
    expect(again).toHaveLength(1);
    expect(again[0]!.found).toEqual([]);
  });

  it('save / load keeps hidden caches and a running spot search', () => {
    const cache = hiddenTiles(scatterSim(5))[0]!;
    const a = scatterSim(5, { x: cache.x + 0.5, y: cache.y + 0.5 });
    send(a, { type: 'search', x: cache.x, y: cache.y });
    runTicks(a, 20);
    const b = createSim({
      seed: 1,
      map: scatterMap,
      content: scatterContent(),
      dev: true,
      clockStart: NOON,
      load: a.save(),
    });
    expect(b.hash()).toBe(a.hash());
    runTicks(a, 60);
    runTicks(b, 60);
    expect(b.hash()).toBe(a.hash());
    expect(b.world.items!.hidden.size).toBe(a.world.items!.hidden.size);
  });
});

describe('item events', () => {
  it('drop / pickUp / putItem / takeItem emit itemDropped / itemPicked', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:beans', count: 2 });
    sim.step();
    sim.drainEvents();
    const beans = mainItems(sim).find((i) => i.def === 'fixture:beans')!;
    send(sim, { type: 'drop', item: beans.id, count: 1 });
    sim.step();
    const dropped = eventsOf(sim.drainEvents(), 'itemDropped');
    expect(dropped).toEqual([
      expect.objectContaining({ playerId: 0, defId: 'fixture:beans', count: 1, target: 'ground' }),
    ]);
    send(sim, { type: 'pickUp', item: dropped[0]!.itemId });
    sim.step();
    expect(eventsOf(sim.drainEvents(), 'itemPicked')).toEqual([
      expect.objectContaining({ defId: 'fixture:beans', count: 1, source: 'ground' }),
    ]);

    const cab = worldContainer(sim, 11, 10);
    send(sim, { type: 'search', container: cab.id });
    runMinutes(sim, 2.1);
    sim.drainEvents();
    const item = mainItems(sim).find((i) => i.def === 'fixture:beans')!;
    send(sim, { type: 'putItem', container: cab.id, item: item.id, count: 1 });
    sim.step();
    const put = eventsOf(sim.drainEvents(), 'itemDropped');
    expect(put).toEqual([
      expect.objectContaining({
        defId: 'fixture:beans',
        count: 1,
        target: 'world',
        container: cab.id,
      }),
    ]);
    send(sim, { type: 'takeItem', container: cab.id, item: put[0]!.itemId });
    sim.step();
    expect(eventsOf(sim.drainEvents(), 'itemPicked')).toEqual([
      expect.objectContaining({
        defId: 'fixture:beans',
        count: 1,
        source: 'world',
        container: cab.id,
      }),
    ]);
  });
});
