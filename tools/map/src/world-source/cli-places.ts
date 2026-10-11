import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OsmMap } from '../osm/types.js';
import { OSM_ROTATION_DEG, rotatePt, rotation } from './straighten.js';

/** OSM `place=*` kinds that name parts of the world (save summary, map labels). */
export const PLACE_KINDS = ['town', 'suburb', 'quarter', 'neighbourhood', 'village', 'hamlet'];

/**
 * `pnpm --filter @deadzone/map osm:places <stw-map.json> <out.json>`: named places inside the
 * 16 km square as `{ name, x, y }` in game tiles (1 tile = 1 m, same frame as the OSM world
 * plan: the raw frame — x east from the west edge, y south from the north edge — rotated by
 * `OSM_ROTATION_DEG` about the square's centre). ODbL data (OpenStreetMap).
 */
const [input, out] = process.argv.slice(2);
if (!input || !out) {
  console.error('usage: osm:places <stw-map.json> <out.json>');
  process.exit(2);
}
const map = JSON.parse(readFileSync(input, 'utf8')) as OsmMap;
const rot = rotation(OSM_ROTATION_DEG);
const places = map.places
  .filter((p) => PLACE_KINDS.includes(p.kind))
  .map((p) => {
    const q = rotatePt(rot, p.x / 10, p.y / 10);
    return { name: p.name, x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 };
  })
  .filter((p) => p.x >= 0 && p.y >= 0 && p.x < map.size && p.y < map.size)
  .sort((a, b) => a.name.localeCompare(b.name, 'pl') || a.x - b.x || a.y - b.y);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(places, null, 2) + '\n');
console.log(`${out}: ${places.length} places`);
