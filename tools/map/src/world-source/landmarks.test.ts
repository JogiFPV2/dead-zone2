import { describe, expect, it } from 'vitest';
import type { OsmBuilding, OsmMap } from '../osm/types.js';
import {
  ENGINE_HALF,
  STW2_BUILDINGS,
  STW2_MARKS,
  applyLandmarks,
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
});
