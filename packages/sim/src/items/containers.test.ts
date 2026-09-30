import { describe, expect, it } from 'vitest';
import {
  baseContent,
  fixtureContent,
  runMinutes,
  send,
  TICKS_PER_MIN,
} from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { survivalSim } from '../test/content-fixtures.js';
import { itemsSim, rejectedReasons, worldContainer } from '../test/item-fixtures.js';
import { createItemStore } from './store.js';
import { compileContent } from '../content/adapter.js';
import { createWorldContainers, generateLoot, lootTableFor, lootWeight } from './loot.js';

describe('world storage from map objects', () => {
  it('creates storage for container types and placeables with containerType, with room types', () => {
    const sim = itemsSim();
    const cab = worldContainer(sim, 11, 10);
    expect(cab).toMatchObject({ kind: 'world', type: 'fixture:cabinet', capacityKg: 20, z: 0 });
    // Unsearched: no items yet (lazy loot).
    expect(cab.items).toEqual([]);
    const nearby = sim.drainView()!.nearby!;
    expect(nearby.map((c) => c.type)).toEqual(['fixture:cabinet', 'fixture:fridge']);
    expect(nearby.every((c) => !c.searched)).toBe(true);
  });

  it('search is a timed action (searchMin); loot appears on completion; reopening is instant', () => {
    const sim = itemsSim();
    const cab = worldContainer(sim, 11, 10);
    send(sim, { type: 'openContainer', container: cab.id });
    sim.step();
    expect(sim.getAction()).toMatchObject({
      kind: 'search',
      container: cab.id,
      startTick: 0,
      endTick: 2 * TICKS_PER_MIN,
    });
    runMinutes(sim, 1.9);
    expect(sim.getContainer(cab.id)!.items).toEqual([]);
    runMinutes(sim, 0.2);
    const events = sim.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'containerOpened', container: cab.id, firstSearch: true }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'actionCompleted', action: 'search' }),
    );
    const view = sim.drainView()!;
    expect(view.container!.id).toBe(cab.id);
    expect(view.container!.items.length).toBeGreaterThan(0);
    expect(view.action ?? null).toBeNull();
    send(sim, { type: 'closeContainer' });
    sim.step();
    expect(sim.drainView()!.container).toBeNull();
    send(sim, { type: 'openContainer', container: cab.id });
    sim.step();
    expect(sim.getAction()).toBeNull();
    expect(sim.drainView()!.container!.id).toBe(cab.id);
  });

  it('moving interrupts the search and clears the queue; out-of-reach storage is rejected', () => {
    const sim = itemsSim();
    const cab = worldContainer(sim, 11, 10);
    const fridge = worldContainer(sim, 9, 10);
    const crate = worldContainer(sim, 10, 13);
    send(sim, { type: 'openContainer', container: cab.id });
    send(sim, { type: 'openContainer', container: fridge.id });
    send(sim, { type: 'openContainer', container: crate.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['out-of-range']);
    expect(sim.getAction()).toMatchObject({ kind: 'search', queued: 1 });
    runMinutes(sim, 1);
    send(sim, { type: 'move', dx: 0, dy: 1 });
    sim.step();
    expect(sim.getAction()).toBeNull();
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'actionInterrupted', action: 'search', reason: 'moved' }),
    );
    expect(sim.getContainer(cab.id)!.items).toEqual([]);
  });

  it('cancelAction stops the current action', () => {
    const sim = itemsSim();
    send(sim, { type: 'openContainer', container: worldContainer(sim, 11, 10).id });
    sim.step();
    send(sim, { type: 'cancelAction' });
    sim.step();
    expect(sim.getAction()).toBeNull();
    send(sim, { type: 'cancelAction' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-state']);
  });

  it('the loot panel closes when the player walks away; items only move while in reach', () => {
    const sim = itemsSim();
    const cab = worldContainer(sim, 11, 10);
    send(sim, { type: 'openContainer', container: cab.id });
    runMinutes(sim, 2.1);
    const loot = sim.getContainer(cab.id)!.items[0]!;
    send(sim, { type: 'pickUp', item: loot.id });
    sim.step();
    expect(sim.getContainer(cab.id)!.items.map((i) => i.id)).not.toContain(loot.id);
    send(sim, { type: 'moveItem', item: loot.id, to: cab.id });
    sim.step();
    expect(sim.getContainer(cab.id)!.items.map((i) => i.id)).toContain(loot.id);
    sim.drainView();
    send(sim, { type: 'move', dx: -1, dy: 0 });
    runMinutes(sim, 0.5);
    expect(sim.drainView()!.container).toBeNull();
    send(sim, { type: 'move', dx: 0, dy: 0 });
    send(sim, { type: 'pickUp', item: loot.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['out-of-range']);
  });
});

describe('loot generation', () => {
  const content = fixtureContent();
  const index = compileContent(content);

  it('picks the table by room + container, else the type default, else nothing', () => {
    const st = createItemStore(index);
    createWorldContainers(
      st,
      buildMap({
        objects: [
          { contentId: 'fixture:cabinet', x: 1, y: 1 },
          { contentId: 'fixture:cabinet', x: 3, y: 3 },
          { contentId: 'fixture:fridge', x: 1, y: 2 },
        ],
        room: (x) => (x < 2 ? 1 : 0),
        rooms: { '1': 'fixture:room-kitchen' },
      }),
      1,
    );
    const [kitchen, outside, fridge] = [...st.containers.values()];
    expect(lootTableFor(st, kitchen!)?.id).toBe('fixture:kitchen');
    expect(lootTableFor(st, outside!)?.id).toBe('fixture:default');
    expect(lootTableFor(st, fridge!)).toBeUndefined();
  });

  it('rarity scales weights: max(1, floor(w × pct / 100)), 0 when pct = 0', () => {
    const st = createItemStore(
      compileContent(
        fixtureContent({ loot: { rarityWeightPct: { uncommon: 50, rare: 0, very_rare: 1000 } } }),
      ),
    );
    expect(lootWeight(st, 5, 'common')).toBe(5);
    expect(lootWeight(st, 5, 'uncommon')).toBe(2);
    expect(lootWeight(st, 1, 'uncommon')).toBe(1);
    expect(lootWeight(st, 3, 'rare')).toBe(0);
    expect(lootWeight(st, 3, 'very_rare')).toBe(30);
  });

  const lootOf = (seed: number, x = 1, pct?: object) => {
    const st = createItemStore(compileContent(pct ? fixtureContent({ loot: pct }) : content));
    createWorldContainers(
      st,
      buildMap({
        objects: [{ contentId: 'fixture:cabinet', x, y: 1 }],
        room: () => 1,
        rooms: { '1': 'fixture:room-kitchen' },
      }),
      seed,
    );
    const c = [...st.containers.values()][0]!;
    generateLoot(st, c, 0);
    return c.items.map((id) => {
      const i = st.items.get(id)!;
      return `${st.content.items[i.def]!.id}×${i.count}`;
    });
  };

  it('is deterministic per seed and position, and differs between them', () => {
    expect(lootOf(1)).toEqual(lootOf(1));
    const variants = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(lootOf(s))));
    expect(variants.size).toBeGreaterThan(1);
    const positions = new Set([1, 2, 3, 4, 5, 6].map((x) => JSON.stringify(lootOf(1, x))));
    expect(positions.size).toBeGreaterThan(1);
  });

  it('nested tables and ammo boxes; rare entries disappear at pct 0', () => {
    const all = Array.from({ length: 40 }, (_, s) => lootOf(s)).flat();
    expect(all.some((x) => x.startsWith('fixture:ammo-box'))).toBe(true);
    expect(all.some((x) => x.startsWith('fixture:opener'))).toBe(true);
    const noRare = Array.from({ length: 40 }, (_, s) =>
      lootOf(s, 1, { rarityWeightPct: { rare: 0, uncommon: 0 } }),
    ).flat();
    expect(noRare.some((x) => x.startsWith('fixture:opener') || x.includes('ammo'))).toBe(false);
  });

  it('does not depend on the order containers are opened', () => {
    const open = (order: number[]) => {
      const sim = itemsSim(content, { spawn: { x: 10.5, y: 10.5 } });
      const ids = [worldContainer(sim, 11, 10).id, worldContainer(sim, 9, 10).id];
      for (const i of order) {
        send(sim, { type: 'openContainer', container: ids[i]! });
        runMinutes(sim, 2.1);
      }
      return ids.map((id) => sim.getContainer(id)!.items.map((i) => i.def));
    };
    expect(open([0, 1])).toEqual(open([1, 0]));
  });

  it('base pack: kitchen cabinet in base:room-kitchen uses base:kitchen', async () => {
    const base = await baseContent();
    const sim = survivalSim(base, {
      map: buildMap({
        objects: [{ contentId: 'base:kitchen-cabinet', x: 11, y: 10 }],
        room: () => 1,
        rooms: { '1': 'base:room-kitchen' },
      }),
    });
    const st = sim.world.items!;
    expect(lootTableFor(st, st.containers.get(1)!)?.id).toBe('base:kitchen');
  });
});
