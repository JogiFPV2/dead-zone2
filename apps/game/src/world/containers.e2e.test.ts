// End to end: base:test-town (content) -> ChunkSource -> SimMap adapter -> real sim world storage.
import { describe, expect, it } from 'vitest';
import {
  BASE_PACK_DIR,
  buildContentBundleFromDirs,
  validatePackDirs,
} from '@deadzone/content/node';
import { createSim } from '@deadzone/sim';
import { mapDataToChunkSource } from './content-map.js';
import { chunkSourceToSimMap } from './sim-map.js';
import { startSpawn } from './zones.js';

async function testTown() {
  const r = await validatePackDirs([BASE_PACK_DIR]);
  const data = r.maps.find((m) => m.id === 'base:test-town');
  if (!data) throw new Error('test-town missing');
  return mapDataToChunkSource(data);
}

describe('map objects and rooms reach the sim', () => {
  it('creates world storage from test-town objects, with room types for loot', async () => {
    const [map, content] = await Promise.all([
      testTown(),
      buildContentBundleFromDirs([BASE_PACK_DIR]),
    ]);
    const spawn = startSpawn(map.zones);
    if (!spawn) throw new Error('no start zone');
    const sim = createSim({
      seed: 1,
      map: chunkSourceToSimMap(map.source, map.range),
      // Next to the start crate in the yard by the start (crates never stand on the street).
      spawn: { ...spawn, x: -57.5, y: 6.5 },
      content,
    });
    sim.step();
    const nearby = sim.drainView()?.nearby ?? [];
    expect(nearby).toContainEqual(
      expect.objectContaining({ kind: 'world', type: 'base:crate', x: -58, y: 6, z: 0 }),
    );
  });

  it('searches the villa fridge (kitchen room) and opens it', async () => {
    const [map, content] = await Promise.all([
      testTown(),
      buildContentBundleFromDirs([BASE_PACK_DIR]),
    ]);
    const sim = createSim({
      seed: 1,
      map: chunkSourceToSimMap(map.source, map.range),
      spawn: { x: 16.5, y: 12.5, z: 0 },
      content,
    });
    sim.step();
    const fridge = sim.drainView()?.nearby?.find((c) => c.type === 'base:fridge');
    if (!fridge) throw new Error('fridge not in reach');
    sim.enqueue({
      type: 'openContainer',
      container: fridge.id,
      tick: sim.tick,
      playerId: 0,
      seq: 1,
    });
    let opened;
    for (let i = 0; i < 60 * 20 && !opened; i++) {
      sim.step();
      opened = sim.drainView()?.container ?? undefined;
    }
    expect(opened).toMatchObject({ id: fridge.id, kind: 'world', type: 'base:fridge' });
  });
});
