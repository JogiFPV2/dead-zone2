import { BoxGeometry, Color, Matrix4, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { kitOpeningMatrix, type OpeningEdge } from '../openings.js';
import { TEST_BUILDING, TEST_BUILDING_ID } from '../test-building.js';
import { TEST_MAP_RANGE, createTestMap } from '../test-map.js';
import type { ChunkSource } from '../chunk.js';
import { townDecor } from './decor.js';
import { townCells, type TownKit } from './kit.js';
import { layoutTown } from './layout.js';
import {
  LIT_WINDOW_FRACTION,
  doorLeaf,
  edgeModule,
  edgeVariants,
  roofStyle,
  skinOfWall,
  windowLit,
} from './modules.js';
import { pitchedRoof, ridgeHeight } from './roof.js';
import { buildTerrainGeometry, clipToCell, floorLook } from './terrain-mesh.js';
import { MapTiles } from './tiles.js';
import { LOWER_LEVEL_DIM, TownStructures } from './town-structures.js';
import { shopWindowGeometry } from './levels.js';

const cells = townCells({
  cells: Object.fromEntries(
    [
      'grass',
      'grass-b',
      'grass-c',
      'grass-d',
      'asphalt',
      'sidewalk',
      'curb',
      'paint',
      'stain',
      'dirt',
      'concrete',
      'wood-floor',
      'gutter',
      'roof-a',
      'roof-a-dark',
      'wall-brick',
    ].map((n, i) => [
      n,
      { uv: [((i % 16) + 0.5) / 16, (Math.floor(i / 16) + 0.5) / 16], hex: '#445566' },
    ]),
  ),
});

/** Kit stub: every module is the same small box (only geometry ids matter). */
function stubKit(): TownKit {
  const box = new BoxGeometry(1, 1, 1);
  const geometries = new (class extends Map<string, BufferGeometry> {
    override get(): BufferGeometry {
      return box;
    }
    override has(): boolean {
      return true;
    }
  })();
  return { geometries, material: {} as never, cells, detail: {} as never };
}

describe('town modules', () => {
  it('skins come from the wall content, wall-plain is hashed per building', () => {
    expect(skinOfWall('base:brick-wall', 3)).toBe('brick');
    expect(skinOfWall('base:siding-blue', 3)).toBe('blue');
    expect(skinOfWall('base:plaster-wall', 3)).toBe('plaster');
    expect(['green', 'beige', 'blue']).toContain(skinOfWall('base:wall-plain', 9));
    expect(skinOfWall('base:wall-plain', 9)).toBe(skinOfWall('base:wall-plain', 9));
  });

  it('edge modules: cutaway stub, lit and broken windows, wooden windows on brick', () => {
    expect(edgeModule('wall', 'green', 'base:wall-plain', { lowered: false })).toBe('wall-green');
    expect(edgeModule('window', 'green', 'base:window-plain', { lowered: true })).toBe(
      'stub-green',
    );
    expect(edgeModule('window', 'beige', 'base:window-plain', { lowered: false, lit: true })).toBe(
      'window-beige-lit',
    );
    expect(
      edgeModule('window', 'beige', 'base:window-plain', { lowered: false, broken: true }),
    ).toBe('window-beige-broken');
    expect(edgeModule('window', 'brick', 'base:wooden-window', { lowered: false })).toBe(
      'window-brick-wood',
    );
    expect(edgeModule('door', 'blue', 'base:door-plain', { lowered: false })).toBe('doorway-blue');
    expect(edgeVariants('window', 'green', 'base:window-plain').sort()).toEqual(
      ['stub-green', 'window-green', 'window-green-broken', 'window-green-lit'].sort(),
    );
    expect(doorLeaf('interior')).toBe('door-wood');
    expect(roofStyle('base:roof-gable')).toBe('gable');
    expect(roofStyle('base:roof-shingles')).toBe('hip');
    expect(roofStyle('base:roof-flat')).toBe('flat');
  });

  it('about a third of the windows light up between 19:00 and 20:30, off at 6:00', () => {
    const seeds = Array.from({ length: 2000 }, (_, i) => i * 31 + 7);
    const at = (m: number) => seeds.filter((s) => windowLit(s, m)).length / seeds.length;
    expect(at(12 * 60)).toBe(0);
    expect(at(18 * 60 + 59)).toBe(0);
    expect(at(22 * 60)).toBeGreaterThan(LIT_WINDOW_FRACTION - 0.05);
    expect(at(22 * 60)).toBeLessThan(LIT_WINDOW_FRACTION + 0.05);
    expect(at(19 * 60 + 45)).toBeGreaterThan(0);
    expect(at(19 * 60 + 45)).toBeLessThan(at(22 * 60));
    expect(at(5 * 60)).toBe(at(22 * 60));
    expect(at(6 * 60)).toBe(0);
  });
});

describe('town layout (generated test map)', () => {
  const source = createTestMap();
  const layout = layoutTown(new MapTiles(source, 0), TEST_MAP_RANGE);

  it('reads the building skin, interior walls and its rectangular roof', () => {
    expect(layout.skins.get(TEST_BUILDING_ID)).toBe(
      skinOfWall('base:wall-plain', TEST_BUILDING_ID),
    );
    const inner = layout.edges.filter((e) => e.interior);
    expect(inner.length).toBeGreaterThan(0);
    expect(inner.every((e) => e.skin === 'interior')).toBe(true);
    const outer = layout.edges.filter((e) => !e.interior && e.building === TEST_BUILDING_ID);
    expect(outer.every((e) => e.skin === layout.skins.get(TEST_BUILDING_ID))).toBe(true);
    expect(layout.edges.some((e) => e.kind === 'fence')).toBe(false);
    const roof = layout.roofs.find((r) => r.building === TEST_BUILDING_ID);
    expect(roof?.rect).toBe(true);
    expect(roof?.footprint).toEqual({
      x0: TEST_BUILDING.x0,
      z0: TEST_BUILDING.y0,
      x1: TEST_BUILDING.x1,
      z1: TEST_BUILDING.y1,
    });
  });

  it('structures: one BatchedMesh per chunk, cutaway swaps geometry and hides the roof', () => {
    const s = new TownStructures(source, stubKit());
    s.loadRange(TEST_MAP_RANGE);
    expect(s.stats().batches).toBe(1);
    const mesh = s.root.children[0] as unknown as {
      getGeometryIdAt(i: number): number;
      getVisibleAt(i: number): boolean;
      instanceCount: number;
    };
    const before = Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getGeometryIdAt(i));
    s.setCutaway({ building: TEST_BUILDING_ID, tx: 13, ty: 15, side: { sx: 1, sz: 1 } });
    const after = Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getGeometryIdAt(i));
    expect(after.filter((g, i) => g !== before[i]).length).toBeGreaterThan(5);
    const hidden = Array.from({ length: mesh.instanceCount }, (_, i) =>
      mesh.getVisibleAt(i),
    ).filter((v) => !v);
    expect(hidden.length).toBe(
      (TEST_BUILDING.x1 - TEST_BUILDING.x0 + 1) * (TEST_BUILDING.y1 - TEST_BUILDING.y0 + 1) +
        2 * (10 + 8),
    );
    s.setCutaway({ building: 0, tx: 0, ty: 0, side: { sx: 1, sz: 1 } });
    const back = Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getGeometryIdAt(i));
    expect(back).toEqual(before);
    s.setMinute(22 * 60);
    const night = Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getGeometryIdAt(i));
    s.setMinute(12 * 60);
    expect(Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getGeometryIdAt(i))).toEqual(
      before,
    );
    expect(night.length).toBe(before.length);
  });

  it('dims the building on levels below the player (spec 3.3), restores on leaving', () => {
    const s = new TownStructures(source, stubKit());
    s.loadRange(TEST_MAP_RANGE);
    s.setCutaway({ building: TEST_BUILDING_ID, tx: 13, ty: 15, side: { sx: 1, sz: 1 }, z: 1 });
    expect(s.dimmedBuilding()).toBe(TEST_BUILDING_ID);
    const mesh = s.root.children[0] as unknown as {
      getColorAt(i: number, c: Color): Color;
      instanceCount: number;
    };
    const c = new Color();
    const dim = Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getColorAt(i, c).r);
    expect(dim.filter((r) => Math.abs(r - LOWER_LEVEL_DIM) < 1e-6).length).toBeGreaterThan(10);
    s.setCutaway({ building: 0, tx: 0, ty: 0, side: { sx: 1, sz: 1 } });
    expect(s.dimmedBuilding()).toBe(0);
    const back = Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getColorAt(i, c).r);
    expect(back.every((r) => r === 1)).toBe(true);
  });
});

