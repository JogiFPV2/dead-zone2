import { createHash } from 'node:crypto';
import { Box3, BoxGeometry, InstancedMesh, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_TILES, type ChunkData } from './chunk.js';
import {
  FOOTPRINTS_OFF,
  footprintFlag,
  footprintsOn,
  furnitureFootprintsFromFiles,
  isRealScale,
  objectAtTile,
} from './furniture-footprint.js';
import { MapObjects, fitFootprint, fitTileRealScale } from './map-objects.js';

/** One chunk with legacy furniture (models), a sofa / bed / desk (grey boxes) in all rotations. */
const chunk = (): ChunkData => ({
  coord: { cx: 1, cy: 2, z: 0 },
  floor: new Uint16Array(CHUNK_TILES).fill(1),
  objects: [
    { contentId: 'base:dresser', x: 1, y: 1, rot: 0 },
    { contentId: 'base:metal-shelf', x: 4, y: 1, rot: 1 },
    { contentId: 'base:bookshelf', x: 7, y: 1, rot: 2 },
    { contentId: 'base:sofa', x: 2, y: 3, rot: 0 },
    { contentId: 'base:sofa', x: 6, y: 3, rot: 1 },
    { contentId: 'base:bed', x: 10, y: 3, rot: 2 },
    { contentId: 'base:bed', x: 14, y: 3, rot: 3 },
    { contentId: 'base:desk', x: 18, y: 3, rot: 0 },
    { contentId: 'base:bathtub', x: 20, y: 3, rot: 0 },
  ],
});

/** Box model (w × 1 × d) per content id; others none (grey box). */
const MODELS: Record<string, [number, number]> = {
  'base:dresser': [0.9, 0.5],
  'base:metal-shelf': [1.4, 0.45],
  'base:bookshelf': [0.95, 0.35],
  'base:bathtub': [1.7, 0.7],
};
const MAT = new MeshStandardMaterial();
const model = (id: string): Object3D | undefined => {
  const s = MODELS[id];
  if (!s) return undefined;
  const m = new Mesh(new BoxGeometry(s[0], 1, s[1]), MAT);
  m.position.y = 0.5;
  return m;
};

const CATALOG = {
  containers: {
    'base:desk': { footprint: { w: 2, h: 1 } },
    'base:metal-shelf': { footprint: { w: 2, h: 1 } },
  },
  items: {
    'base:sofa': { placeable: { footprint: { w: 2, h: 1 } } },
    'base:bed': { placeable: { footprint: { w: 1, h: 2 } } },
    'base:bathtub': { placeable: { footprint: { w: 2, h: 1 } } },
  },
};

const r = (n: number): string => n.toFixed(6);
/** Everything the scene shows of the furniture: transforms, box sizes, instance matrices. */
function snapshot(m: MapObjects): string {
  void m.instancedMeshCount; // flush the instance rebuild
  const out: string[] = [];
  m.root.updateMatrixWorld(true);
  m.root.traverse((o) => {
    const g = (o as Mesh).geometry as BoxGeometry | undefined;
    const p = g instanceof BoxGeometry ? g.parameters : undefined;
    out.push(
      [
        o.type,
        o.visible,
        ...o.matrixWorld.elements.map(r),
        p ? [p.width, p.height, p.depth].map(r).join(',') : '-',
        o instanceof InstancedMesh ? [...o.instanceMatrix.array].map(r).join(',') : '',
      ].join('|'),
    );
  });
  return out.join('\n');
}
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

function build(setup?: (m: MapObjects) => void, models = true): MapObjects {
  const m = new MapObjects();
  setup?.(m);
  m.loadChunk(chunk());
  if (models) m.applyModels(model);
  return m;
}

/**
 * sha256 of `snapshot` for the chunk above with the flag off. `grey` was recorded on main before
 * footprints (0d7b809) and must stay byte-identical. `models` was re-recorded when the real-scale
 * models were wired (metal-shelf, bathtub: `fitTileRealScale` per axis instead of the uniform
 * one-tile squeeze); legacy models (dresser, bookshelf) are unchanged.
 */
const MAIN_SCENE_HASH = {
  grey: 'c3d642d93cc4e35e5bbc739ceeb2a53f2ccd45e7f8501ac9adc9c5bced017fd0',
  models: 'f917d60213df6253c9447f7b52e6aee33c3948a519d871a89a0a314f3dea456a',
};

