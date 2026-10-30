import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import type { PlanIndex } from './plan-index.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

/** Plan loaders of the generated maps (shared by the map ratchet tests). */
const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const json = <T>(f: string) => JSON.parse(readFileSync(OSM + f, 'utf8')) as T;

export const MAPS: Record<string, () => Promise<PlanIndex>> = {
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
