import { describe, expect, it } from 'vitest';
import { createSim } from '@deadzone/sim';
import { CHUNK_SIZE, tileIndex } from '../world/chunk.js';
import { chunkSourceToSimMap } from '../world/sim-map.js';
import { TEST_BUILDING_INSIDE } from '../world/test-building.js';
import { createTestMap, TEST_MAP_RANGE } from '../world/test-map.js';
import { roomKey } from './building-plan.js';
import { SimFloorIntel } from './floor-intel.js';

describe('SimFloorIntel with the real sim (protocol 22)', () => {
  it('the room the player stands in arrives as known; marker floors checked by the sim', () => {
    const source = createTestMap();
    const map = chunkSourceToSimMap(source, TEST_MAP_RANGE);
    const { x, y } = TEST_BUILDING_INSIDE;
    const sim = createSim({ seed: 3, map, spawn: { x, y, z: 0 } });
    const intel = new SimFloorIntel();
    let markerZ: number | undefined;
    const rejected: string[] = [];
    const pump = () => {
      sim.step();
      const v = sim.drainView();
      if (v) intel.applyView(v);
      for (const e of sim.drainEvents()) {
        if (e.type === 'markersChanged') markerZ = e.markers[0]?.z;
        if (e.type === 'commandRejected') rejected.push(e.reason);
      }
    };
    for (let i = 0; i < 60; i++) pump();

    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const room =
      source.getChunk(cx, cy, 0)?.room?.[
        tileIndex(Math.floor(x) - cx * CHUNK_SIZE, Math.floor(y) - cy * CHUNK_SIZE)
      ] ?? 0;
    expect(room).toBeGreaterThan(0);
    const here = { key: roomKey(0, cx, cy, room), parts: [{ cx, cy, room }] };
    expect(intel.room(here, 0)).not.toBe('unknown');
    expect(intel.room(here, 1)).toBe('unknown');
    expect(intel.version).toBeGreaterThan(0);

    // The test map has one level: a marker on it carries z = 0, one on z = 1 is refused.
    const add = (z: number, seq: number) =>
      sim.enqueue({
        type: 'addMarker',
        x,
        y,
        z,
        icon: 'base:marker-base',
        color: 'yellow',
        tick: sim.tick,
        playerId: 0,
        seq,
      });
    add(1, 1);
    for (let i = 0; i < 3; i++) pump();
    expect(rejected).toEqual(['invalid-target']);
    expect(markerZ).toBeUndefined();
    add(0, 2);
    for (let i = 0; i < 3; i++) pump();
    expect(markerZ).toBe(0);
  });
});
