import { InstancedMesh, Matrix4, Vector3 } from 'three';
import type { StorageMarkerView } from '@deadzone/protocol';
import { footprintCenter } from '@deadzone/content/footprint';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_TILES, type ChunkData, type ChunkSource } from './chunk.js';
import { FOOTPRINTS_OFF, footprintsOn } from './furniture-footprint.js';
import { ShelfFill } from './shelf-fill.js';
import { shelfOrigin } from './shelf-fill-model.js';

/** A 2×1 metal shelf (open, props always shown) in every rotation, plus a 1×1 bookshelf. */
const OBJECTS: NonNullable<ChunkData['objects']> = [
  { contentId: 'base:metal-shelf', x: 2, y: 2, rot: 0 },
  { contentId: 'base:metal-shelf', x: 6, y: 2, rot: 1 },
  { contentId: 'base:metal-shelf', x: 10, y: 2, rot: 2 },
  { contentId: 'base:metal-shelf', x: 14, y: 2, rot: 3 },
  { contentId: 'base:bookshelf', x: 18, y: 2, rot: 1 },
];
const CX = 1;
const CY = 2;
const source: ChunkSource = {
  tilePalette: [null],
  getChunk: (cx, cy, z): ChunkData | undefined =>
    cx === CX && cy === CY && z === 0
      ? { coord: { cx, cy, z }, floor: new Uint16Array(CHUNK_TILES).fill(1), objects: OBJECTS }
      : undefined,
};
const RANGE = { cx0: CX, cy0: CY, cx1: CX, cy1: CY, z: 0 };
const CATALOG = {
  containers: { 'base:metal-shelf': { footprint: { w: 2, h: 1 } } },
  items: {},
};
const tile = (o: NonNullable<ChunkData['objects']>[number]) => ({
  tx: CX * CHUNK_SIZE + o.x,
  ty: CY * CHUNK_SIZE + o.y,
});
const storages: StorageMarkerView[] = OBJECTS.map((o, i) => ({
  id: 100 + i,
  ...((t) => ({ x: t.tx, y: t.ty }))(tile(o)),
  z: 0,
  fillPct: 1,
  searched: true,
}));

/** Every prop instance position (x, y, z rounded), per prop kind mesh. */
function props(fill: ShelfFill): string[] {
  const out: string[] = [];
  const m = new Matrix4();
  const p = new Vector3();
  for (const c of fill.root.children) {
    if (!(c instanceof InstancedMesh)) continue;
    for (let i = 0; i < c.count; i++) {
      c.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push(`${c.name}:${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`);
    }
  }
  return out.sort();
}

/** Mean prop position (x, z) of the shelf whose props are within 1.5 tiles of `near`. */
function centroid(fill: ShelfFill, near: { x: number; y: number }): { x: number; z: number } {
  const pts = props(fill)
    .map((s) => s.split(':')[1]!.split(',').map(Number))
    .filter(([x, , z]) => Math.hypot(x! - near.x, z! - near.y) < 1.5);
  expect(pts.length).toBeGreaterThan(0);
  return {
    x: pts.reduce((a, q) => a + q[0]!, 0) / pts.length,
    z: pts.reduce((a, q) => a + q[2]!, 0) / pts.length,
  };
}

describe('shelf fill with furniture footprints', () => {
  it('shelfOrigin: tile centre when off, footprintCenter when on', () => {
    expect(shelfOrigin(5, 7, 1)).toEqual({ x: 5.5, y: 7.5 });
    for (let rot = 0; rot < 4; rot++) {
      expect(shelfOrigin(5, 7, rot, { w: 2, h: 1 })).toEqual(
        footprintCenter(5, 7, rot, { w: 2, h: 1 }),
      );
    }
    expect(shelfOrigin(5, 7, 3, { w: 1, h: 1 })).toEqual({ x: 5.5, y: 7.5 });
  });

  it('flag off lays the props out exactly as before (FOOTPRINTS_OFF is a no-op)', () => {
    const a = new ShelfFill(source, RANGE);
    a.update(storages, undefined);
    const b = new ShelfFill(source, RANGE);
    b.setFootprints(FOOTPRINTS_OFF);
    b.update(storages, undefined);
    expect(props(b)).toEqual(props(a));
    // Props of every shelf centre on its anchor tile centre.
    for (const o of OBJECTS) {
      const t = tile(o);
      expect(props(a).length).toBeGreaterThan(0);
      const c = centroid(a, { x: t.tx + 0.5, y: t.ty + 0.5 });
      expect(Math.hypot(c.x - (t.tx + 0.5), c.z - (t.ty + 0.5))).toBeLessThan(0.35);
    }
  });

  it('flag on moves the 2×1 shelf props onto footprintCenter, 1×1 unchanged; off restores', () => {
    const off = new ShelfFill(source, RANGE);
    off.update(storages, undefined);
    const before = props(off);

    const on = new ShelfFill(source, RANGE);
    on.update(storages, undefined);
    on.setFootprints(footprintsOn(CATALOG));
    on.update(storages, undefined);
    // The 2×1 rack is laid out for its real 1.8 m width with footprints on (10 columns, the
    // model stands 1:1), squeezed into one tile like its model when off (5 columns).
    expect(on.shown).toBe(off.shown + 4 * 5 * 5);
    for (const o of OBJECTS) {
      const t = tile(o);
      const wide = o.contentId === 'base:metal-shelf';
      const fc = footprintCenter(t.tx, t.ty, o.rot, wide ? { w: 2, h: 1 } : { w: 1, h: 1 });
      // Same layout centre (incl. the back-to-wall depth offset), shifted by
      // (footprintCenter − tile centre): compare centroids (slot jitter averages out).
      const cOff = centroid(off, { x: t.tx + 0.5, y: t.ty + 0.5 });
      const cOn = centroid(on, fc);
      const digits = wide ? 1 : 5;
      expect(cOn.x - cOff.x).toBeCloseTo(fc.x - (t.tx + 0.5), digits);
      expect(cOn.z - cOff.z).toBeCloseTo(fc.y - (t.ty + 0.5), digits);
    }
    expect(props(on)).not.toEqual(before);

    on.setFootprints(FOOTPRINTS_OFF);
    on.update(storages, undefined);
    expect(props(on)).toEqual(before);
  });
});