describe('catalogue skins and shop windows', () => {
  it('maps catalogue walls to skins, shop windows to generated modules', () => {
    expect(skinOfWall('base:wall-gas', 1)).toBe('gas');
    expect(skinOfWall('base:wall-pharmacy', 1)).toBe('pharmacy');
    expect(skinOfWall('base:wall-burnt', 1)).toBe('burnt');
    expect(edgeModule('window', 'shop', 'base:window-shop', { lowered: false })).toBe(
      'shopwin-shop',
    );
    expect(edgeModule('window', 'gas', 'base:window-shop', { lowered: false, lit: true })).toBe(
      'shopwin-gas-lit',
    );
    expect(edgeVariants('window', 'shop', 'base:window-shop').sort()).toEqual([
      'shopwin-shop',
      'shopwin-shop-broken',
      'shopwin-shop-lit',
      'stub-shop',
    ]);
    expect(doorLeaf('pharmacy')).toBe('door-glass');
  });

  it('shop window glass runs 0.3–2.5 m; broken has no glass', () => {
    const c = townCells({ cells: { glass: { uv: [0.1, 0.1], hex: '#000' } } });
    const whole = shopWindowGeometry(c, 'wall', {});
    const broken = shopWindowGeometry(c, 'wall', { broken: true });
    whole.computeBoundingBox();
    expect(whole.boundingBox!.max.y).toBeCloseTo(2.8);
    expect(whole.getAttribute('position').count).toBeGreaterThan(
      broken.getAttribute('position').count,
    );
  });
});

