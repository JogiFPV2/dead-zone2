import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_PACK_DIR } from '../node/base-pack.js';
import { decodeRle } from '../schemas/map/codec-rle.js';

/** Street floors: the road, sidewalks and parking. */
const STREET = new Set(['base:asphalt', 'base:sidewalk', 'base:parking']);
/** The only objects that may stand there: bins, benches and pumps (cars are vehicles, not objects). */
const STREET_OK = new Set(['base:trash-bin', 'base:dumpster', 'base:bench', 'base:fuel-pump']);

interface RawChunk {
  address: { cx: number; cy: number; z: number };
  palette: string[];
  layers: { floor: { rle: [number, number][] } | number[] };
  objects: { contentId: string; x: number; y: number }[];
}

describe('mapy bazowe: nic nie stoi na drodze ani chodniku', () => {
  const mapsDir = join(BASE_PACK_DIR, 'maps');
  for (const map of readdirSync(mapsDir)) {
    it(map, () => {
      const bad: string[] = [];
      const dir = join(mapsDir, map, 'chunks');
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RawChunk;
        const floor = Array.isArray(c.layers.floor)
          ? c.layers.floor
          : decodeRle(c.layers.floor.rle);
        for (const o of c.objects) {
          const v = floor[o.y * 32 + o.x] ?? 0;
          const tile = v ? c.palette[v - 1] : undefined;
          if (tile && STREET.has(tile) && !STREET_OK.has(o.contentId))
            bad.push(
              `${o.contentId} @ ${c.address.cx * 32 + o.x},${c.address.cy * 32 + o.y} z${c.address.z} na ${tile}`,
            );
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
