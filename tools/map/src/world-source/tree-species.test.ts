import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';
import { pickSpecies, TREE_HABITAT_WEIGHTS, type TreeHabitat } from './tree-species.js';

const CONTENT = fileURLToPath(
  new URL('../../../../packages/content/data/base/tree-species/', import.meta.url),
);
const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const json = <T>(f: string) => JSON.parse(readFileSync(OSM + f, 'utf8')) as T;

it('tabela habitatów = packages/content tree-species (#386)', () => {
  const fromContent = Object.fromEntries(
    readdirSync(CONTENT)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const s = JSON.parse(readFileSync(CONTENT + f, 'utf8')) as {
          id: string;
          habitats?: Record<string, number>;
        };
        return [s.id, s.habitats ?? {}];
      }),
  );
  expect(TREE_HABITAT_WEIGHTS).toEqual(fromContent);
});

it('pickSpecies: udziały gatunków w klasie terenu wg wag habitats', () => {
  const N = 20000;
  for (const h of ['forest', 'park', 'street', 'field', 'garden'] as TreeHabitat[]) {
    const n = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const id = pickSpecies(h, (i + 0.5) / N);
      n.set(id, (n.get(id) ?? 0) + 1);
    }
    const total = Object.values(TREE_HABITAT_WEIGHTS).reduce((a, w) => a + (w[h] ?? 0), 0);
    for (const [id, w] of Object.entries(TREE_HABITAT_WEIGHTS))
      expect((n.get(id) ?? 0) / N, `${h} ${id}`).toBeCloseTo((w[h] ?? 0) / total, 2);
  }
});

const MAPS: Record<string, () => Promise<PlanChunkGenerator>> = {
  'osm-okulickiego': () => {
    const r = OSM_REGIONS.okulickiego;
    const map = json<OsmMap>('stw-okulickiego.deadzone-osm-1.json');
    return Promise.resolve(
      new PlanChunkGenerator(
        osmPlan(map, { dataHash: 't', bounds: r.bounds, start: r.start, region: 'okulickiego' }),
      ),
    );
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

describe('gatunki drzew na mapach (ratchet: Modules)', () => {
  for (const [id, load] of Object.entries(MAPS))
    it(`${id}: każde drzewo ma gatunek, deterministycznie`, async () => {
      const g = await load();
      const b = g.bounds;
      const n = new Map<string, number>();
      let trees = 0;
      // An 8 × 8 chunk sample around the map centre (cheap).
      const mx = Math.floor((b.cx0 + b.cx1) / 2);
      const my = Math.floor((b.cy0 + b.cy1) / 2);
      for (let cy = my - 4; cy < my + 4; cy++)
        for (let cx = mx - 4; cx < mx + 4; cx++) {
          const c = g.column(cx, cy);
          if (!c) continue;
          expect(c.treeSpecies.length * 2).toBe(c.trees.length);
          trees += c.treeSpecies.length;
          for (const s of c.treeSpecies) n.set(s, (n.get(s) ?? 0) + 1);
        }
      console.log(
        `[gatunki] ${id} drzew=${trees}`,
        JSON.stringify(Object.fromEntries([...n].sort())),
      );
      expect(trees).toBeGreaterThan(0);
      for (const s of n.keys()) expect(TREE_HABITAT_WEIGHTS[s]).toBeDefined();
      // Deterministic: a second generator of the same plan gives the same species.
      if (id !== 'osm-stw')
        expect((await load()).column(mx, my)?.treeSpecies).toEqual(g.column(mx, my)?.treeSpecies);
    }, 600_000);
});
