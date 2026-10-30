import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { onCarriageway, syntheticCrossings } from './level-crossings.js';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import type { PlanIndex } from './plan-index.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const json = <T>(f: string) => JSON.parse(readFileSync(OSM + f, 'utf8')) as T;

const MAPS: Record<string, () => Promise<PlanIndex>> = {
  'osm-okulickiego': () => {
    const r = OSM_REGIONS.okulickiego;
    const map = json<OsmMap>('stw-okulickiego.deadzone-osm-1.json');
    const plan = osmPlan(map, {
      dataHash: 't',
      bounds: r.bounds,
      start: r.start,
      region: 'okulickiego',
    });
    return Promise.resolve(new PlanChunkGenerator(plan).index);
  },
  'osm-stw': async () => {
    const t = new OsmTiles(json<OsmTileManifest>('stw-16km/manifest.json'), (f) =>
      Promise.resolve(json<OsmMap>(`stw-16km/${f}`)),
    );
    await t.ensureAll();
    return t.generator.index;
  },
  'plan-4': () => Promise.resolve(new PlanChunkGenerator(plan4Plan(1, 16384)).index),
};

/**
 * Level crossings on every map (Paweł 27.10): OSM marks only some rail × road crossings
 * (Okulickiego 14, osm-stw 2, plan-4 22 unmarked), and some `level_crossing` nodes lie in a field
 * (osm-stw 8). The generator adds the unmarked ones (`syntheticCrossings`) and skips the leftovers
 * (`onCarriageway`, the 8 STW ones are skipped); this pins the counts, so a data or rule change shows up here.
 */
const EXPECTED: Record<string, { synth: number; orphan: number }> = {
  'osm-okulickiego': { synth: 14, orphan: 0 },
  'osm-stw': { synth: 2, orphan: 8 },
  'plan-4': { synth: 22, orphan: 0 },
};

describe('przejazdy kolejowe bez znacznika OSM', () => {
  for (const [id, load] of Object.entries(MAPS)) {
    it(`${id}: przejazd na każdym przecięciu toru z jezdnią, bez przejazdów w polu`, async () => {
      const idx = await load();
      const b = idx.rails.boxes;
      const all = {
        x0: Math.min(...b.map((r) => r.x0)),
        y0: Math.min(...b.map((r) => r.y0)),
        x1: Math.max(...b.map((r) => r.x1)),
        y1: Math.max(...b.map((r) => r.y1)),
      };
      const synth = syntheticCrossings(idx, all);
      const orphan = idx.railNodes.items.filter(
        (n) => n.kind === 'level_crossing' && !onCarriageway(idx, n),
      );
      const got = { synth: synth.length, orphan: orphan.length };
      expect(got).toEqual(EXPECTED[id]);
    }, 600_000);
  }
});
