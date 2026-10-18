import { CHUNK_SIZE, type SimEvent } from '@deadzone/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { gridWorld, lodSim } from '../test/lod-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { send } from '../test/content-fixtures.js';
import { aiSim } from '../test/ai-fixtures.js';
import { findItem, itemsSim, mainItems } from '../test/item-fixtures.js';
import { ChunkLoot, chunkIndex } from './state.js';

// Heavy worlds (LOD, floors, long health runs): 5 s is too little on a busy shared box.
vi.setConfig({ testTimeout: 30_000 });

let seq = 1000;
const interest = (sim: Sim, cx: number, cy: number, radiusChunks: number, playerId = 0): void => {
  const r = sim.enqueue({
    type: 'setInterest',
    tick: sim.tick,
    playerId,
    seq: seq++,
    cx,
    cy,
    radiusChunks,
  });
  if (!r.ok) throw new Error(r.reason);
};
const live = (sim: Sim, cx: number, cy: number): boolean =>
  sim.world.lod!.chunkLoot[chunkIndex(sim.world.lod!, cx, cy)] === ChunkLoot.live;
const zombiesNear = (sim: Sim, cx: number, cy: number, r: number): number =>
  sim
    .getZombies()
    .filter(
      (z) =>
        Math.abs(Math.floor(z.x / CHUNK_SIZE) - cx) <= r &&
        Math.abs(Math.floor(z.y / CHUNK_SIZE) - cy) <= r,
    ).length;

