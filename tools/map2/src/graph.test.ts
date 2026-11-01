import { describe, expect, it } from 'vitest';
import { buildNet, checkNet, fillet, type Pt } from './graph.js';
import { projection } from './project.js';
import type { RawOsm2, RawWay } from './raw.js';

/** Raw map from local metre points (≈ 1 m = 1/71 000° lon, 1/111 200° lat near the origin). */
const O = { lon: 22, lat: 50.5 };
function raw(nodes: Record<number, Pt>, ways: [number[], Record<string, string>][]): RawOsm2 {
  const ll: RawOsm2['nodes'] = {};
  for (const [id, [x, y]] of Object.entries(nodes))
    ll[id] = [O.lon + x / 70950, O.lat - y / 111220];
  return {
    format: 'deadzone-osm-raw-2',
    bbox: [0, 0, 0, 0],
    source: '',
    license: '',
    nodes: ll,
    ways: ways.map(([n, t], i): RawWay => ({ id: i + 1, nodes: n, t })),
    areas: [],
    places: [],
  };
}
const P = projection(O);

describe('buildNet', () => {
  it('splits ways at shared nodes and types the junctions', () => {
    // X at node 2: 1-2-3 and 4-2-5; T at node 3 with 3-6.
    const r = raw(
      { 1: [-100, 0], 2: [0, 0], 3: [100, 0], 4: [0, -100], 5: [0, 100], 6: [100, 100] },
      [
        [[1, 2, 3], { highway: 'tertiary' }],
        [[4, 2, 5], { highway: 'residential' }],
        [[3, 6], { highway: 'residential' }],
      ],
    );
    const net = buildNet(r, P);
    expect(net.edges).toHaveLength(5);
    const kind = (n: number) => net.junctions.find((j) => j.node === n)?.kind;
    expect(kind(2)).toBe('X');
    expect(kind(3)).toBe('bend');
    expect(kind(1)).toBe('end');
    const x = net.junctions.find((j) => j.node === 2)!;
    expect(x.radius).toBe(8);
    expect(x.fillets).toHaveLength(4);
  });
  it('merge (sharp angle) and roundabout', () => {
    const r = raw(
      {
        1: [-100, 0],
        2: [0, 0],
        3: [100, 0],
        4: [-100, 30],
        10: [200, 0],
        11: [210, 10],
        12: [200, 20],
        13: [190, 10],
      },
      [
        [[1, 2, 3], { highway: 'primary' }],
        [[4, 2], { highway: 'primary_link', oneway: 'yes' }],
        [[3, 10], { highway: 'primary' }],
        [[10, 11, 12, 13, 10], { highway: 'tertiary', junction: 'roundabout' }],
      ],
    );
    const net = buildNet(r, P);
    expect(net.junctions.find((j) => j.node === 2)?.kind).toBe('merge');
    expect(net.junctions.find((j) => j.node === 10)?.kind).toBe('roundabout');
  });
  it('pairs dual carriageways', () => {
    const r = raw(
      { 1: [0, 0], 2: [300, 0], 3: [300, 20], 4: [0, 20], 5: [0, 200], 6: [300, 200] },
      [
        [[1, 2], { highway: 'primary', oneway: 'yes', name: 'KEN' }],
        [[3, 4], { highway: 'primary', oneway: 'yes', name: 'KEN' }],
        [[6, 5], { highway: 'primary', oneway: 'yes', name: 'KEN' }],
      ],
    );
    const net = buildNet(r, P);
    expect(net.edges[0]!.dual).toBe(1);
    expect(net.edges[1]!.dual).toBe(0);
    expect(net.edges[2]!.dual).toBeUndefined();
  });
  it('checks gaps and same-level overlaps, not bridges', () => {
    const r = raw(
      {
        1: [-50, 0],
        2: [50, 0],
        3: [0, 2],
        4: [0, 80],
        5: [-50, 40],
        6: [50, 40],
        7: [20, -10],
        8: [20, 70],
        9: [30, -10],
        10: [30, 70],
      },
      [
        [[1, 2], { highway: 'residential' }],
        [[3, 4], { highway: 'residential' }], // ends 2 m short of 1-2: gap
        [[5, 6], { highway: 'residential' }],
        [[7, 8], { highway: 'residential' }], // crosses 1-2 and 5-6 without nodes (as does 3-4 × 5-6)
        [[9, 10], { highway: 'residential', bridge: 'yes', layer: '1' }], // bridge: fine
      ],
    );
    const c = checkNet(buildNet(r, P));
    expect(c.gaps).toHaveLength(1);
    expect(c.overlaps.length).toBe(3); // 7-8 × 1-2, 7-8 × 5-6, 3-4 × 5-6
  });
});

describe('fillet', () => {
  it('is an arc of the radius tangent to both kerbs of a right angle', () => {
    // Arms east (half width 3) and south (y down; half width 4), radius 6.
    const f = fillet([0, 0], 0, 3, Math.PI / 2, 4, 6)!;
    expect(f[0]![1]).toBeCloseTo(3, 5); // on P's kerb y = 3
    expect(f[f.length - 1]![0]).toBeCloseTo(4, 5); // on Q's kerb x = 4
    const cen: Pt = [10, 9];
    for (const p of f) expect(Math.hypot(p[0] - cen[0], p[1] - cen[1])).toBeCloseTo(6, 1);
  });
  it('no fillet for a straight-through pair', () => {
    expect(fillet([0, 0], 0, 3, Math.PI, 3, 6)).toBeUndefined();
  });
});
