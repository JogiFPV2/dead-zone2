import { footBlockers } from './infra.js';
import { describe, expect, it } from 'vitest';
import type { OsmPower, OsmRail, OsmRailNode } from '../osm/types.js';
import { chunkInfra, MAST_TRACK_X, sideOf, type GenInfra } from './infra.js';
import { PlanIndex } from './plan-index.js';
import type { WorldPlanInput } from './plan.js';

const d = (pts: number[]) => pts.map((v) => v * 10);
function index(f: { power?: OsmPower[]; rails?: OsmRail[]; railNodes?: OsmRailNode[] }) {
  const plan: WorldPlanInput = {
    id: 't',
    version: 't',
    seed: 1,
    size: 1024,
    bounds: { cx0: 0, cy0: 0, cx1: 31, cy1: 31 },
    features: {
      roads: [],
      rails: f.rails ?? [],
      power: f.power ?? [],
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
/** Infra of all chunks of a box, merged (spans deduped as the game does). */
function all(idx: PlanIndex, c0 = 0, c1 = 12): GenInfra {
  const out: GenInfra = { poles: [], spans: [], track: [] };
  const seen = new Set<string>();
  for (let cy = c0; cy <= c1; cy++)
    for (let cx = c0; cx <= c1; cx++) {
      const g = chunkInfra(idx, cx, cy, 32);
      if (!g) continue;
      out.poles.push(...g.poles);
      out.track.push(...g.track);
      for (const s of g.spans) {
        const k = `${s.a.x},${s.a.y},${s.b.x},${s.b.y}`;
        if (!seen.has(k)) out.spans.push(s);
        seen.add(k);
      }
    }
  return out;
}

describe('chunk infrastructure', () => {
  it('high voltage: a tower per vertex by voltage and circuits, spans tower to tower', () => {
    const idx = index({
      power: [
        { id: 1, kind: 'hv110', circuits: 1, pts: d([20, 100, 320, 100, 320, 380]) },
        { id: 2, kind: 'hv110', circuits: 2, pts: d([20, 200, 300, 200]) },
        { id: 3, kind: 'hv220', circuits: 2, pts: d([20, 300, 300, 300]) },
      ],
    });
    const g = all(idx);
    expect(g.poles.filter((p) => p.m === 'hv110-os24').length).toBe(3);
    expect(g.poles.filter((p) => p.m === 'hv110-dt').length).toBe(2);
    expect(g.poles.filter((p) => p.m === 'hv220').length).toBe(2);
    expect(g.spans.length).toBe(4);
    // Every span listed in each chunk under it: the 300 m span shows from any of them.
    expect(chunkInfra(idx, 5, 3, 32)?.spans.length).toBe(1);
  });

  it('low voltage: poles every ≤ 45 m, the corner pole on the bisector with +x outward', () => {
    const idx = index({
      power: [{ id: 1, kind: 'lv', circuits: 1, pts: d([40, 40, 140, 40, 140, 140]) }],
    });
    const g = all(idx);
    const corner = g.poles.filter((p) => p.m === 'lv-zerdz-narozny');
    expect(corner.length).toBe(1);
    const c = corner[0]!;
    expect([c.x, c.y]).toEqual([140, 40]);
    // Turn from +x to +y: the outside is (+1, -1).
    const sx = sideOf(c.rot);
    expect(sx.x).toBeGreaterThan(0.6);
    expect(sx.y).toBeLessThan(-0.6);
    // Two 100 m segments, 3 spans each.
    expect(g.poles.length).toBe(7);
    expect(g.spans.length).toBe(6);
    expect(g.spans.every((s) => s.sag === 0.025)).toBe(true);
  });

  it('railway: track tiles, a switch, a buffer stop at the siding end, a crossing, catenary', () => {
    const idx = index({
      rails: [
        { id: 1, kind: 'rail', el: 1, pts: d([0, 100, 100, 100, 300, 100, 400, 100]) },
        { id: 2, kind: 'siding', pts: d([100, 100, 160, 104, 220, 112]) },
      ],
      railNodes: [
        { kind: 'switch', x: 1000, y: 1000 },
        { kind: 'level_crossing', x: 3000, y: 1000 },
      ],
    });
    const g = all(idx, 0, 13);
    const sw = g.poles.filter((p) => p.m === 'tor-rozjazd-1-9');
    expect(sw.length).toBe(1);
    expect(sw[0]!.x).toBeCloseTo(113.5);
    // Branch to +y (south), main line along +x: model +x points to -y → mirrored.
    expect(sw[0]!.mirror).toBe(1);
    expect(g.poles.filter((p) => p.m === 'tor-koziol-oporowy').length).toBe(1);
    expect(g.poles.filter((p) => p.m === 'przejazd-kat-a').length).toBe(1);
    // No plain track tile inside the switch or the crossing.
    for (let i = 0; i < g.track.length; i += 4) {
      const x = g.track[i]!;
      const y = g.track[i + 1]!;
      if (Math.abs(y - 100) < 1) {
        expect(x > 100 && x < 127).toBe(false);
        expect(Math.abs(x - 300) < 6).toBe(false);
      }
    }
    expect(g.track.length / 4).toBeGreaterThan(400 - 27 - 12);
    const masts = g.poles.filter((p) => p.m.startsWith('catenary-mast'));
    expect(masts.length).toBeGreaterThanOrEqual(7);
    // Masts alternate a / b and stand 3.2 m from the track axis.
    for (const m of masts) expect(Math.abs(Math.abs(m.y - 100) - MAST_TRACK_X)).toBeLessThan(0.01);
    expect(g.spans.filter((s) => s.a.m.startsWith('catenary')).length).toBe(masts.length - 1);
  });
});

describe('footBlockers (SimChunk.blockers, #256)', () => {
  it('four leg pads of a tower, rotated, clipped to the chunk; none for barriers or LV poles', () => {
    const t = footBlockers({ m: 'hv220', x: 16, y: 16, rot: 0 }, 0, 0, 32);
    expect(t).toHaveLength(4);
    for (const b of t) expect(b.x1 - b.x0).toBeCloseTo(0.9, 5);
    const r = footBlockers({ m: 'hv220', x: 16, y: 16, rot: Math.PI / 4 }, 0, 0, 32);
    expect(r).toHaveLength(4);
    expect(r[0]!.x1 - r[0]!.x0).toBeCloseTo(0.9 * Math.SQRT2, 2);
    // Tower on the chunk edge: only the pads inside, cut at the edge.
    const e = footBlockers({ m: 'hv220', x: 3, y: 16, rot: 0 }, 0, 0, 32);
    expect(e).toHaveLength(4);
    expect(e.filter((b) => b.x0 === 0)).toHaveLength(2);
    expect(footBlockers({ m: 'hv220', x: -1, y: 16, rot: 0 }, 0, 0, 32)).toHaveLength(2);
    expect(footBlockers({ m: 'przejazd-kat-a', x: 16, y: 16, rot: 0 }, 0, 0, 32)).toEqual([]);
    expect(footBlockers({ m: 'lv-zerdz', x: 16, y: 16, rot: 0 }, 0, 0, 32)).toEqual([]);
    expect(footBlockers({ m: 'catenary-mast-a', x: 16, y: 16, rot: 0 }, 0, 0, 32)).toHaveLength(1);
  });
});
