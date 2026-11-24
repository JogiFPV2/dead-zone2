import { CHUNK_SIZE } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import { clipSegment, fillRings, fillRingsInner } from './raster.js';
import { OSM_REGIONS, osmPlan } from './sources.js';
import { rotatePt, rotation } from './straighten.js';

/** Point-in-polygon (even-odd) for a flat [x, y, …] ring. */
function inside(ring: readonly number[], x: number, y: number): boolean {
  let c = false;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[2 * i + 1]!;
    const yj = ring[2 * j + 1]!;
    if (yi > y !== yj > y) {
      const xi = ring[2 * i]!;
      const xj = ring[2 * j]!;
      if (x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
    }
  }
  return c;
}

describe('conservative outline raster', () => {
  it('keeps only tiles whose whole square is inside a slanted outline', () => {
    // Square turned by 30°, centre (20, 20), side 16.
    const a = (30 * Math.PI) / 180;
    const ring = [
      [-8, -8],
      [8, -8],
      [8, 8],
      [-8, 8],
    ].flatMap(([u, v]) => [
      20 + u! * Math.cos(a) - v! * Math.sin(a),
      20 + u! * Math.sin(a) + v! * Math.cos(a),
    ]);
    const rings = [Float64Array.from(ring)];
    const inner: number[] = [];
    const centre: number[] = [];
    fillRingsInner(rings, 0, 0, 40, 40, (i) => inner.push(i));
    fillRings(rings, 0, 0, 40, 40, (i) => centre.push(i));
    expect(inner.length).toBeGreaterThan(150);
    expect(inner.length).toBeLessThan(centre.length);
    for (const i of inner) {
      const x = i % 40;
      const y = (i - x) / 40;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ])
        expect(inside(ring, x + dx! * 0.999 + 0.0005, y + dy! * 0.999 + 0.0005)).toBe(true);
    }
  });

  it('clips segments to a box', () => {
    expect(clipSegment(-1, 5, 11, 5, 0, 0, 10, 10)).toEqual([0, 5, 10, 5]);
    expect(clipSegment(-1, -1, -2, -5, 0, 0, 10, 10)).toBeUndefined();
  });
});

describe('vector walls of slanted buildings', () => {
  // One block turned by 18° in the raw frame: 45° after the map rotation (no snapping).
  const r = rotation(27);
  const cx = 8200;
  const cy = 8200;
  const a = (18 * Math.PI) / 180;
  const raw = [
    [-14, -9],
    [14, -9],
    [14, 9],
    [-14, 9],
    [-14, -9],
  ].map(([u, v]) => [
    cx + u! * Math.cos(a) - v! * Math.sin(a),
    cy + u! * Math.sin(a) + v! * Math.cos(a),
  ]);
  const m: OsmMap = {
    format: 'deadzone-osm-1',
    crs: 'EPSG:32634',
    E0: 0,
    N1: 0,
    size: 16384,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    source: 'test',
    roads: [
      { id: 1, kind: 'residential', width: 7, sidewalk: 2, pts: [78000, 81500, 86000, 81500] },
    ],
    rails: [],
    waterways: [],
    areas: [],
    buildings: [
      {
        id: 7,
        type: 'house',
        kind: 'house',
        typeFrom: 'tag',
        levels: 2,
        levelsFrom: 'tag',
        rings: [raw.flatMap(([x, y]) => [Math.round(x! * 10), Math.round(y! * 10)])],
      },
    ],
    trees: [],
    treeRows: [],
    pois: [],
    places: [],
  };
  const world = raw.slice(0, 4).flatMap(([x, y]) => {
    const p = rotatePt(r, x!, y!);
    return [p.x, p.y];
  });

  it('emits outline segments per storey with gaps at openings, stairs inside the line', () => {
    const gen = new PlanChunkGenerator(
      osmPlan(m, { dataHash: 'x', region: 'all', ...OSM_REGIONS.all }),
    );
    const wx = world.filter((_, i) => i % 2 === 0);
    const wy = world.filter((_, i) => i % 2 === 1);
    const chunks = new Set<string>();
    for (let x = Math.min(...wx); x <= Math.max(...wx) + 1; x += 4)
      for (let y = Math.min(...wy); y <= Math.max(...wy) + 1; y += 4)
        chunks.add(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`);
    let total = 0;
    let gated = 0;
    const zs = new Set<number>();
    let roomTiles = 0;
    for (const k of chunks) {
      const [ccx, ccy] = k.split(',').map(Number) as [number, number];
      const col = gen.column(ccx, ccy);
      for (const l of col!.levels) {
        for (const s of l.wallSegments ?? []) {
          zs.add(s.z);
          expect(s.z).toBe(l.z);
          expect(s.building).toBeGreaterThan(0);
          // On the outline, inside this chunk.
          for (const [x, y] of [
            [s.x0, s.y0],
            [s.x1, s.y1],
          ]) {
            expect(x).toBeGreaterThanOrEqual(ccx * CHUNK_SIZE - 1e-6);
            expect(x).toBeLessThanOrEqual((ccx + 1) * CHUNK_SIZE + 1e-6);
            expect(y).toBeGreaterThanOrEqual(ccy * CHUNK_SIZE - 1e-6);
            expect(y).toBeLessThanOrEqual((ccy + 1) * CHUNK_SIZE + 1e-6);
          }
          // Plain walls only: gates close the gaps (the doorway's / window's raster edge).
          if (l.z === 0 && !s.gate) total += Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
          if (s.gate) gated++;
        }
        if (l.z !== 0 || !l.room) continue;
        for (let i = 0; i < l.room.length; i++) {
          if (!l.room[i]) continue;
          roomTiles++;
          const x = ccx * CHUNK_SIZE + (i % CHUNK_SIZE);
          const y = ccy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
          for (const [dx, dy] of [
            [0.01, 0.01],
            [0.99, 0.01],
            [0.01, 0.99],
            [0.99, 0.99],
          ])
            expect(inside(world, x + dx!, y + dy!)).toBe(true);
        }
      }
    }
    expect(roomTiles).toBeGreaterThan(200);
    expect([...zs].sort()).toEqual([0, 1]);
    // Perimeter 2 · (28 + 18) = 92 m, minus 1.2 m gaps at the doorway(s) and windows (slanted
    // walls get windows on their steps too since #351, so the floor is 25, not 30).
    expect(total).toBeGreaterThan(25);
    expect(total).toBeLessThan(92 - 1);
    expect(gated).toBeGreaterThan(0);
  });
});
