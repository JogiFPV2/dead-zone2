import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import type { PlanIndex } from './plan-index.js';
import { poleStats, type PoleStats } from './pole-check.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

/**
 * Power poles on every generated map (Paweł 25.10: towers on the road and by the crossing).
 * Rules in pole-check.ts. Ratchet: today's counts per map; a count may only go down (Silnik
 * fixes the placement) — lower `KNOWN_VIOLATIONS` to the new value when it does. Maps without
 * power lines in their data (osm-okulickiego, plan-4 today) stay at 0.
 */
const KNOWN_VIOLATIONS: Record<string, Omit<PoleStats, 'poles' | 'lines'>> = {
  'osm-okulickiego': { road: 0, sidewalk: 0, crossing: 0, building: 0, uneven: 0 },
  'osm-stw': { road: 0, sidewalk: 0, crossing: 0, building: 0, uneven: 133 },
  'plan-4': { road: 0, sidewalk: 0, crossing: 0, building: 0, uneven: 0 },
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

describe('słupy linii energetycznych na mapach', () => {
  for (const [id, load] of Object.entries(MAPS)) {
    it(`${id}: nie na jezdni, przejściu ani w budynku, rozstaw równy (ratchet)`, async () => {
      const samples: string[] = [];
      const s = poleStats(await load(), samples);
      console.log(`[słupy] ${id}`, JSON.stringify(s), samples.slice(0, 5));
      if (id === 'osm-stw') expect(s.poles).toBeGreaterThan(1000);
      const known = KNOWN_VIOLATIONS[id]!;
      for (const k of ['road', 'sidewalk', 'crossing', 'building', 'uneven'] as const)
        expect(s[k], `${id}.${k} (przykłady: ${samples.join('; ')})`).toBeLessThanOrEqual(known[k]);
    }, 600_000);
  }
});
