import { describe, expect, it } from 'vitest';
import type { OsmRail, OsmRailNode, OsmRoad } from '../osm/types.js';
import { chunkInfra, type GenInfra } from './infra.js';
import { PlanIndex } from './plan-index.js';
import type { WorldPlanInput } from './plan.js';
import { crossingScale, crossingSides } from './rail-crossing.js';

const d = (pts: number[]) => pts.map((v) => v * 10);
function index(f: { rails: OsmRail[]; railNodes?: OsmRailNode[]; roads?: OsmRoad[] }) {
  const plan: WorldPlanInput = {
    id: 't',
    version: 't',
    seed: 1,
    size: 1024,
    bounds: { cx0: 0, cy0: 0, cx1: 31, cy1: 31 },
    features: {
      roads: f.roads ?? [],
      rails: f.rails,
      power: [],
      railNodes: f.railNodes ?? [],
      waterways: [],
      areas: [],
      buildings: [],
      trees: [],
      treeRows: [],
      pois: [],
      places: [],
    },
    start: { x: 0, y: 0 },
  };
  return new PlanIndex(plan);
}
function all(idx: PlanIndex): GenInfra {
  const out: GenInfra = { poles: [], spans: [], track: [] };
  for (let cy = 0; cy <= 12; cy++)
    for (let cx = 0; cx <= 12; cx++) {
      const g = chunkInfra(idx, cx, cy, 32);
      if (!g) continue;
      out.poles.push(...g.poles);
      out.track.push(...g.track);
    }
  return out;
}
const road = (id: number, pts: number[], width: number, bridge = false): OsmRoad => ({
  id,
  kind: 'primary',
  width,
  sidewalk: 2,
  pts: d(pts),
  ...(bridge ? { bridge: 1 as const } : {}),
});
const rail = (id: number, y: number, el = false): OsmRail => ({
  id,
  kind: 'rail',
  ...(el ? { el: 1 as const } : {}),
  pts: d([0, y, 150, y, 300, y]),
});

describe('przejazdy kolejowe i tory pod wiaduktem (Paweł 27.10)', () => {
  it('przejazd przez trzy tory: płyty na całą jezdnię, znaki i rogatki tylko po zewnętrznych stronach', () => {
    const ys = [100, 104.6, 109.2];
    const idx = index({
      rails: ys.map((y, i) => rail(i + 1, y)),
      railNodes: ys.map((y) => ({ kind: 'level_crossing', x: 1500, y: y * 10 })),
      roads: [road(9, [150, 60, 150, 150], 11)],
    });
    const xs = all(idx).poles.filter((p) => p.m === 'przejazd-kat-a');
    expect(xs.length).toBe(3);
    // 11 m carriageway: plates (7.2 m at scale 1) stretched to cover it.
    for (const p of xs) expect(p.len).toBeGreaterThanOrEqual(11 / 7.2);
    const sides = xs.map((p) => p.furn ?? 3).sort();
    // Middle track: no furniture; each outer track keeps the side away from the others.
    expect(sides).toEqual([0, 1, 2]);
  });

  it('pojedynczy tor: obie strony, skala 1 na wąskiej drodze', () => {
    const idx = index({ rails: [rail(1, 100)], roads: [road(9, [150, 60, 150, 150], 6)] });
    const n = { x: 150, y: 100 };
    expect(crossingScale(idx, n, { x: 1, y: 0 })).toBe(1);
    expect(crossingSides(n, { x: 1, y: 0 }, { x: 0, y: -1 }, [], 1)).toBe(3);
  });

  it('tor pod wiaduktem drogowym: bez kafli toru i masztów sieci na pomoście', () => {
    const idx = index({
      rails: [rail(1, 100, true)],
      // Masts every 60 m (0, 60, 120…): one would stand on the deck at x = 120.
      roads: [road(9, [120, 60, 120, 150], 10, true)],
    });
    const g = all(idx);
    for (let i = 0; i < g.track.length; i += 4)
      expect(Math.abs(g.track[i]! - 120), `kafel toru x=${g.track[i]}`).toBeGreaterThan(5);
    expect(g.track.length).toBeGreaterThan(200);
    for (const p of g.poles.filter((p) => p.m.startsWith('catenary')))
      expect(Math.abs(p.x - 120), `maszt x=${p.x}`).toBeGreaterThan(7);
  });
});