describe('MapObjects: footprints off (default)', () => {
  it('draws the scene byte-identical to main', () => {
    expect(hash(snapshot(build(undefined, false)))).toBe(MAIN_SCENE_HASH.grey);
    expect(hash(snapshot(build()))).toBe(MAIN_SCENE_HASH.models);
  });

  it('stays identical with the flag explicitly off or switched on and back off', () => {
    const base = snapshot(build());
    expect(snapshot(build((m) => m.setFootprints(FOOTPRINTS_OFF)))).toBe(base);
    const back = build();
    back.setFootprints(footprintsOn(CATALOG));
    expect(snapshot(back)).not.toBe(base);
    back.setFootprints(FOOTPRINTS_OFF);
    expect(snapshot(back)).toBe(base);
  });

  it('picks only the anchor tile', () => {
    const m = build();
    expect(m.objectAt(32 + 2, 64 + 3, 0)?.contentId).toBe('base:sofa');
    expect(m.objectAt(32 + 3, 64 + 3, 0)).toBeUndefined();
    expect(m.tilesOf({ contentId: 'base:sofa', tx: 34, ty: 67, rot: 0 })).toEqual([
      { x: 34, y: 67 },
    ]);
  });
});

describe('MapObjects: footprints on', () => {
  const on = (): MapObjects => build((m) => m.setFootprints(footprintsOn(CATALOG)));
  /** Grey box of the chunk's object #i (one per object, in chunk order). */
  const meshAt = (m: MapObjects, i: number): Mesh =>
    m.root.children.filter(
      (c): c is Mesh => c instanceof Mesh && !(c instanceof InstancedMesh) && c.castShadow,
    )[i]!;

  it('centres the object on its footprint, rotated per rot (NW anchor)', () => {
    const m = on();
    // Sofa 2×1 rot 0 at (34, 67): tiles 34–35 × 67 → centre (35, 67.5).
    const a = meshAt(m, 3);
    expect([a.position.x, a.position.z]).toEqual([35, 67.5]);
    expect(a.rotation.y).toBeCloseTo(0);
    // Sofa rot 1 at (38, 67): 1×2 → centre (38.5, 68), turned −90°.
    const b = meshAt(m, 4);
    expect([b.position.x, b.position.z]).toEqual([38.5, 68]);
    expect(b.rotation.y).toBeCloseTo(-Math.PI / 2);
    // Bed 1×2 rot 3 at (46, 67): 2×1 → centre (47, 67.5).
    const c = meshAt(m, 6);
    expect([c.position.x, c.position.z]).toEqual([47, 67.5]);
  });

  it('stretches grey boxes (legacy, no model) over w×h', () => {
    const sofa = meshAt(on(), 3);
    const p = (sofa.geometry as BoxGeometry).parameters;
    // DEFAULT_SIZE 0.8 → 1.6 along the wall, 0.8 deep.
    expect([p.width, p.depth]).toEqual([1.6, 0.8]);
  });

  it('picks and highlights every occupied tile', () => {
    const m = on();
    for (const [x, y] of [
      [34, 67],
      [35, 67],
    ])
      expect(m.objectAt(x!, y!, 0)).toMatchObject({ contentId: 'base:sofa', tx: 34, ty: 67 });
    expect(m.objectAt(36, 67, 0)).toBeUndefined();
    // Bed rot 2 at (42, 67): 1×2 → (42, 67) and (42, 68).
    expect(m.objectAt(42, 68, 0)).toMatchObject({ contentId: 'base:bed', tx: 42, ty: 67 });
    expect(m.objectAt(42, 68, 1)).toBeUndefined();
    expect(m.tilesOf({ contentId: 'base:sofa', tx: 38, ty: 67, rot: 1 })).toEqual([
      { x: 38, y: 67 },
      { x: 38, y: 68 },
    ]);
  });

  it('objectAtTile works on plain object lists (furniture UI)', () => {
    const list = [{ contentId: 'base:desk', tx: 5, ty: 5, z: 0, rot: 0 }];
    expect(objectAtTile(list, FOOTPRINTS_OFF, 6, 5, 0)).toBeUndefined();
    expect(objectAtTile(list, footprintsOn(CATALOG), 6, 5, 0)).toBe(list[0]);
  });
});

