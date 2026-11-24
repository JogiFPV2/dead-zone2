import { Color, Matrix4, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DOOR_GLOW_FAR,
  DOOR_GLOW_PEAK,
  doorGlowStrength,
  kitOpeningMatrix,
  sashModel,
  windowWithoutGlass,
  type OpeningEdge,
} from '../openings.js';
import {
  LEAF,
  LEAF_LOOKS,
  SASH,
  SASH_SHOP,
  addDoorAndSashModels,
  doorLeafGeometry,
  glassBounds,
  windowSashGeometry,
} from './door-models.js';
import type { TownCells } from './kit.js';

/** Each palette cell at its own uv (cell centre on a 16 × 16 grid). */
const names = [
  'door-wood',
  'door-wood-dark',
  'door-red',
  'door-red-dark',
  'door-green',
  'door-green-dark',
  'frame-dark',
  'metal',
  'glass',
  'trim-light',
];
const cells: TownCells = {
  uv: (n) => {
    const i = Math.max(0, names.indexOf(n));
    return [(i + 0.5) / 16, 0.5 / 16];
  },
  color: () => new Color(),
};
const cellOf = (u: number) => names[Math.floor(u * 16)];

function cellsIn(g: ReturnType<typeof doorLeafGeometry>): Set<string | undefined> {
  const uv = g.getAttribute('uv');
  const out = new Set<string | undefined>();
  for (let i = 0; i < uv.count; i++) out.add(cellOf(uv.getX(i)));
  return out;
}

describe('door leaves (Paweł 24.11: drzwi wyglądają jak drzwi)', () => {
  it('every look stays in the leaf frame (hinge at 0, along +x, on the wall line)', () => {
    for (const look of LEAF_LOOKS) {
      const g = doorLeafGeometry(cells, look);
      const bb = g.boundingBox!;
      expect(bb.min.x).toBeGreaterThan(-0.03);
      expect(bb.max.x).toBeLessThanOrEqual(LEAF.width + 1e-6);
      expect(bb.min.y).toBeGreaterThanOrEqual(0);
      expect(bb.max.y).toBeCloseTo(LEAF.height, 3);
      // Handles stick out on both faces, nothing past 10 cm.
      expect(bb.max.z).toBeLessThan(0.1);
      expect(bb.min.z).toBeGreaterThan(-0.1);
    }
  });

  it('has the parts of a door: leaf colour, handle / hinges, glass', () => {
    const wood = cellsIn(doorLeafGeometry(cells, 'door-wood'));
    expect(wood).toContain('door-wood');
    expect(wood).toContain('door-wood-dark');
    expect(wood).toContain('frame-dark');
    expect(wood).toContain('glass');
    const shop = cellsIn(doorLeafGeometry(cells, 'door-glass'));
    expect(shop).toContain('glass');
    expect(shop).toContain('metal');
    // Many boxes, not one slab (the GLB leaves had ~170 vertices of flat boxes).
    expect(doorLeafGeometry(cells, 'door-red').getAttribute('position').count).toBeGreaterThan(200);
  });

  it('the glazed row is not covered by the panel slab', () => {
    const g = doorLeafGeometry(cells, 'door-wood');
    const b = glassBounds(g, cells.uv('glass'));
    expect(b).toBeDefined();
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    // No panel (dark) vertex spans the glass height in the middle of the leaf.
    for (let i = 0; i < pos.count; i++) {
      if (cellOf(uv.getX(i)) !== 'door-wood-dark') continue;
      const y = pos.getY(i);
      expect(y > b!.y0 + 0.01 && y < b!.y1 - 0.01).toBe(false);
    }
  });

  it('adds sashes sized to the window glass and replaces the GLB leaves', () => {
    const geos = new Map<string, BufferGeometry>();
    geos.set('window-plaster', windowSashGeometry(cells, 0.8, 1, 2.4));
    addDoorAndSashModels(geos, cells);
    for (const look of LEAF_LOOKS) expect(geos.has(look)).toBe(true);
    const sash = geos.get(SASH)!;
    sash.computeBoundingBox();
    expect(sash.boundingBox!.max.x).toBeGreaterThan(0.8);
    expect(geos.has(SASH_SHOP)).toBe(true);
  });
});

describe('opening windows and door glow', () => {
  const win: OpeningEdge = { kind: 'window', tx: 4, ty: 7, z: 1, side: 'n', building: 3 };
  const door: OpeningEdge = { kind: 'door', tx: 4, ty: 7, z: 0, side: 'w', building: 3 };
  const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);

  it('a window sash shows only while open, swung into the building', () => {
    const m = new Matrix4();
    expect(kitOpeningMatrix(m, win, 'closed', 0, false).determinant()).toBe(0);
    expect(kitOpeningMatrix(m, win, 'broken', 0, false).determinant()).toBe(0);
    expect(kitOpeningMatrix(m, win, 'open', 0, true).determinant()).toBe(0);
    // Inside on +z (south of a north edge): the free end of the sash goes to +z.
    const inside = kitOpeningMatrix(new Matrix4(), win, 'open', 0, false, {
      inside: 1,
      sashWidth: 0.9,
    });
    const end = new Vector3(0.9, 0, 0).applyMatrix4(inside);
    expect(end.z).toBeGreaterThan(win.ty + 0.5);
    const out = kitOpeningMatrix(new Matrix4(), win, 'open', 0, false, {
      inside: -1,
      sashWidth: 0.9,
    });
    expect(new Vector3(0.9, 0, 0).applyMatrix4(out).z).toBeLessThan(win.ty - 0.5);
    // Upper storey: at its floor height.
    expect(pos(inside).y).toBeCloseTo(3, 0);
  });

  it('a door on a slanted outline sits in the gap, turned along the wall', () => {
    const place = { x: 10.2, z: 20.7, rotY: 0.4, width: 1.2 };
    const m = kitOpeningMatrix(new Matrix4(), door, 'closed', 0, false, { place });
    const hinge = pos(m);
    const free = new Vector3(LEAF.width, 0, 0).applyMatrix4(m);
    const mid = hinge.clone().add(free).multiplyScalar(0.5);
    expect(mid.x).toBeCloseTo(place.x, 5);
    expect(mid.z).toBeCloseTo(place.z, 5);
    // Along local +x of the module: (cos r, -sin r).
    const dir = free.clone().sub(hinge).normalize();
    expect(dir.x).toBeCloseTo(Math.cos(place.rotY), 5);
    expect(dir.z).toBeCloseTo(-Math.sin(place.rotY), 5);
  });

  it('open or smashed windows lose the glass of their wall module', () => {
    expect(windowWithoutGlass('open')).toBe(true);
    expect(windowWithoutGlass('broken')).toBe(true);
    expect(windowWithoutGlass('closed')).toBe(false);
    expect(sashModel('shop')).toBe(SASH_SHOP);
    expect(sashModel('window')).toBe(SASH);
    expect(sashModel(undefined)).toBeUndefined();
  });

  it('door glow: faint, on the viewer level only, gone far away', () => {
    const near = doorGlowStrength(door, { x: 5, y: 8, z: 0 });
    expect(near).toBeCloseTo(DOOR_GLOW_PEAK, 5);
    expect(near).toBeLessThan(0.3);
    expect(doorGlowStrength(door, { x: 5, y: 8, z: 1 })).toBe(0);
    expect(doorGlowStrength(door, { x: 4 + DOOR_GLOW_FAR + 1, y: 7.5, z: 0 })).toBe(0);
    const mid = doorGlowStrength(door, { x: 4 + 22, y: 7.5, z: 0 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(near);
  });
});