describe('setInterest (area of interest)', () => {
  it('simulates a far area in detail (loot + zombies) and releases it after clearing', () => {
    const sim = lodSim(gridWorld({ w: 60, h: 60 }), 10, 10, {
      lod: { defaultZombiesPerChunk: 2 },
    });
    sim.step();
    expect(live(sim, 40, 40)).toBe(false);
    expect(zombiesNear(sim, 40, 40, 1)).toBe(0);
    interest(sim, 40, 40, 1);
    for (let i = 0; i < 25; i++) sim.step();
    expect(live(sim, 40, 40)).toBe(true);
    expect(live(sim, 41, 41)).toBe(true);
    expect(zombiesNear(sim, 40, 40, 1)).toBeGreaterThan(0);
    // The player's own area stays active.
    expect(live(sim, 10, 10)).toBe(true);
    interest(sim, 40, 40, 0);
    for (let i = 0; i < 60; i++) sim.step();
    expect(live(sim, 40, 40)).toBe(false);
    expect(zombiesNear(sim, 40, 40, 1)).toBe(0);
  });

  it('is state: saved, loaded and hashed (identical continuation)', () => {
    const world = gridWorld({ w: 60, h: 60 });
    const a = lodSim(world, 10, 10, { lod: { defaultZombiesPerChunk: 2 } });
    interest(a, 30, 12, 2);
    for (let i = 0; i < 40; i++) a.step();
    const save = a.save();
    const b = lodSim(world, 10, 10, { lod: { defaultZombiesPerChunk: 2 }, load: save });
    expect(b.world.interest.get(0)).toEqual({ cx: 30, cy: 12, r: 2 });
    expect(b.hash()).toBe(a.hash());
    for (let i = 0; i < 100; i++) {
      a.step();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
    // Without the interest the state differs.
    const c = lodSim(world, 10, 10, { lod: { defaultZombiesPerChunk: 2 } });
    for (let i = 0; i < 140; i++) c.step();
    expect(c.hash()).not.toBe(a.hash());
  });

  it('has no effect without LOD (small map: everything is active)', () => {
    const open = () =>
      createSim({
        seed: 3,
        map: buildMap(),
        content: fixtureContent(),
        spawn: { x: 10.5, y: 10.5 },
      });
    const a = open();
    const b = open();
    interest(b, 5, 5, 3);
    for (let i = 0; i < 20; i++) {
      a.step();
      b.step();
    }
    expect(b.getZombies()).toEqual(a.getZombies());
    expect(b.world.interest.size).toBe(1);
  });
});

describe('chunkChanged events', () => {
  const chunkEvents = (evs: readonly SimEvent[]) =>
    evs.filter((e) => e.type === 'chunkChanged').map((e) => ({ ...e, tick: 0 }));

  it('no events for chunks the LOD loads or releases (generated state)', () => {
    const sim = lodSim(gridWorld({ w: 60, h: 60 }), 10, 10, {
      lod: { defaultZombiesPerChunk: 1 },
    });
    sim.drainEvents();
    interest(sim, 40, 40, 2);
    for (let i = 0; i < 30; i++) sim.step();
    interest(sim, 40, 40, 0);
    for (let i = 0; i < 60; i++) sim.step();
    expect(chunkEvents(sim.drainEvents())).toEqual([]);
  });

  it('door toggled: one opening event for its chunk at the end of the tick', () => {
    const sim = aiSim({
      map: {
        wallW: (x: number, y: number) => x === 40 && y >= 20 && y < 30,
        edgeId: (x: number, y: number) => (x === 40 && y === 25 ? 2 : 1),
        edgeKinds: [null, 'wall', 'door'] as const,
      },
      spawn: { x: 41, y: 25.5 },
    });
    sim.drainEvents();
    send(sim, { type: 'toggleDoor', tx: 40, ty: 25, side: 'w' });
    sim.step();
    expect(chunkEvents(sim.drainEvents())).toEqual([
      { type: 'chunkChanged', tick: 0, cx: 1, cy: 0, z: 0, reason: 'opening' },
    ]);
    sim.step();
    expect(chunkEvents(sim.drainEvents())).toEqual([]);
  });

  it('ground loot (drop, pick up) emits nothing; placed storage marks its chunk', () => {
    const sim = itemsSim(undefined, { spawn: { x: 32.5, y: 10.5 } });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 5 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:crate-item' });
    sim.step();
    // Items only into the inventory: nothing visible.
    expect(chunkEvents(sim.drainEvents())).toEqual([]);
    const brick = mainItems(sim).find((i) => i.def === 'fixture:brick')!;
    send(sim, { type: 'drop', item: brick.id, count: 2 });
    sim.step();
    // Loose loot reaches the client in the view (`nearby`), not as a chunk rebuild.
    expect(chunkEvents(sim.drainEvents())).toEqual([]);
    const pile = sim.drainView()!.nearby!.find((c) => c.kind === 'ground')!;
    send(sim, { type: 'pickUp', item: sim.getContainer(pile.id)!.items[0]!.id });
    sim.step();
    expect(chunkEvents(sim.drainEvents())).toEqual([]);
    const object = { type: 'chunkChanged', tick: 0, cx: 0, cy: 0, z: 0, reason: 'object' };
    // Crate placed west of the chunk line: chunk (0, 0), reason object.
    send(sim, {
      type: 'placeStorage',
      item: findItem(sim, 'fixture:crate-item')!.id,
      x: 31,
      y: 10,
    });
    sim.step();
    expect(chunkEvents(sim.drainEvents())).toEqual([object]);
  });

  it('a loot change still goes into the save delta (dirty chunk) without a loot event', () => {
    const run = (drop: boolean): Sim => {
      const sim = lodSim(gridWorld({ w: 40, h: 12 }), 6, 6, {
        walkSpeedTilesPerSecond: 16,
        lod: { defaultZombiesPerChunk: 0 },
      });
      sim.step();
      if (drop) {
        send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 3 });
        sim.step();
        const brick = mainItems(sim).find((i) => i.def === 'fixture:brick')!;
        send(sim, { type: 'drop', item: brick.id, count: 2 });
        sim.step();
      }
      expect(chunkEvents(sim.drainEvents())).toEqual([]);
      send(sim, { type: 'move', dx: 1, dy: 0 });
      for (let i = 0; i < 20 * 20 + 20; i++) sim.step(); // ~16 chunks east: (6, 6) released
      expect(sim.drainEvents().some((e) => e.type === 'chunkChanged' && e.reason === 'loot')).toBe(
        false,
      );
      return sim;
    };
    const lodOf = (sim: Sim) => sim.world.lod!;
    const control = run(false);
    expect(lodOf(control).chunkLoot[chunkIndex(lodOf(control), 6, 6)]).toBe(ChunkLoot.none);
    const sim = run(true);
    expect(lodOf(sim).chunkLoot[chunkIndex(lodOf(sim), 6, 6)]).toBe(ChunkLoot.dirty);
    // The dropped pile is part of the save and comes back after a load.
    const b = lodSim(gridWorld({ w: 40, h: 12 }), 6, 6, {
      walkSpeedTilesPerSecond: 16,
      lod: { defaultZombiesPerChunk: 0 },
      load: sim.save(),
    });
    expect(lodOf(b).chunkLoot[chunkIndex(lodOf(b), 6, 6)]).toBe(ChunkLoot.dirty);
    const groundIn66 = (x: Sim) =>
      [...x.world.items!.containers.values()]
        .filter(
          (c) =>
            c.kind === 'ground' &&
            Math.floor(c.x / CHUNK_SIZE) === 6 &&
            Math.floor(c.y / CHUNK_SIZE) === 6,
        )
        .flatMap((c) =>
          c.items.map((id) => {
            const it = x.world.items!.items.get(id)!;
            return [c.x, c.y, it.def, it.count];
          }),
        );
    expect(groundIn66(sim)).toContainEqual([208, 208, expect.any(Number), 2]);
    expect(groundIn66(b)).toEqual(groundIn66(sim));
  });
});
