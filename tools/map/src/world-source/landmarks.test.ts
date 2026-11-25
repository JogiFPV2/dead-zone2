import { describe, expect, it } from 'vitest';
import type { OsmBuilding, OsmMap } from '../osm/types.js';
import {
  ENGINE_HALF,
  STW2_BUILDINGS,
  STW2_MARKS,
  applyLandmarks,
  clipRing,
  splitPartGid,
  splitPartId,
  chunkMarks,
  markBlockers,
} from './landmarks.js';

const bld = (id: number, kind: OsmBuilding['kind'], levels = 1): OsmBuilding => ({
  id,
  osmId: id,
  type: 'house',
  kind,
  typeFrom: 'tag',
  levels,
  levelsFrom: 'tag',
  rings: [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]],
});
const map = (buildings: OsmBuilding[]): OsmMap => ({ buildings }) as unknown as OsmMap;

describe('stw2 landmarks', () => {
  it('drops the buildings that are marks (the CHP stacks were 16-floor boxes)', () => {
    const out = applyLandmarks(
      map([bld(306373763, 'industrial', 16), bld(1424946349, 'shed'), bld(1, 'house')]),
      'stw2',
    );
    expect(out.buildings.map((b) => b.id)).toEqual([1]);
  });

  it('fixes St Florian: a one-storey log church without a tower, not a 9-floor block', () => {
    const b = { ...bld(291342206, 'block', 9), tall: 1 as const };
    const [f] = applyLandmarks(map([b]), 'stw2').buildings;
    expect(f).toMatchObject({ kind: 'church', levels: 1, wall: 'base:wall-plank' });
    expect(f!.tall).toBeUndefined();
  });

  it('leaves other maps alone', () => {
    const m = map([bld(306373763, 'industrial', 16), bld(291342206, 'block', 9)]);
    expect(applyLandmarks(m, 'osm-stw')).toBe(m);
    expect(chunkMarks('osm-stw', 0, 0, 1e6)).toEqual([]);
  });

  it('every mark lies in exactly one chunk and keeps its OSM height', () => {
    const C = 64;
    const seen = new Set<number>();
    for (const k of STW2_MARKS) {
      const got = chunkMarks('stw2', Math.floor(k.x / C), Math.floor(k.y / C), C);
      const g = got.find((x) => x.x === k.x && x.y === k.y);
      expect(g, k.osm).toBeDefined();
      expect(g!.h).toBe(k.h);
      expect(seen.has(g!.seed)).toBe(false);
      seen.add(g!.seed);
    }
    const big = STW2_MARKS.find((k) => k.osm === 'w306373763')!;
    expect(big).toMatchObject({ kind: 'chimney', h: 120 });
    expect(big.h0).toBeUndefined();
  });

  it('marks are inside the stw2 world and fixes name real buildings', () => {
    for (const k of STW2_MARKS) {
      expect(k.x).toBeGreaterThan(0);
      expect(k.y).toBeGreaterThan(0);
      expect(k.x).toBeLessThan(32768);
      expect(k.y).toBeLessThan(32768);
      expect(k.r).toBeGreaterThan(0);
      expect(k.h).toBeGreaterThan(0);
    }
    for (const f of Object.values(STW2_BUILDINGS)) expect(f.note.length).toBeGreaterThan(3);
  });

  it('blocks the base of a mark, clipped to the chunk', () => {
    const [b] = markBlockers([{ kind: 'chimney', x: 70, y: 10, r: 5, h: 100, seed: 1 }], 64, 0, 64);
    expect(b).toEqual({ x0: 1, y0: 5, x1: 11, y1: 15 });
    const [e] = markBlockers(
      [{ kind: 'steam-engine', x: 32, y: 32, r: 1.6, h: 4.5, rot: 0, seed: 2 }],
      0,
      0,
      64,
    );
    expect(e!.x1 - e!.x0).toBeCloseTo(ENGINE_HALF * 2, 1);
    expect(e!.y1 - e!.y0).toBeCloseTo(3.2, 1);
  });

  it('splits the MDK into a 3-floor front wing and the 2-floor hall (inverted T, 1952)', () => {
    // OSM way 291332391 as in tile t-16-20 (dm).
    const ring = [
      139255, 175710, 139550, 175568, 139501, 175466, 139627, 175405, 139715, 175586, 139808,
      175669, 139766, 175689, 139855, 175873, 139729, 175933, 139680, 175831, 139384, 175974,
      139395, 175996, 139249, 176066, 139102, 175763, 139255, 175710,
    ];
    const b = { ...bld(291332391, 'office', 3), gid: 5453, rings: [ring] };
    const out = applyLandmarks(map([b]), 'stw2').buildings;
    expect(out).toHaveLength(2);
    const [front, hall] = out;
    expect(front).toMatchObject({ id: 291332391, gid: 5453, kind: 'office', levels: 3 });
    expect(hall).toMatchObject({
      id: splitPartId(291332391),
      osmId: 291332391,
      gid: splitPartGid(5453),
      kind: 'gym',
      levels: 2,
    });
    const area = (r: readonly number[]) => {
      let a = 0;
      for (let i = 0; i + 3 < r.length; i += 2) a += r[i]! * r[i + 3]! - r[i + 2]! * r[i + 1]!;
      return Math.abs(a) / 2 / 100; // m²
    };
    const all = area(ring);
    expect(area(hall!.rings[0]!) + area(front!.rings[0]!)).toBeCloseTo(all, -1);
    // Front wing ≈ 750 m² (54 m wide); the hall and back stage are the larger part.
    expect(area(front!.rings[0]!)).toBeGreaterThan(600);
    expect(area(front!.rings[0]!)).toBeLessThan(area(hall!.rings[0]!));
    // One shared wall, drawn by the taller front wing only.
    expect(hall!.noWall).toHaveLength(1);
    expect(front!.noWall).toBeUndefined();
  });

  it('clips a ring to a half plane and reports the cut edge', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const l = clipRing(sq, 5, 0, 5, 10, 1);
    const r = clipRing(sq, 5, 0, 5, 10, -1);
    expect(l.ring).toHaveLength(10);
    expect(Math.max(...l.ring.filter((_, i) => i % 2 === 0))).toBe(5);
    expect(Math.min(...r.ring.filter((_, i) => i % 2 === 0))).toBe(5);
    expect(l.cutEdges).toHaveLength(1);
    expect(r.cutEdges).toHaveLength(1);
  });
});
