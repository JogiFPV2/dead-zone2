/**
 * `pnpm --filter @deadzone/map2 osm <roads2.json> <out.json>`: map2 roads (cli-roads) → the
 * client's `deadzone-osm-1` file for `?map=stw2` (then `tools/map` osm:tiles with `--stw2`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { toOsmMap, type Map2Roads } from './to-osm.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: cli-osm <roads2.json> <out.json>');
const m = toOsmMap(JSON.parse(readFileSync(src, 'utf8')) as Map2Roads);
writeFileSync(out, JSON.stringify(m));
console.log(`${out}: ${(m.roads as unknown[]).length} roads`);
