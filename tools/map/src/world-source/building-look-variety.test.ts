import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import type { GenBuildingMeta, PlanChunkGenerator } from './generator.js';
import { PlanChunkGenerator as Gen } from './generator.js';
import { OSM_REGIONS, osmPlan, plan4Plan } from './sources.js';
import { OsmTiles, type OsmTileManifest } from './tiles.js';

/**
 * Variety of the chunk-meta look fields (GENERATOR_REV 21, #382): `wallColor`, `roofColor`,
 * `look`, `condition`, `roofShape`. Ratchet: limits = measured at GENERATOR_REV 25 + 0.01;
 * CI fails when a share grows. Target (Paweł 27.10): no hue on more than 30 % of walls / roofs
 * (KNOWN: measured higher, see LIMITS). OSM colours are not in the data yet and are not checked.
 */
const HUE_TARGET = 0.3;
interface Limits {
  /** Share of the most common wall / roof hue bucket, at most. */
  wallHue: number;
  roofHue: number;
  /** Distinct `look` types, at least; share of the most common one, at most. */
  looks: number;
  look: number;
  /** Share of abandoned + ruin, at most (and > 0). */
  bad: number;
  /** Distinct conditions, at least. */
  conditions: number;
  /** Share of the most common roofShape, at most. */
  roofShape: number;
  /** Share of buildings with a sampled neighbour (≤ 30 m) of the same wall+roof pair, at most. */
  samePair: number;
}
const LIMITS: Record<string, Limits> = {
  // KNOWN: roof hue on okulickiego / plan-4 and stw look (house) above target (measured + 0.01).
  'osm-okulickiego': {
    wallHue: 0.251,
    roofHue: 0.267,
    looks: 10,
    look: 0.34,
    bad: 0.076,
    conditions: 4,
    roofShape: 0.521,
    samePair: 0.01,
  },
  'osm-stw': {
    wallHue: 0.275,
    roofHue: 0.29,
    looks: 9,
    look: 0.703,
    bad: 0.07,
    conditions: 4,
    roofShape: 0.499,
    samePair: 0.01,
  },
  'plan-4': {
    wallHue: 0.266,
    roofHue: 0.302,
    looks: 8,
    look: 0.412,
    bad: 0.102,
    conditions: 4,
    roofShape: 0.411,
    samePair: 0.01,
  },
};
const SAMPLE: Record<string, number> = { 'osm-okulickiego': 1, 'osm-stw': 8, 'plan-4': 8 };
const PAIR_M = 30;

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
    return Promise.resolve(new Gen(plan));
  },
  'osm-stw': async () => {
    const t = new OsmTiles(json<OsmTileManifest>('stw-16km/manifest.json'), (f) =>
      Promise.resolve(json<OsmMap>(`stw-16km/${f}`)),
    );
    await t.ensureAll();
    return t.generator;
  },
  'plan-4': () => Promise.resolve(new Gen(plan4Plan(1, 16384))),
};

/** Hue bucket of `#rrggbb`: 12 buckets of 30°, greys (saturation < 0.12) by lightness thirds. */
export function hueBucket(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.12) return `grey${Math.min(2, Math.floor(l * 3))}`;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return `h${Math.floor(h / 30)}`;
}

type LookOf = (gid: number, floors: number) => Partial<GenBuildingMeta>;
const topShare = (m: Map<string, number>, n: number) => Math.max(0, ...m.values()) / (n || 1);
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

describe('różnorodność kolorów, look i condition budynków (ratchet)', () => {
  for (const [id, load] of Object.entries(MAPS)) {
    it(`${id}: odcienie, look, condition, dachy, pary sąsiadów`, async () => {
      const g = await load();
      const lookOf = (g as unknown as { lookOf: LookOf }).lookOf.bind(g);
      const wallH = new Map<string, number>();
      const roofH = new Map<string, number>();
      const looks = new Map<string, number>();
      const conds = new Map<string, number>();
      const shapes = new Map<string, number>();
      const pts: { x: number; y: number; pair: string }[] = [];
      let n = 0;
      let bad = 0;
      for (const ib of g.index.buildings.items) {
        if (ib.gid % SAMPLE[id]!) continue;
        const b = g.building(ib);
        if (!b) continue;
        const m = lookOf(ib.gid, b.floors);
        if (!m.look || !m.wallColor || !m.roofColor || !m.condition || !m.roofShape) continue;
        n++;
        inc(wallH, hueBucket(m.wallColor));
        inc(roofH, hueBucket(m.roofColor));
        inc(looks, m.look);
        inc(conds, m.condition);
        inc(shapes, m.roofShape);
        if (m.condition === 'abandoned' || m.condition === 'ruin') bad++;
        const bb = ib.box;
        pts.push({
          x: (bb.x0 + bb.x1) / 2,
          y: (bb.y0 + bb.y1) / 2,
          pair: `${m.wallColor}${m.roofColor}`,
        });
      }
      // Same wall+roof pair among sampled neighbours within PAIR_M (grid hash).
      const cell = new Map<string, number[]>();
      const key = (x: number, y: number) => `${Math.floor(x / PAIR_M)},${Math.floor(y / PAIR_M)}`;
      pts.forEach((p, i) =>
        (cell.get(key(p.x, p.y)) ?? cell.set(key(p.x, p.y), []).get(key(p.x, p.y))!).push(i),
      );
      let same = 0;
      pts.forEach((p, i) => {
        const cx = Math.floor(p.x / PAIR_M);
        const cy = Math.floor(p.y / PAIR_M);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const j of cell.get(`${cx + dx},${cy + dy}`) ?? []) {
              const q = pts[j]!;
              if (j !== i && q.pair === p.pair && Math.hypot(q.x - p.x, q.y - p.y) <= PAIR_M) {
                same++;
                return;
              }
            }
      });
      const s = {
        buildings: n,
        wallHue: topShare(wallH, n),
        roofHue: topShare(roofH, n),
        looks: looks.size,
        look: topShare(looks, n),
        bad: bad / (n || 1),
        conditions: conds.size,
        conditionMix: Object.fromEntries(conds),
        roofShape: topShare(shapes, n),
        samePair: same / (n || 1),
      };
      console.log(`[look] ${id}`, JSON.stringify(s));
      const l = LIMITS[id]!;
      expect(n).toBeGreaterThan(0);
      expect(s.wallHue, `${id}.wallHue (cel ${HUE_TARGET})`).toBeLessThanOrEqual(l.wallHue);
      expect(s.roofHue, `${id}.roofHue (cel ${HUE_TARGET})`).toBeLessThanOrEqual(l.roofHue);
      expect(s.looks, `${id}.looks`).toBeGreaterThanOrEqual(l.looks);
      expect(s.look, `${id}.look`).toBeLessThanOrEqual(l.look);
      expect(s.bad, `${id}.bad`).toBeGreaterThan(0);
      expect(s.bad, `${id}.bad`).toBeLessThanOrEqual(l.bad);
      expect(s.conditions, `${id}.conditions`).toBeGreaterThanOrEqual(l.conditions);
      expect(s.roofShape, `${id}.roofShape`).toBeLessThanOrEqual(l.roofShape);
      expect(s.samePair, `${id}.samePair`).toBeLessThanOrEqual(l.samePair);
    }, 1_800_000);
  }
});
