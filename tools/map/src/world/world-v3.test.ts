import { describe, expect, it } from 'vitest';
import { dist, inORect, oRectCorners, PolylineIndex, segCross, type Pt } from './geom.js';
import { frontage, planOldTown, type Lot } from './oldtown.js';
import {
  FALLBACK_WORLD_SIZE,
  forestNoise,
  planWorld,
  ROAD_WIDTH,
  RoadIndex,
  type Area,
  type Footprint,
  type WorldPlan,
} from './plan.js';
import { clearFeatures, farmlandMask, largestOpenSquare, OPEN_CELL } from './openland.js';
import { rng } from './rng.js';
import { baseHeight } from './terrain.js';

const plans = [planWorld({ seed: 1993 }), planWorld({ seed: 7, size: FALLBACK_WORLD_SIZE })];
const big = plans[0]!;
const river0 = new PolylineIndex(big.river);

const inEllipse = (l: Area, x: number, y: number, margin = 0) => {
  const c = Math.cos(l.a);
  const s = Math.sin(l.a);
  const u = ((x - l.x) * c + (y - l.y) * s) / (l.w / 2 + margin);
  const v = (-(x - l.x) * s + (y - l.y) * c) / (l.h / 2 + margin);
  return u * u + v * v <= 1;
};
// Lakes, without the bays (plan-4 lobes on a big lake's shore, part of that lake).
const lakesOf = (p: WorldPlan) => {
  const named = p.areas.filter((a) => a.kind === 'lake' && a.name);
  return p.areas.filter(
    (a) =>
      a.kind === 'lake' &&
      a.w > 100 &&
      (a.name !== undefined || !named.some((n) => dist(n, a) < n.w / 2)),
  );
};
const h = (p: WorldPlan, x: number, y: number) => baseHeight(p.seed, p.size, x, y, p.riverMouth);
const floorArea = (b: Footprint) => b.w * b.h * b.floors;