describe('pitched roof', () => {
  it('covers the footprint plus the eave and peaks at the ridge height', () => {
    const f = { x0: 10, z0: -14, x1: 19, z1: -5 };
    const g = pitchedRoof(f, 'hip', 'roof-a', 'wall-brick', cells, 2.8);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.x).toBeCloseTo(10 - 0.35);
    expect(b.max.z).toBeCloseTo(-4 + 0.35);
    expect(b.max.y).toBeCloseTo(2.8 + ridgeHeight(f, 'hip'));
    expect(b.min.y).toBeCloseTo(2.8 - 0.12);
    const gable = pitchedRoof(
      { x0: 0, z0: 0, x1: 7, z1: 5 },
      'gable',
      'roof-a',
      'wall-brick',
      cells,
      2.8,
    );
    expect(gable.getAttribute('position').count).toBeGreaterThan(8);
  });
});

/** 12×12 tiles: an east-west road (rows 4..7), sidewalks rows 2..3 and 8..9, grass elsewhere. */
function roadMap(): ChunkSource {
  const palette = [null, 'base:grass', 'base:asphalt', 'base:sidewalk'] as const;
  return {
    tilePalette: palette,
    edgePalette: [null],
    getChunk(cx, cy, z) {
      if (cx !== 0 || cy !== 0 || z !== 0) return undefined;
      const floor = new Uint16Array(32 * 32);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++)
          floor[y * 32 + x] = y >= 4 && y <= 7 ? 2 : y >= 2 && y <= 9 ? 3 : 1;
      }
      return { coord: { cx, cy, z }, floor };
    },
  };
}

