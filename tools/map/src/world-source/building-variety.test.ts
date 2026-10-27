import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

/**
 * Variety of building looks (Paweł 27.10: buildings in different colours, not all alike). A look
 * = exterior wall content + roof content of the solved building (`SolvedBuilding.wall` /
 * `roofContent`, the renderer skin). Ratchet: `MIN_LOOKS` may only go up, the `MAX_*_SHARE`
 * only down (target: no wall or look on more than 30 % of buildings).
 */
interface Limits {
  /** Distinct wall|roof combinations, at least. */
  looks: number;
  /** Share of the most common wall|roof combination, at most. */
  look: number;
  /** Share of the most common wall, at most. */
  wall: number;
  /** Share of the most common roof, at most. */
  roof: number;
}
const LIMITS: Record<string, Limits> = {
  'osm-okulickiego': { looks: 22, look: 0.281, wall: 0.311, roof: 0.485 },
  'osm-stw': { looks: 23, look: 0.144, wall: 0.172, roof: 0.344 },
  'plan-4': { looks: 19, look: 0.168, wall: 0.205, roof: 0.309 },
};
/** Every n-th building (gid % n) is solved, to keep CI time down (as building-shape.test.ts). */
const SAMPLE: Record<string, number> = { 'osm-okulickiego': 1, 'osm-stw': 8, 'plan-4': 8 };

const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const json = <T>(f: string) => JSON.parse(readFileSync(OSM + f, 'utf8')) as T;

const MAPS: Record<string, () => Promise<PlanChunkGenerator>> = {
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

const topShare = (m: Map<string, number>, n: number) => Math.max(0, ...m.values()) / (n || 1);
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

describe('różnorodność wyglądu budynków na mapach', () => {
  for (const [id, load] of Object.entries(MAPS)) {
    it(`${id}: dość wariantów ściana/dach, żaden nie dominuje (ratchet)`, async () => {
      const g = await load();
      const looks = new Map<string, number>();
      const walls = new Map<string, number>();
      const roofs = new Map<string, number>();
      let n = 0;
      for (const ib of g.index.buildings.items) {
        if (ib.gid % SAMPLE[id]!) continue;
        const b = g.building(ib);
        if (!b) continue;
        n++;
        const roof = b.roofContent ?? '-';
        inc(looks, `${b.wall}|${roof}`);
        inc(walls, b.wall);
        inc(roofs, roof);
      }
      const s = {
        buildings: n,
        looks: looks.size,
        look: topShare(looks, n),
        wall: topShare(walls, n),
        roof: topShare(roofs, n),
      };
      console.log(`[wygląd] ${id}`, JSON.stringify(s));
      const l = LIMITS[id]!;
      expect(n).toBeGreaterThan(0);
      expect(s.looks, `${id}.looks`).toBeGreaterThanOrEqual(l.looks);
      expect(s.look, `${id}.look`).toBeLessThanOrEqual(l.look);
      expect(s.wall, `${id}.wall`).toBeLessThanOrEqual(l.wall);
      expect(s.roof, `${id}.roof`).toBeLessThanOrEqual(l.roof);
    }, 1_800_000);
  }
});
