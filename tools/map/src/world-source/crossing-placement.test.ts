import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crossingStats, type CrossingStats } from './crossing-check.js';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import type { PlanIndex } from './plan-index.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

/**
 * Zebra crossings on every generated map (Paweł 25.10: too many, oddly placed). Rules in
 * crossing-check.ts. Ratchet: today's counts per map; a count may only go down (Silnik fixes
 * the generator) — lower `KNOWN_VIOLATIONS` to the new value when it does.
 */
const KNOWN_VIOLATIONS: Record<string, Omit<CrossingStats, 'crossings'>> = {
  'osm-okulickiego': { duplicate: 350, spacing: 2847, angle: 41, offRoad: 0 },
  'osm-stw': { duplicate: 767, spacing: 7795, angle: 80, offRoad: 0 },
  'plan-4': { duplicate: 0, spacing: 35, angle: 1, offRoad: 0 },
};

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

describe('przejścia dla pieszych na mapach', () => {
  for (const [id, load] of Object.entries(MAPS)) {
    it(`${id}: jedno na przecięcie, co najmniej 10 m, prostopadle, na jezdni (ratchet)`, async () => {
      const samples: string[] = [];
      const s = await crossingStats(await load(), samples);
      console.log(`[przejścia] ${id}`, JSON.stringify(s), samples.slice(0, 5));
      const known = KNOWN_VIOLATIONS[id]!;
      for (const k of ['duplicate', 'spacing', 'angle', 'offRoad'] as const)
        expect(s[k], `${id}.${k} (przykłady: ${samples.join('; ')})`).toBeLessThanOrEqual(known[k]);
    }, 600_000);
  }
});