describe('town terrain', () => {
  it('indoor concrete is skinned by room type, outdoor floors keep their detail channel', () => {
    expect(floorLook('base:concrete', 'base:room-living-room').cell).toBe('wood-floor');
    expect(floorLook('base:concrete', 'base:room-garage').cell).toBe('concrete');
    expect(floorLook('base:asphalt', undefined).mask[0]).toBeGreaterThan(0);
    expect(floorLook('base:grass', undefined).mask[1]).toBe(1);
  });

  it('one merged geometry per chunk with curbs and centre dashes', () => {
    const g = buildTerrainGeometry(new MapTiles(roadMap(), 0), 0, 0, cells)!;
    const pos = g.getAttribute('position');
    expect(g.getAttribute('dmask').count).toBe(pos.count);
    expect(g.getAttribute('color').count).toBe(pos.count);
    let curbTop = 0;
    let paint = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - 0.12) < 1e-6) curbTop++;
      if (Math.abs(pos.getY(i) - 0.006) < 1e-6 && Math.abs(pos.getZ(i) - 6) < 0.1) paint++;
    }
    // Two curbs (north and south sidewalk) along 32 tiles; dashes on the centre line z = 6.
    expect(curbTop).toBeGreaterThanOrEqual(2 * 32 * 6);
    expect(paint).toBeGreaterThan(0);
    expect(buildTerrainGeometry(new MapTiles(roadMap(), 0), 1, 0, cells)).toBeUndefined();
  });

  it('areas are smooth polygons clipped to their tiles, not tile steps', () => {
    // Diagonal plaza over grass (z ≥ 10), its corner reaching the sidewalk / road rows.
    const vector = {
      roads: [],
      underAt: () => undefined,
      areas: [
        { surface: 'base:sidewalk' as const, order: 18, rings: [[2.3, 8, 20.7, 12.4, 4.1, 28.9]] },
      ],
    };
    const g = buildTerrainGeometry(new MapTiles(roadMap(), 0), 0, 0, cells, 0, vector)!;
    const pos = g.getAttribute('position');
    let n = 0;
    let offGrid = 0;
    let onRoad = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - (0.001 + 18 * 0.0002)) > 1e-6) continue;
      n++;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(x - Math.round(x)) > 0.05 && Math.abs(z - Math.round(z)) > 0.05) offGrid++;
      if (z < 9.999) onRoad++;
    }
    expect(n).toBeGreaterThan(0);
    // Edges follow the outline (vertices between tile corners), never over the road / sidewalk.
    expect(offGrid).toBeGreaterThan(0);
    expect(onRoad).toBe(0);
  });

  it('parking lots get bay stripes across their long edges, facing up', () => {
    const vector = {
      roads: [],
      underAt: () => undefined,
      areas: [
        { surface: 'base:parking' as const, order: 20, rings: [[2, 12, 28, 14, 27, 24, 1, 22]] },
      ],
    };
    const g = buildTerrainGeometry(new MapTiles(roadMap(), 0), 0, 0, cells, 0, vector)!;
    const pos = g.getAttribute('position');
    const y = 0.012;
    let tris = 0;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      if (Math.abs(pos.getY(i) - y) > 1e-6) continue;
      tris++;
      const ax = pos.getX(i);
      const az = pos.getZ(i);
      const bx = pos.getX(i + 1);
      const bz = pos.getZ(i + 1);
      const cx = pos.getX(i + 2);
      const cz = pos.getZ(i + 2);
      // Up-facing: (b − a) × (c − a) has +y.
      expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0);
    }
    // Two long edges of ~26 m: about 9 stripes each (2 triangles per stripe).
    expect(tris).toBeGreaterThanOrEqual(2 * 2 * 8);
  });

  it('clipToCell clips a triangle to one tile square', () => {
    const p = clipToCell(
      [
        [0, 0],
        [4, 0],
        [0, 4],
      ],
      1,
      1,
    );
    for (const [x, z] of p) {
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(2);
      expect(z).toBeGreaterThanOrEqual(1);
      expect(z).toBeLessThanOrEqual(2);
    }
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(
      clipToCell(
        [
          [0, 0],
          [0.5, 0],
          [0, 0.5],
        ],
        3,
        3,
      ),
    ).toEqual([]);
  });

  it('decor puts lamps on the curb side with the arm over the road', () => {
    const d = townDecor(new MapTiles(roadMap(), 0), { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 });
    expect(d.lamps.length).toBeGreaterThan(0);
    for (const l of d.lamps) {
      const toward = l.z + l.armZ * 0.8;
      expect(toward).toBeGreaterThan(3.5);
      expect(toward).toBeLessThan(8.5);
    }
    expect(townDecor(new MapTiles(roadMap(), 0), { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 })).toEqual(
      d,
    );
  });
});

