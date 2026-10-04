/**
 * `tsx src/osm/cli-scene.ts <stw-map.json> [--check]`: builds the OSM scene cut(s) as content
 * maps (`packages/content/data/base/maps/<id>/`) and the scene files for the game
 * (`apps/game/src/world/osm/scenes/<id>.json`).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { BASE_PACK_DIR } from '@deadzone/content/node';
import { buildMap } from '../build.js';
import { mapFiles } from '../files.js';
import { OSM_SCENES } from './scenes.js';
import { buildScene } from './scene.js';
import type { OsmMap } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const [src] = process.argv.slice(2);
if (!src) throw new Error('usage: cli-scene <stw-map.json>');
const osm = JSON.parse(await readFile(src, 'utf8')) as OsmMap;
for (const cut of OSM_SCENES) {
  const t0 = Date.now();
  const { blueprint, scene } = buildScene(osm, cut);
  const map = buildMap(blueprint);
  await rm(join(BASE_PACK_DIR, 'maps', cut.id), { recursive: true, force: true });
  for (const f of await mapFiles(map, join(repo, '.prettierrc.json'))) {
    const p = join(BASE_PACK_DIR, f.path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, f.text);
  }
  const out = join(repo, 'apps/game/src/world/osm/scenes', `${cut.id}.json`);
  await mkdir(dirname(out), { recursive: true });
  const options = (await resolveConfig(join(repo, '.prettierrc.json'))) ?? {};
  await writeFile(out, await format(JSON.stringify(scene), { ...options, parser: 'json' }));
  console.log(
    cut.id,
    `${map.chunks.length} chunks`,
    `${Date.now() - t0} ms`,
    JSON.stringify(scene.stats),
    `cars ${scene.vehicles.length} trees ${scene.trees.length} zombies ${scene.zombies.length}`,
  );
}
