import { describe, expect, it } from 'vitest';
import { dist, PolylineIndex, polyLength, segCross } from './geom.js';
import { fieldParcel, GroundField } from './ground.js';
import { FALLBACK_WORLD_SIZE, forestNoise, planWorld, type WorldPlan } from './plan.js';
import { inArea, planStats } from './stats.js';
import { baseHeight } from './terrain.js';

const plans = [planWorld({ seed: 1993 }), planWorld({ seed: 7, size: FALLBACK_WORLD_SIZE })];
const big = plans[0]!;
const h = (p: WorldPlan, x: number, y: number) => baseHeight(p.seed, p.size, x, y, p.riverMouth);
const isForest = (p: WorldPlan, x: number, y: number) =>
  forestNoise(p.seed, x, y, p.size) > p.forestThreshold;

describe('world plan v4: water, countryside, industry and rail', { timeout: 180_000 }, () => {
  it('water covers ≥ 2 % of the big map (river, tributaries, lakes, ponds)', () => {
    expect(planStats(big).cover.water).toBeGreaterThanOrEqual(0.02);
  });

  it('named tributaries flow downhill into Sołwia or a lake; streams join the water', () => {
    for (const p of plans) {
      const river = new PolylineIndex(p.river);
      const lakes = p.areas.filter((a) => a.kind === 'lake');
      const trib = p.waterways.filter((w) => w.kind === 'tributary');
      expect(trib.length).toBeGreaterThanOrEqual(2);
      expect(p.waterways.filter((w) => w.kind === 'stream').length).toBeGreaterThanOrEqual(4);
      for (const w of trib) expect(w.name, 'tributary named').toBeTruthy();
      expect(new Set(trib.map((w) => w.name)).size).toBe(trib.length);
      for (const w of p.waterways) {
        const a = w.pts[0]!;
        const b = w.pts.at(-1)!;
        const atRiver = river.dist(b.x, b.y) < p.riverWidth;
        const atLake = lakes.some((l) => inArea({ ...l, w: l.w + 40, h: l.h + 40 }, b.x, b.y));
        const atWay = p.waterways.some(
          (o) => o !== w && new PolylineIndex(o.pts).dist(b.x, b.y) < o.width + 4,
        );
        expect(atRiver || atLake || atWay, `${w.kind} ${w.name ?? ''} mouth`).toBe(true);
        if (w.kind === 'tributary') {
          expect(atRiver || atLake).toBe(true);
          expect(polyLength(w.pts)).toBeGreaterThan(p.size * 0.15);
        }
        expect(h(p, a.x, a.y), 'source above mouth').toBeGreaterThan(h(p, b.x, b.y));
      }
    }
  });

  it('Jezioro Białe and Jezioro Czarne are 2–3 km long on the big map, with bays', () => {
    const named = big.areas.filter((a) => a.kind === 'lake' && a.name);
    expect(named.map((l) => l.name).sort()).toEqual(['Jezioro Białe', 'Jezioro Czarne']);
    for (const l of named) {
      expect(l.w).toBeGreaterThanOrEqual(2000);
      expect(l.w).toBeLessThanOrEqual(3000);
      const bays = big.areas.filter(
        (a) => a.kind === 'lake' && !a.name && dist(a, l) < l.w / 2 && a !== l,
      );
      expect(bays.length, `${l.name} bays`).toBeGreaterThanOrEqual(2);
    }
  });

  it('fish ponds in groups with a keeper, wetlands and flood meadows', () => {
    for (const p of plans) {
      const groups = p.complexes.filter((c) => c.kind === 'ponds');
      expect(groups.length).toBeGreaterThanOrEqual(2);
      for (const g of groups) {
        const ponds = p.areas.filter((a) => a.kind === 'pond' && !a.round && dist(a, g) < 300);
        expect(ponds.length).toBeGreaterThanOrEqual(2);
        expect(p.buildings.some((b) => b.kind === 'house' && dist(b, g) < 300)).toBe(true);
      }
      expect(p.areas.filter((a) => a.kind === 'marsh').length).toBeGreaterThanOrEqual(3);
      const field = new GroundField(p);
      let flood = 0;
      for (let k = 0; k < 4000; k++) {
        const t = (k * 7919) % p.river.length;
        const q = p.river[t]!;
        if (field.at(q.x + ((k % 13) - 6) * 25, q.y + ((k % 11) - 5) * 25) === 'floodmeadow')
          flood++;
      }
      expect(flood).toBeGreaterThan(50);
    }
  });

  it('every road and railway over a tributary or stream has a bridge; no building in water', () => {
    for (const p of plans) {
      p.waterways.forEach((w) => {
        p.roads.forEach((r, ri) => {
          for (let k = 1; k < r.pts.length; k++)
            for (let j = 1; j < w.pts.length; j++) {
              const hit = segCross(r.pts[k - 1]!, r.pts[k]!, w.pts[j - 1]!, w.pts[j]!);
              if (!hit) continue;
              const br = p.bridges.find(
                (b) =>
                  b.road === ri && b.over === w.kind && Math.hypot(b.x - hit.x, b.y - hit.y) < 0.5,
              );
              expect(br, `${r.cls} over ${w.kind}`).toBeDefined();
              expect(br!.w).toBeGreaterThan(w.width);
            }
        });
      });
      const ways = p.waterways.map((w) => ({ w, i: new PolylineIndex(w.pts) }));
      const wet = p.areas.filter((a) => a.kind === 'lake' || a.kind === 'pond');
      for (const b of p.buildings) {
        for (const { w, i } of ways)
          expect(i.dist(b.x, b.y), `${b.kind} in ${w.kind}`).toBeGreaterThan(w.width / 2);
        expect(
          wet.some((a) => inArea(a, b.x, b.y)),
          `${b.kind} in a lake`,
        ).toBe(false);
      }
      // Tracks and paths never ford a tributary.
      expect(
        p.bridges.some((b) => b.over === 'tributary' && (b.cls === 'track' || b.cls === 'path')),
      ).toBe(false);
    }
  });

  it('fields of every size: peasant strips, medium plots and big PGR fields, no chessboard', () => {
    const styles = new Map<string, number[]>();
    const field = new GroundField(big);
    for (let k = 0; k < 3000; k++) {
      const x = 500 + ((k * 7907) % (big.size - 1000));
      const y = 500 + ((k * 104729) % (big.size - 1000));
      if (field.at(x, y) === 'forest') continue;
      const q = fieldParcel(big.seed, x, y);
      styles.set(q.style, [...(styles.get(q.style) ?? []), q.w * q.l]);
    }
    expect([...styles.keys()].sort()).toEqual(['pgr', 'plots', 'strips']);
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
    expect(med(styles.get('pgr')!)).toBeGreaterThan(5 * med(styles.get('strips')!));
    // Staggered: each column of strips has its own length and offset (no aligned grid).
    const lens = new Set((styles.get('strips') ?? []).map((a) => Math.round(a)));
    expect(lens.size).toBeGreaterThan((styles.get('strips') ?? []).length * 0.5);
  });

  it('orchards, wasteland and named hills in the countryside', () => {
    for (const p of plans) {
      const big0 = p.areas.filter((a) => a.kind === 'orchard' && a.w * a.h > 6000);
      expect(big0.length).toBeGreaterThanOrEqual(p === big ? 15 : 4);
      expect(p.areas.filter((a) => a.kind === 'wasteland').length).toBeGreaterThanOrEqual(
        p === big ? 10 : 3,
      );
      expect(p.hills.length).toBeGreaterThanOrEqual(p === big ? 8 : 2);
      for (const hl of p.hills) {
        expect(hl.name).toBeTruthy();
        expect(h(p, hl.x, hl.y)).toBeGreaterThan(h(p, hl.x + hl.r * 1.6, hl.y) - 1);
      }
    }
  });

  it('Lipowiec PKP on a branch line off the main line to the map edge', () => {
    for (const p of plans) {
      const st = p.complexes.find((c) => c.name === 'Lipowiec PKP');
      expect(st).toBeDefined();
      const rails = p.roads.filter((r) => r.cls === 'rail' && polyLength(r.pts) > 2000);
      expect(rails.length).toBe(2);
      const branch = rails.find((r) => new PolylineIndex(r.pts).dist(st!.x, st!.y) < 80);
      expect(branch).toBeDefined();
      const e = branch!.pts.at(-1)!;
      expect(Math.min(e.x, e.y, p.size - e.x, p.size - e.y)).toBeLessThan(1);
    }
  });

  it('sawmill at a forest edge, gravel pit by the river, sugar factory on the rail, 3 PGRs', () => {
    for (const p of plans) {
      const river = new PolylineIndex(p.river);
      const saw = p.complexes.filter((c) => c.kind === 'sawmill');
      expect(saw.length).toBeGreaterThanOrEqual(1);
      for (const s of saw) {
        let forest = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          if (isForest(p, s.x + Math.cos(a) * 250, s.y + Math.sin(a) * 250)) forest++;
        }
        expect(forest).toBeGreaterThan(0);
        expect(isForest(p, s.x, s.y)).toBe(false);
      }
      const gravel = p.complexes.find((c) => c.kind === 'gravel')!;
      expect(gravel).toBeDefined();
      const gd = river.dist(gravel.x, gravel.y);
      expect(gd).toBeGreaterThan(300);
      expect(gd).toBeLessThan(900);
      const sugar = p.complexes.find((c) => c.kind === 'sugar');
      expect(sugar).toBeDefined();
      const railNear = p.roads.some(
        (r) => r.cls === 'rail' && new PolylineIndex(r.pts).dist(sugar!.x, sugar!.y) < 200,
      );
      expect(railNear).toBe(true);
      expect(p.buildings.filter((b) => b.kind === 'silo' && dist(b, sugar!) < 200).length).toBe(2);
      expect(p.buildings.some((b) => b.kind === 'chimney' && dist(b, sugar!) < 200)).toBe(true);
      const pgr = p.complexes.filter((c) => c.kind === 'farm' && c.name?.startsWith('PGR'));
      expect(pgr.map((c) => c.name).sort()).toEqual(['PGR Borki', 'PGR Olszynki', 'PGR Zagrodno']);
    }
  });
});
