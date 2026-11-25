import { CHUNK_SIZE, simMapFromWorldSource, type WorldSource } from '@deadzone/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createSim } from '../sim.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { NOON } from '../test/ai-fixtures.js';
import { gridWorld } from '../test/lod-fixtures.js';

vi.setConfig({ testTimeout: 30_000 });

/**
 * Lazy worlds (OSM tiles of stw2 loaded in the background): a chunk whose data is not in yet
 * must not become an empty placeholder for good (no storage in houses, Paweł 25.11).
 */
describe('lod: chunks of a lazy world that load late', () => {
  it('storage appears once the column is loaded; the empty placeholder is not cached', () => {
    const base = gridWorld({ w: 40, h: 40, houseObjects: 3 });
    let loaded = false;
    const world: WorldSource = {
      ...base,
      getChunk: (cx, cy, z) => (loaded ? base.getChunk(cx, cy, z) : undefined),
      ready: () => loaded,
    };
    const map = simMapFromWorldSource(world);
    const sim = createSim({
      seed: 3,
      map,
      world,
      content: fixtureContent(),
      dev: true,
      clockStart: NOON,
      spawn: { x: 20 * CHUNK_SIZE + 6.5, y: 20 * CHUNK_SIZE + 5.5 },
      lod: { defaultZombiesPerChunk: 0 },
    });
    const storage = () =>
      [...sim.world.items!.containers.values()].filter((c) => c.kind === 'world').length;
    for (let i = 0; i < 5; i++) sim.step();
    expect(storage()).toBe(0);
    expect(map.getChunk(20, 20, 0)).toBeUndefined();
    loaded = true;
    for (let i = 0; i < 25; i++) sim.step();
    expect(map.getChunk(20, 20, 0)?.objects?.length).toBe(3);
    expect(storage()).toBeGreaterThan(0);
    const near = sim.drainView()?.nearby ?? [];
    expect(near.some((n) => n.kind === 'world')).toBe(true);
  });
});