describe('kit opening pieces', () => {
  const fence: OpeningEdge = { kind: 'fence', tx: 10, ty: 24, z: 0, side: 'n', building: 0 };
  const door: OpeningEdge = { kind: 'door', tx: 13, ty: 19, z: 0, side: 'w', building: 1 };
  const up = (m: Matrix4) => new Vector3(0, 1, 0).transformDirection(m);
  it('a broken fence panel lies flat, a closed one stands 1 tile long', () => {
    const m = kitOpeningMatrix(new Matrix4(), fence, 'closed', 0, false);
    expect(up(m).y).toBeCloseTo(1);
    expect(
      new Vector3(1, 0, 0).applyMatrix4(m).sub(new Vector3().applyMatrix4(m)).length(),
    ).toBeCloseTo(1 / 1.9);
    expect(Math.abs(up(kitOpeningMatrix(new Matrix4(), fence, 'broken', 0, false)).y)).toBeLessThan(
      1e-6,
    );
  });
  it('a door leaf hinges on its edge and swings open by 90°', () => {
    const closed = kitOpeningMatrix(new Matrix4(), door, 'closed', 0, false);
    const open = kitOpeningMatrix(new Matrix4(), door, 'open', 0, false);
    const dir = (m: Matrix4) => new Vector3(1, 0, 0).transformDirection(m);
    expect(Math.abs(dir(closed).dot(dir(open)))).toBeLessThan(1e-6);
    expect(new Vector3().applyMatrix4(closed).x).toBeCloseTo(13);
  });

  it('shelled buildings (realistic style) hide their kit pieces until the cutaway opens them', () => {
    const source = createTestMap();
    const s = new TownStructures(source, stubKit(), { shelled: (b) => b === TEST_BUILDING_ID });
    s.loadRange(TEST_MAP_RANGE);
    const mesh = s.root.children[0] as unknown as {
      getVisibleAt(i: number): boolean;
      instanceCount: number;
    };
    const visible = () =>
      Array.from({ length: mesh.instanceCount }, (_, i) => mesh.getVisibleAt(i)).filter(Boolean)
        .length;
    const plain = new TownStructures(source, stubKit());
    plain.loadRange(TEST_MAP_RANGE);
    const all = (plain.root.children[0] as unknown as { instanceCount: number }).instanceCount;
    const shut = visible();
    expect(shut).toBeLessThan(all);
    // Player inside: the model hides, the kit building shows (cut as usual).
    s.setCutaway({ building: TEST_BUILDING_ID, tx: 13, ty: 15, side: { sx: 1, sz: 1 } });
    expect(visible()).toBeGreaterThan(shut);
    // An occluder opens it too; leaving hides it again.
    s.setCutaway({ building: 0, tx: 0, ty: 0, side: { sx: 1, sz: 1 } });
    expect(visible()).toBe(shut);
    s.setCutaway({
      building: 0,
      tx: 0,
      ty: 0,
      side: { sx: 1, sz: 1 },
      occluders: new Set([TEST_BUILDING_ID]),
    });
    expect(visible()).toBeGreaterThan(shut);
  });
});

