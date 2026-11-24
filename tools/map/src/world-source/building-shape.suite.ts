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
  // fewWindows 1: #1759 @ 9829,11385 — the only miss on okulickiego, never 0 on CI (run 40403454959); to fix in the per-type limits PR.
  'osm-okulickiego': { short: 0, dense: 0, acute: 0, selfX: 0, fewWindows: 1 },
  // fewWindows 1: #2752 @ 8934,12187 (30 × 6.5 m row house, 12 ground-floor windows for 73 m of
  // long walls; limit 12.2) since windows every 3 m (Paweł 24.11: „za dużo okien”).
  'osm-stw': { short: 2, dense: 1, acute: 0, selfX: 0, fewWindows: 1 },
  'plan-4': { short: 0, dense: 0, acute: 0, selfX: 0, fewWindows: 0 },
};

/** Windows judged on every n-th residential building (gid % n), to keep CI time down. */
const WINDOW_SAMPLE: Record<string, number> = { 'osm-okulickiego': 1, 'osm-stw': 8, 'plan-4': 8 };

const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const json = <T>(f: string) => JSON.parse(readFileSync(OSM + f, 'utf8')) as T;

export const MAPS: Record<string, () => Promise<PlanChunkGenerator>> = {
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

/** One test file per map, so vitest runs the three heavy maps in parallel workers.
 * Same maps, samples and ratchet as before. */
export function buildingShapeSuite(id: string): void {
  const load = MAPS[id]!;
  describe('obrysy budynków i gęstość okien na mapach', () => {
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
  });
}
