// Building outlines of the Stalowa Wola tiles after straightening (Paweł 26.10: no „krzaczki
// i zawijasy”): total vertex count and wall runs shorter than 1.5 m may only go down.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OSM_ROTATION_DEG, straightenOsmMap, type OsmMap } from '@deadzone/map/world-source';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../../public/osm/stw-16km/', import.meta.url));
/** Ratchet: lower as outlines get cleaner; never raise without a reason in the PR. */
const STW_OUTLINE_MAX = { vertices: 153_800, shortEdges: 95, perBuilding: 8 };

describe('osm-stw building outlines', () => {
  it('few vertices, no sub-1.5 m jogs', () => {
    let buildings = 0;
    let vertices = 0;
    let shortEdges = 0;
    for (const f of readdirSync(DIR)) {
      if (!f.startsWith('t-')) continue;
      const m = straightenOsmMap(
        JSON.parse(readFileSync(DIR + f, 'utf8')) as OsmMap,
        OSM_ROTATION_DEG,
      );
      for (const b of m.buildings) {
        const r = b.rings[0]!;
        const n = (r.length >> 1) - 1;
        buildings++;
        vertices += n;
        for (let i = 0; i < n; i++)
          if (Math.hypot(r[2 * i + 2]! - r[2 * i]!, r[2 * i + 3]! - r[2 * i + 1]!) < 15)
            shortEdges++;
      }
    }
    expect(buildings).toBeGreaterThan(30_000);
    expect(vertices).toBeLessThanOrEqual(STW_OUTLINE_MAX.vertices);
    expect(shortEdges).toBeLessThanOrEqual(STW_OUTLINE_MAX.shortEdges);
    expect(vertices / buildings).toBeLessThanOrEqual(STW_OUTLINE_MAX.perBuilding);
  }, 120_000);
});
