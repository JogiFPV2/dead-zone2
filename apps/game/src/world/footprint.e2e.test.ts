// End to end: furniture footprint on by default (base content) on the demo maps: the sim builds
// the furniture index, the start is free and every piece can be reached from a free tile next to it.
import { describe, expect, it } from 'vitest';
import {
  BASE_PACK_DIR,
  buildContentBundleFromDirs,
  validatePackDirs,
} from '@deadzone/content/node';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { createSim, TileGrid } from '@deadzone/sim';
import { mapDataToChunkSource } from './content-map.js';
import { chunkSourceToSimMap } from './sim-map.js';
import { startSpawn } from './zones.js';

const DIRS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

describe('furniture footprint on by default (demo maps)', () => {
  it.each(['base:test-town', 'base:demo-house'])(
    '%s: start free, all furniture reachable',
    async (id) => {
      const [r, content] = await Promise.all([
        validatePackDirs([BASE_PACK_DIR]),
        buildContentBundleFromDirs([BASE_PACK_DIR]),
      ]);
      expect(content.worldSettings.furnitureFootprint).toBe(true);
      const data = r.maps.find((m) => m.id === id);
      if (!data) throw new Error(`${id} missing`);
      const loaded = mapDataToChunkSource(data);
      const map = chunkSourceToSimMap(loaded.source, loaded.range);
      const spawn = startSpawn(loaded.zones);
      const sim = createSim({
        seed: 1,
        map,
        ...(spawn ? { spawn } : {}),
        content,
      });
      sim.step();
      const w = sim.world;
      expect(w.furniture).toBeDefined();
      const grid = new TileGrid(w.map, w.openings, w.furniture);
      const p = sim.getPlayer()!;
      expect(grid.isBlocked(Math.floor(p.x), Math.floor(p.y), 0)).toBe(false);

      const { cx0, cy0, cx1, cy1 } = loaded.range;
      const stuck: string[] = [];
      let pieces = 0;
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++)
          for (const o of map.getChunk(cx, cy, 0)?.objects ?? []) {
            const x0 = cx * CHUNK_SIZE + o.x;
            const y0 = cy * CHUNK_SIZE + o.y;
            if (!grid.furnitureBlocks(x0, y0, 0)) continue;
            pieces++;
            const size = w.furniture!.sizeOf(o.contentId, o.rot);
            let free = false;
            for (let dy = 0; dy < size.h && !free; dy++)
              for (let dx = 0; dx < size.w && !free; dx++)
                free = DIRS.some(([ex, ey]) => !grid.isBlocked(x0 + dx + ex, y0 + dy + ey, 0));
            if (!free) stuck.push(`${o.contentId}@${x0},${y0}`);
          }
      expect(pieces).toBeGreaterThan(0);
      expect(stuck).toEqual([]);
    },
  );
});
