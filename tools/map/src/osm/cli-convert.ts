/** `tsx src/osm/cli-convert.ts <raw.json> <out stw-map.json>`: raw OSM dump → compact game map + stats. */
import { readFileSync, writeFileSync } from 'node:fs';
import { convertOsm, type RawOsm } from './convert.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: cli-convert <raw.json> <out.json>');
const { map, stats } = convertOsm(JSON.parse(readFileSync(src, 'utf8')) as RawOsm);
writeFileSync(out, JSON.stringify(map));
writeFileSync(out.replace(/\.json$/, '.stats.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats));