describe('world plan v3: a varied, real-looking 16 km map', { timeout: 120_000 }, () => {
  it('frontages: lots on a straight street touch wall to wall and fill it exactly', () => {
    const lots: Lot[] = [];
    const street: Pt[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    frontage(street, 8, rng(5), (l) => (lots.push(l), true));
    for (const side of [-1, 1]) {
      const row = lots.filter((l) => Math.sign(l.y) === side).sort((a, b) => a.x - b.x);
      expect(row.every((l) => l.a === 0)).toBe(true);
      expect(row[0]!.x - row[0]!.w / 2).toBeCloseTo(4, 6);
      expect(row.at(-1)!.x + row.at(-1)!.w / 2).toBeCloseTo(196, 6);
      for (let i = 1; i < row.length; i++)
        expect(row[i]!.x - row[i]!.w / 2 - (row[i - 1]!.x + row[i - 1]!.w / 2)).toBeCloseTo(0, 6);
      for (const l of row) expect(l.w).toBeLessThanOrEqual(13);
    }
  });

  it('old town frontages are built up to the cross streets (corner tenements, no empty lots)', () => {
    const shares: number[] = [];
    for (const p of plans) {
      const index = new RoadIndex(p.size, p.roads);
      p.roads.forEach((_, i) => index.add(i));
      for (const s of p.settlements.filter((t) => t.kind === 'city' || t.kind === 'town')) {
        const ot = planOldTown({
          seed: p.seed,
          id: s.id,
          x: s.x,
          y: s.y,
          r: s.r,
          angle: s.angle,
          city: s.kind === 'city',
        });
        const near = p.buildings.filter((b) => dist(b, s) < s.r * 0.6);
        let n = 0;
        let built = 0;
        // Probe every 2 m just behind the building line of the radials and the ring, right up
        // to the cross streets' pavements (only the street itself is excused).
        for (const st of [...ot.radials, ot.ring]) {
          const rw = st === ot.ring && s.kind === 'city' ? ROAD_WIDTH.main : ROAD_WIDTH.street;
          for (let k = 1; k < st.length; k++) {
            const a = st[k - 1]!;
            const b = st[k]!;
            const L = dist(a, b);
            const dx = (b.x - a.x) / L;
            const dy = (b.y - a.y) / L;
            for (let t = 1; t < L; t += 2)
              for (const side of [-1, 1]) {
                const o = rw / 2 + 3;
                const q = { x: a.x + dx * t - dy * side * o, y: a.y + dy * t + dx * side * o };
                if (index.nearest(q.x, q.y, 5.5) || inORect(ot.square, q.x, q.y, 2)) continue;
                n++;
                if (near.some((f) => inORect(f, q.x, q.y, 0.3))) built++;
              }
          }
        }
        expect(built / n, `${s.name}: frontage built`).toBeGreaterThan(0.7);
        shares.push(built / n);
      }
    }
    expect(shares.reduce((x, y) => x + y, 0) / shares.length).toBeGreaterThan(0.78);
  });

  it('frontages in the plan: neighbours share the angle and the wall (gap 0 ± 0.01 m)', () => {
    for (const p of plans) {
      const ten = p.buildings.filter(
        (b) => b.kind === 'tenement' || b.kind === 'shop' || b.kind === 'bar',
      );
      const cell = new Map<string, Footprint[]>();
      const key = (x: number, y: number) => `${Math.floor(x / 30)},${Math.floor(y / 30)}`;
      for (const b of ten) {
        const k = key(b.x, b.y);
        cell.set(k, [...(cell.get(k) ?? []), b]);
      }
      let pairs = 0;
      for (const a of ten) {
        const c = Math.cos(a.a);
        const s = Math.sin(a.a);
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++)
            for (const b of cell.get(key(a.x + i * 30, a.y + j * 30)) ?? []) {
              if (b === a || Math.abs(b.a - a.a) > 1e-9) continue;
              // Same row: the street-side faces line up (centre offset minus half depth).
              const du = (b.x - a.x) * c + (b.y - a.y) * s;
              const dv = -(b.x - a.x) * s + (b.y - a.y) * c;
              const front = Math.abs(Math.abs(dv) - Math.abs(b.h - a.h) / 2);
              if (du <= 0 || front > 0.01 || Math.abs(dv) > 3) continue;
              const gap = du - (a.w + b.w) / 2;
              if (gap > 1) continue; // not neighbours (a rejected lot in between)
              expect(Math.abs(gap)).toBeLessThan(0.01);
              pairs++;
            }
      }
      expect(pairs).toBeGreaterThan(300);
    }
  });

  it('every road and railway crossing of the river has a bridge', () => {
    for (const p of plans) {
      const river = p.river;
      let crossings = 0;
      p.roads.forEach((r, ri) => {
        for (let k = 1; k < r.pts.length; k++)
          for (let j = 1; j < river.length; j++) {
            const hit = segCross(r.pts[k - 1]!, r.pts[k]!, river[j - 1]!, river[j]!);
            if (!hit) continue;
            crossings++;
            const br = p.bridges
              .filter((b) => b.over === 'river')
              .find((b) => b.road === ri && Math.hypot(b.x - hit.x, b.y - hit.y) < 0.5);
            expect(br, `${r.cls} at ${Math.round(hit.x)},${Math.round(hit.y)}`).toBeDefined();
            expect(br!.w).toBeGreaterThan(p.riverWidth);
          }
      });
      expect(p.bridges.filter((b) => b.over === 'river').length).toBe(crossings);
      expect(p.bridges.filter((b) => b.over === 'river').some((b) => b.cls === 'rail')).toBe(true);
      expect(
        p.bridges
          .filter((b) => b.over === 'river')
          .some((b) => b.cls === 'highway' || b.cls === 'main'),
      ).toBe(true);
      // Tracks and forest paths never cross water (no footbridges in the fields).
      expect(
        p.bridges
          .filter((b) => b.over === 'river')
          .some((b) => b.cls === 'track' || b.cls === 'path'),
      ).toBe(false);
    }
    // In the main city: the river runs through it, crossed by its avenues.
    const city = big.settlements.find((s) => s.name === 'Wolnogród')!;
    const inCity = big.bridges
      .filter((b) => b.over === 'river')
      .filter((b) => dist(b, city) < city.r * 1.1);
    expect(inCity.length).toBeGreaterThanOrEqual(2);
  });

  it('city streets never end at the water: bridges on the main axes, quays along the banks', () => {
    for (const p of plans) {
      const river = new PolylineIndex(p.river);
      const index = new RoadIndex(p.size, p.roads);
      p.roads.forEach((_, i) => index.add(i));
      for (const s of p.settlements.filter((t) => t.kind === 'city' || t.kind === 'town')) {
        if (river.dist(s.x, s.y) > s.r * 1.3) continue;
        p.roads.forEach((r, i) => {
          if (r.cls !== 'street' && r.cls !== 'main') return;
          for (const q of [r.pts[0]!, r.pts.at(-1)!]) {
            if (dist(q, s) > s.r * 1.3 || river.dist(q.x, q.y) > 150) continue;
            expect(
              index.touches(q.x, q.y, 1.5, i),
              `${s.name}: ${r.cls} ends on the bank at ${Math.round(q.x)},${Math.round(q.y)}`,
            ).toBe(true);
          }
        });
      }
    }
    // Wolnogród: its avenues bridge the river every 300–500 m or so, quays along the banks.
    const city = big.settlements.find((s) => s.name === 'Wolnogród')!;
    const grid = big.bridges
      .filter((b) => b.over === 'river')
      .filter((b) => dist(b, city) < city.r * 1.1 && b.cls === 'main');
    expect(grid.length).toBeGreaterThanOrEqual(2);
    for (const a of grid)
      for (const b of grid) if (a !== b) expect(dist(a, b)).toBeGreaterThan(250);
    expect(
      big.bridges
        .filter((b) => b.over === 'river')
        .some((b) => dist(b, city) < city.r * 1.1 && b.cls === 'street'),
      'side streets do not bridge the river',
    ).toBe(false);
    const quay = big.roads.filter(
      (r) =>
        r.cls === 'street' &&
        dist(r.pts[0]!, city) < city.r * 1.3 &&
        r.pts.length > 3 &&
        r.pts.every((q) => Math.abs(river0.dist(q.x, q.y) - big.riverWidth / 2 - 9) < 3),
    );
    // plan-4: the hills reshaped the valley, Sołwia now skirts the west grid by an avenue, so
    // the quay runs on the east bank only.
    expect(quay.length).toBeGreaterThanOrEqual(1);
  });

  it('no open wasteland: copses, avenues, balks and farms break up every field over 600 m', () => {
    for (const p of plans) {
      const mask = farmlandMask(p);
      clearFeatures(mask, p.size, p.buildings, p.areas, p.treeLines);
      const sq = largestOpenSquare(mask, p.size);
      expect(
        sq.side * OPEN_CELL,
        `open field ${sq.side * OPEN_CELL} m square at ${Math.round(sq.x)},${Math.round(sq.y)}`,
      ).toBeLessThanOrEqual(600);
      const km2 = (p.size / 1000) ** 2;
      const trees = (k: string) =>
        p.treeLines.filter((t) => t.kind === k).reduce((n, t) => n + t.pts.length, 0);
      expect(trees('avenue') / km2, 'roadside trees per km²').toBeGreaterThan(30);
      expect(trees('balk') / km2, 'balk shrubs per km²').toBeGreaterThan(30);
      expect(p.areas.filter((a) => a.kind === 'copse').length / km2).toBeGreaterThan(2);
      // Avenues stand beside the road, not on it.
      const index = new RoadIndex(p.size, p.roads);
      p.roads.forEach((_, i) => index.add(i));
      for (const t of p.treeLines)
        for (const q of t.pts) {
          const near = index.nearest(q.x, q.y, 8, (c) => c !== 'rail');
          if (near)
            expect(near.d, `${t.kind} on a road`).toBeGreaterThan(
              ROAD_WIDTH[p.roads[near.road]!.cls] / 2 + 0.5,
            );
        }
    }
  });

  it('no building stands in the water, no road runs through a lake', () => {
    for (const p of plans) {
      const river = new PolylineIndex(p.river);
      const lakes = p.areas.filter((a) => a.kind === 'lake');
      for (const b of p.buildings)
        for (const q of [...oRectCorners(b), { x: b.x, y: b.y }]) {
          expect(river.dist(q.x, q.y), `${b.kind} in the river`).toBeGreaterThan(p.riverWidth / 2);
          expect(
            lakes.some((l) => inEllipse(l, q.x, q.y)),
            `${b.kind} in a lake`,
          ).toBe(false);
        }
      for (const r of p.roads)
        for (let k = 1; k < r.pts.length; k++) {
          const a = r.pts[k - 1]!;
          const b = r.pts[k]!;
          const n = Math.ceil(dist(a, b) / 10);
          for (let i = 0; i <= n; i++) {
            const x = a.x + ((b.x - a.x) * i) / n;
            const y = a.y + ((b.y - a.y) * i) / n;
            expect(
              lakesOf(p).some((l) => inEllipse(l, x, y)),
              `${r.cls} through a lake`,
            ).toBe(false);
          }
        }
    }
  });

  it('the river follows the terrain: it falls to its mouth, lies in a valley, meanders', () => {
    for (const p of plans) {
      const r = p.river;
      expect(h(p, r[1]!.x, r[1]!.y)).toBeGreaterThan(h(p, r.at(-2)!.x, r.at(-2)!.y));
      let lower = 0;
      let n = 0;
      for (let k = 2; k < r.length - 2; k += 3) {
        const a = r[k - 1]!;
        const b = r[k + 1]!;
        const l = dist(a, b) || 1;
        const nx = -(b.y - a.y) / l;
        const ny = (b.x - a.x) / l;
        const here = h(p, r[k]!.x, r[k]!.y);
        const sides =
          (h(p, r[k]!.x + nx * 800, r[k]!.y + ny * 800) +
            h(p, r[k]!.x - nx * 800, r[k]!.y - ny * 800)) /
          2;
        if (here < sides) lower++;
        n++;
      }
      expect(lower / n).toBeGreaterThan(0.6);
      let L = 0;
      for (let k = 1; k < r.length; k++) L += dist(r[k - 1]!, r[k]!);
      expect(L / dist(r[0]!, r.at(-1)!)).toBeGreaterThan(1.12);
    }
  });

  it('lakes lie in basins, in forests or by villages; two named ones have resorts', () => {
    for (const p of plans) {
      const lakes = lakesOf(p);
      expect(lakes.length).toBeGreaterThanOrEqual(4);
      for (const l of lakes) {
        let ring = 0;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          ring += h(p, l.x + Math.cos(a) * l.w * 0.9, l.y + Math.sin(a) * l.w * 0.9) / 12;
        }
        expect(h(p, l.x, l.y), 'basin').toBeLessThan(ring);
      }
      const named = lakes.filter((l) => l.name);
      expect(named.map((l) => l.name)).toEqual(['Jezioro Czarne', 'Jezioro Białe']);
      const resorts = p.complexes.filter((c) => c.kind === 'resort');
      expect(resorts.length).toBe(2);
      for (const l of named) {
        expect(resorts.some((c) => dist(c, l) < l.w / 2 + 160)).toBe(true);
        expect(p.areas.some((a) => a.kind === 'beach' && dist(a, l) < l.w / 2 + 40)).toBe(true);
        expect(
          p.buildings.filter((b) => b.kind === 'hut' && dist(b, l) < l.w / 2 + 120).length,
        ).toBeGreaterThan(6);
      }
      const forested = lakes.filter(
        (l) =>
          forestNoise(p.seed, l.x, l.y, p.size) > p.forestThreshold - 0.05 ||
          p.settlements.some((s) => s.kind === 'village' && dist(s, l) < 1800) ||
          p.waterways.some((w) => new PolylineIndex(w.pts).dist(l.x, l.y) < 300 + w.width),
      );
      expect(forested.length / lakes.length).toBeGreaterThan(0.7);
    }
  });

  it('villages are linear villages along the roads', () => {
    for (const p of plans) {
      const idx = new RoadIndex(p.size, p.roads);
      p.roads.forEach((_, i) => idx.add(i));
      for (const v of p.settlements.filter((s) => s.kind === 'village')) {
        const road = idx.nearest(v.x, v.y, 30, (c) => c === 'main' || c === 'local');
        expect(road, v.name).toBeDefined();
        const houses = p.buildings.filter((b) => b.kind === 'house' && dist(b, v) < v.r * 1.7);
        expect(houses.length, v.name).toBeGreaterThan(8);
        const byRoad = houses.filter((b) => (idx.nearest(b.x, b.y, 40)?.d ?? 99) < 30);
        expect(byRoad.length / houses.length, v.name).toBeGreaterThan(0.85);
      }
    }
  });

  it('built density falls steadily from the centre to the fields (old town → fields)', () => {
    const bands = [0, 0.4, 0.66, 1, 1.4, 2];
    for (const p of plans)
      for (const s of p.settlements.filter((k) => k.kind !== 'village')) {
        const dens = bands.slice(1).map((b1, k) => {
          const b0 = bands[k]!;
          let fa = 0;
          for (const b of p.buildings) {
            const d = dist(b, s) / s.r;
            if (d >= b0 && d < b1) fa += floorArea(b);
          }
          return fa / (Math.PI * s.r * s.r * (b1 * b1 - b0 * b0));
        });
        for (let k = 1; k < dens.length; k++)
          expect(
            dens[k],
            `${s.name} band ${k}: ${dens.map((d) => d.toFixed(3)).join(' ')}`,
          ).toBeLessThan(dens[k - 1]!);
        // Allotment gardens on the edge of every city.
        if (s.kind === 'city')
          expect(
            p.areas.filter((a) => a.kind === 'allotment' && dist(a, s) < s.r * 1.5).length,
          ).toBeGreaterThan(2);
      }
  });

  it("uses the designer's names; the main city sits on the river; forests and the base up north", () => {
    for (const p of plans) {
      const names = p.settlements.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
      const main = p.settlements[0]!;
      expect(main.name).toBe('Wolnogród');
      expect(main.kind).toBe('city');
      expect(new PolylineIndex(p.river).dist(main.x, main.y)).toBeLessThan(main.r * 0.7);
      expect(p.settlements[p.start]!.name).toBe('Lipowiec');
      expect(names).toEqual(
        expect.arrayContaining(['Rudnik', 'Dębowa Wola', 'Kamionka', 'Olszynki', 'Zagrodno']),
      );
      const named = p.complexes.map((c) => c.name);
      expect(named).toEqual(
        expect.arrayContaining([
          'Szpital powiatowy',
          'Komenda Powiatowa Policji',
          'JW 2417',
          'PGR Borki',
        ]),
      );
      const hq = p.complexes.find((c) => c.name === 'Szpital powiatowy')!;
      expect(hq.settlement).toBe(main.id);
      const mil = p.complexes.find((c) => c.kind === 'military')!;
      expect(mil.y).toBeLessThan(p.size / 2);
      let north = 0;
      let south = 0;
      for (let k = 0; k < 4000; k++) {
        const x = ((k * 0.618034) % 1) * p.size;
        const y = ((k * 0.7548777) % 1) * p.size;
        if (forestNoise(p.seed, x, y, p.size) > p.forestThreshold) {
          if (y < p.size / 2) north++;
          else south++;
        }
      }
      expect(north).toBeGreaterThan(south * 1.3);
    }
  });
});

// Keep the road width table in use for the bridge width check above.
void ROAD_WIDTH;
