import { readFileSync, writeFileSync } from 'node:fs';
import type { OsmMap } from '../osm/types.js';
import { OSM_REGIONS, cropOsmMap } from './sources.js';

/**
 * `pnpm --filter @deadzone/map osm:crop <stw-map.json> <region> <out.json>`: the static data
 * file of one region (ODbL: keep it a separate file with its attribution and licence fields).
 */
const [input, region, out] = process.argv.slice(2);
if (!input || !region || !out || !(region in OSM_REGIONS)) {
  console.error(
    `usage: osm:crop <stw-map.json> <${Object.keys(OSM_REGIONS).join('|')}> <out.json>`,
  );
  process.exit(2);
}
const map = JSON.parse(readFileSync(input, 'utf8')) as OsmMap;
const crop = cropOsmMap(map, OSM_REGIONS[region as keyof typeof OSM_REGIONS].bounds);
writeFileSync(out, JSON.stringify(crop));
console.log(
  `${out}: ${crop.buildings.length} buildings, ${crop.roads.length} roads, ${crop.areas.length} areas, ${crop.trees.length / 2} trees`,
);
