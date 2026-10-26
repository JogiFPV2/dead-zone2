import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { buildingStats, type BuildingStats } from './building-check.js';
import { PlanChunkGenerator } from './generator.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

/**
 * Building outlines and window density on every generated map (Paweł 26.10: "krzaczki i
 * zawijasy", too few windows). Rules in building-check.ts. Ratchet: today's counts per map; a
 * count may only go down — lower `KNOWN_VIOLATIONS` to the new value when it does.
 */
type Counts = Omit<BuildingStats, 'buildings' | 'windows'>;
const KNOWN_VIOLATIONS: Record<string, Counts> = {
  'osm-okulickiego': { short: 113, dense: 4, acute: 0, selfX: 1, fewWindows: 0 },
  'osm-stw': { short: 358, dense: 16, acute: 0, selfX: 7, fewWindows: 0 },
  'plan-4': { short: 0, dense: 0, acute: 0, selfX: 0, fewWindows: 1 },
};

/** Windows judged on every n-th residential building (gid % n), to keep CI time down. */
const WINDOW_SAMPLE: Record<string, number> = { 'osm-okulickiego': 1, 'osm-stw': 8, 'plan-4': 8 };

const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const json = <T>(f: string) => JSON.parse(readFileSync(OSM + f, 'utf8')) as T;

const MAPS: Record<string, () => Promise<PlanChunkGenerator>> = {
  'osm-okulickiego': () => {
    const r = OSM_REGIONS.okulickiego;
    const map = json<OsmMap>('stw-okulickiego.deadzone-osm-1.json');
    const plan = osmPlan(map, {
      dataHash: 't',
      bounds: r.bounds,
      start: r.start,
      region: 'okulickiego',
    });
    return Promise.resolve(new PlanChunkGenerator(plan));
  },
  'osm-stw': async () => {
    const t = new OsmTiles(json<OsmTileManifest>('stw-16km/manifest.json'), (f) =>
      Promise.resolve(json<OsmMap>(`stw-16km/${f}`)),
    );
    await t.ensureAll();
    return t.generator;
  },
  'plan-4': () => Promise.resolve(new PlanChunkGenerator(plan4Plan(1, 16384))),
};

describe('obrysy budynków i gęstość okien na mapach', () => {
  for (const [id, load] of Object.entries(MAPS)) {
    it(`${id}: bez ząbków, szpilek i samoprzecięć, dość okien (ratchet)`, async () => {
      const g = await load();
      const samples: string[] = [];
      const s = buildingStats(
        g.index.buildings.items,
        (ib) => g.building(ib),
        samples,
        WINDOW_SAMPLE[id],
      );
      console.log(`[budynki] ${id}`, JSON.stringify(s), samples.slice(0, 5));
      const known = KNOWN_VIOLATIONS[id]!;
      for (const k of ['short', 'dense', 'acute', 'selfX', 'fewWindows'] as const)
        expect(s[k], `${id}.${k} (przykłady: ${samples.join('; ')})`).toBeLessThanOrEqual(known[k]);
    }, 1_800_000);
  }
});