describe('unpaved ways', () => {
  const way = (look: 'gravel' | 'trail', r: number) => ({
    roads: [
      { surface: 'base:dirt' as const, r, rs: 0, bridge: false, pts: [2, 20, 30, 20], d0: 0, look },
    ],
    underAt: () => undefined,
  });
  /** Vertex z offsets from the axis (z = 20) of one ribbon layer, rounded to cm. */
  const layer = (look: 'gravel' | 'trail', r: number, y: number) => {
    const g = buildTerrainGeometry(new MapTiles(roadMap(), 0), 0, 0, cells, 0, way(look, r))!;
    const pos = g.getAttribute('position');
    const zs = new Set<number>();
    for (let i = 0; i < pos.count; i++)
      // Ribbon quad corners at the ends of the segment (x = 2 or 30).
      if (Math.abs(pos.getY(i) - y) < 1e-6 && (pos.getX(i) === 2 || pos.getX(i) === 30))
        zs.add(Math.round((pos.getZ(i) - 20) * 100) / 100);
    return [...zs].sort((a, b) => a - b);
  };

  it('a gravel track has two wheel ruts and a grass strip between them', () => {
    // Ruts at ±0.5 r (half width 0.14 r), grass strip ±0.22 r, all on the rut layer.
    const zs = layer('gravel', 1.5, 0.0068);
    for (const z of [-0.96, -0.54, -0.33, 0.33, 0.54, 0.96]) expect(zs).toContain(z);
    // Verge under the bed, wider than the track.
    expect(layer('gravel', 1.5, 0.0056)).toContain(1.75);
  });

  it('a trodden path fades into the grass and has a darker middle', () => {
    // Verge 1.6 r, bare earth r, darker middle 0.45 r.
    expect(layer('trail', 0.75, 0.0056)).toContain(1.2);
    expect(layer('trail', 0.75, 0.006)).toContain(0.75);
    expect(layer('trail', 0.75, 0.0068).length).toBeGreaterThan(0);
  });
});

describe('chunk-local terrain', () => {
  it('local positions are the world positions minus the chunk corner', () => {
    const far: ChunkSource = {
      tilePalette: [null, 'base:grass'],
      edgePalette: [null],
      getChunk(cx, cy, z) {
        if (cx !== 600 || cy !== 700 || z !== 0) return undefined;
        return { coord: { cx, cy, z }, floor: new Uint16Array(32 * 32).fill(1) };
      },
    };
    const world = buildTerrainGeometry(new MapTiles(far, 0), 600, 700, cells)!;
    const local = buildTerrainGeometry(new MapTiles(far, 0), 600, 700, cells, 0, undefined, true)!;
    const w = world.getAttribute('position');
    const l = local.getAttribute('position');
    expect(l.count).toBe(w.count);
    for (let i = 0; i < l.count; i += 97) {
      expect(l.getX(i) + 600 * 32).toBeCloseTo(w.getX(i), 2);
      expect(l.getZ(i) + 700 * 32).toBeCloseTo(w.getZ(i), 2);
      expect(l.getX(i)).toBeGreaterThanOrEqual(0);
      expect(l.getX(i)).toBeLessThanOrEqual(32);
    }
  });
});

describe('decor on unpaved ways', () => {
  it('no grass tufts, rocks or trees on dirt tracks and paths, nor right at their edge', () => {
    // Grass with a 3-tile dirt track along z = 15..17.
    const track: ChunkSource = {
      tilePalette: [null, 'base:grass', 'base:dirt'],
      edgePalette: [null],
      getChunk(cx, cy, z) {
        if (cx !== 0 || cy !== 0 || z !== 0) return undefined;
        const floor = new Uint16Array(32 * 32);
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) floor[y * 32 + x] = y >= 15 && y <= 17 ? 2 : 1;
        return { coord: { cx, cy, z }, floor };
      },
    };
    const d = townDecor(new MapTiles(track, 0), { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 });
    expect(d.props.length).toBeGreaterThan(0);
    for (const p of d.props) expect(p.z < 14 || p.z > 19).toBe(true);
  });
});
