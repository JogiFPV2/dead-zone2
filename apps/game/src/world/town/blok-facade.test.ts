import { describe, expect, it } from 'vitest';
import type { SimWallSegment } from '@deadzone/protocol';
import type { BuildingId } from '../chunk.js';
import { blokBoxes, boxesGeometry, boxCentre, type BlokInfo } from './blok-facade.js';
import type { TownEdge } from './layout.js';

const B = 7 as BuildingId;
const edge = (kind: TownEdge['kind'], tx: number, ty: number, axis: 'N' | 'W' = 'N'): TownEdge => ({
  kind,
  content: 'base:wall',
  axis,
  tx,
  ty,
  building: B,
  interior: false,
  skin: 'plaster',
});
const rect: BlokInfo = { floors: 5, x0: 0, y0: 0, x1: 39, y1: 11, insulated: false, seed: 1 };
const all = () => true;

describe('blok facade', () => {
  it('a long wall gets one balcony per 4 m from the first floor, the entrance a canopy', () => {
    // South wall (y = 12) of a 40 × 12 block: windows on every second tile, a door at x = 20.
    const edges = Array.from({ length: 40 }, (_, x) =>
      edge(x === 20 ? 'door' : x % 2 ? 'window' : 'wall', x, 12),
    );
    const info = () => rect;
    const out = (e: TownEdge) => (e.ty === 12 ? 1 : 0);
    const ground = blokBoxes(edges, [], 0, 0, info, out, all);
    expect(ground.filter((b) => b.box.cell === 'blok-canopy').length).toBe(3);
    expect(ground.filter((b) => b.box.cell === 'blok-slab').length).toBe(1); // the step only
    const first = blokBoxes(edges, [], 1, 3, info, out, all);
    const slabs = first.filter((b) => b.box.cell === 'blok-slab');
    expect(slabs.length).toBe(10);
    // Outside the wall (+y), not inside the block.
    for (const s of slabs) expect(boxCentre(s.box)[1]).toBeGreaterThan(12);
    // Panel joints on the grey block.
    expect(first.some((b) => b.box.cell === 'blok-joint')).toBe(true);
  });

  it('slanted blocks: balconies on the long outline sides, roof vents only in range', () => {
    // 40 × 12 block rotated by 30°.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const p = [
      [0, 0],
      [40, 0],
      [40, 12],
      [0, 12],
    ].map(([x, y]) => [100 + x! * c - y! * s, 100 + x! * s + y! * c] as const);
    const outline = p.flat();
    const info = (): BlokInfo => ({ ...rect, x0: 80, y0: 100, x1: 135, y1: 130, outline });
    const segs: SimWallSegment[] = p.map((a, i) => {
      const b = p[(i + 1) % 4]!;
      return { x0: a[0], y0: a[1], x1: b[0], y1: b[1], z: 2, building: B };
    });
    const out = blokBoxes([], segs, 2, 6, info, () => 0, all);
    const slabs = out.filter((b) => b.box.cell === 'blok-slab');
    expect(slabs.length).toBe(2 * 10);
    const top = blokBoxes([], segs, 4, 12, info, () => 0, all).filter((b) => b.roof);
    expect(top.length).toBeGreaterThan(4);
    const none = blokBoxes(
      [],
      segs,
      4,
      12,
      info,
      () => 0,
      () => false,
    ).filter((b) => b.roof);
    expect(none.length).toBe(0);
    const g = boxesGeometry(
      slabs.map((b) => b.box),
      () => [0.5, 0.5],
    );
    expect(g.getAttribute('position').count).toBe(slabs.length * 24);
  });
});