describe('fitFootprint', () => {
  const size = (o: Object3D): [number, number, number] => {
    o.updateMatrixWorld(true);
    const b = new Box3().setFromObject(o);
    return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((n: number) =>
      Number(n.toFixed(4)),
    ) as [number, number, number];
  };
  const box = (w: number, h: number, d: number): Object3D => new Mesh(new BoxGeometry(w, h, d));

  it('keeps real-scale models 1:1, centred, only shrinking them when larger', () => {
    expect(size(fitFootprint(box(1.7, 0.6, 0.7), { w: 2, h: 1 }, true))).toEqual([1.7, 0.6, 0.7]);
    expect(size(fitFootprint(box(0.84, 2, 0.85), { w: 1, h: 1 }, true))).toEqual([0.84, 2, 0.85]);
    // 1.2 m wide in one tile: uniform shrink to 1 m.
    expect(size(fitFootprint(box(1.2, 0.9, 0.6), { w: 1, h: 1 }, true))).toEqual([1, 0.75, 0.5]);
  });

  it('never re-centres real-scale models (origin = footprint centre, back offset baked in)', () => {
    // Shower 0.84 deep whose panel side sits 0.1 m towards −z (the wall).
    const shower = box(0.84, 2, 0.85);
    shower.position.z = -0.1;
    const fs = fitFootprint(shower, { w: 1, h: 1 }, true);
    fs.updateMatrixWorld(true);
    const b = new Box3().setFromObject(fs);
    expect(((b.min.z + b.max.z) / 2).toFixed(4)).toBe('-0.1000');
    // Shrunk about the origin: the offset scales with it (1.2 → 1: ×5/6).
    const wide = box(1.2, 0.9, 0.6);
    wide.position.z = -0.12;
    const fw = fitFootprint(wide, { w: 1, h: 1 }, true);
    fw.updateMatrixWorld(true);
    const c = new Box3().setFromObject(fw);
    expect(((c.min.z + c.max.z) / 2).toFixed(4)).toBe('-0.1000');
  });

  it('footprints off: real-scale models squeezed per axis about the origin, height kept', () => {
    // Sofa 1.96 × 0.85 × 0.89, back 0.495 towards the wall (−z): only the width shrinks
    // (to 0.96, from the origin both ways), depth ×0.97 so the back stays inside the tile.
    const sofa = box(1.96, 0.85, 0.89);
    sofa.position.z = -0.05;
    const f = fitTileRealScale(sofa);
    f.updateMatrixWorld(true);
    const b = new Box3().setFromObject(f);
    expect((b.max.x - b.min.x).toFixed(3)).toBe('0.960');
    expect((b.max.y - b.min.y).toFixed(3)).toBe('0.850');
    expect(b.min.z).toBeGreaterThanOrEqual(-0.48 - 1e-9);
    expect(((b.min.z + b.max.z) / 2).toFixed(3)).toBe('-0.048');
    // A 2 m bed: one tile long, 0.96 wide kept as is.
    expect(size(fitTileRealScale(box(0.96, 0.75, 1.99)))).toEqual([0.96, 0.75, 0.96]);
  });

  it('keeps the authored height of wall-mounted real-scale models (bathroom cabinet 1.15–1.85 m)', () => {
    // Designer's base:bathroom-cabinet: origin on the floor, mesh 0.6 × 0.7 × 0.21 at 1.15–1.85 m.
    const cabinet = (): Object3D => {
      const m = box(0.6, 0.7, 0.21);
      m.position.set(0, 1.5, 0.03);
      return m;
    };
    const bounds = (o: Object3D): Box3 => {
      o.updateMatrixWorld(true);
      return new Box3().setFromObject(o);
    };
    expect(isRealScale('base:bathroom-cabinet')).toBe(true);
    for (const fit of [
      fitTileRealScale(cabinet()),
      fitFootprint(cabinet(), { w: 1, h: 1 }, true),
      fitFootprint(cabinet(), { w: 2, h: 1 }, true),
    ]) {
      const b = bounds(fit);
      expect(b.min.y).toBeCloseTo(1.15, 6);
      expect(b.max.y).toBeCloseTo(1.85, 6);
    }
  });

  it('gives legacy models the one-tile fit stretched over w×h', () => {
    // Today: 1.4 wide → 0.96; on a 2×1 footprint ×2 along the wall.
    expect(size(fitFootprint(box(1.4, 1.8, 0.45), { w: 2, h: 1 }, false))).toEqual([
      1.92, 1.8, 0.3086,
    ]);
    expect(size(fitFootprint(box(0.5, 1, 0.5), { w: 1, h: 2 }, false))).toEqual([0.5, 1, 1]);
  });
});

describe('furnitureFootprintsFromFiles', () => {
  const files = (flag: unknown) => [
    { path: 'world-settings.json', json: { dayLengthMinutes: 60 } },
    { path: 'world-settings/furniture.json', json: { furniture: { footprint: flag } } },
    { path: 'items/furniture.json', json: [{ id: 'base:sofa', ...CATALOG.items['base:sofa'] }] },
    { path: 'containers/home.json', json: [{ id: 'base:desk', footprint: { w: 2, h: 1 } }] },
  ];

  it('is off unless worldSettings.furniture.footprint is true', () => {
    expect(furnitureFootprintsFromFiles(files(false))).toBe(FOOTPRINTS_OFF);
    expect(furnitureFootprintsFromFiles(files(undefined))).toBe(FOOTPRINTS_OFF);
    expect(furnitureFootprintsFromFiles([])).toBe(FOOTPRINTS_OFF);
    expect(footprintFlag({ furnitureFootprint: true })).toBe(true);
    expect(footprintFlag(null)).toBe(false);
  });

  it('reads sizes from containers and items when on (or forced in dev)', () => {
    for (const f of [
      furnitureFootprintsFromFiles(files(true)),
      furnitureFootprintsFromFiles(files(false), true),
    ]) {
      expect(f.enabled).toBe(true);
      expect(f.of('base:sofa')).toEqual({ w: 2, h: 1 });
      expect(f.of('base:desk')).toEqual({ w: 2, h: 1 });
      expect(f.of('base:fridge')).toEqual({ w: 1, h: 1 });
    }
  });
});
