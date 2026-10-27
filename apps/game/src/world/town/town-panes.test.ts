import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TEST_BUILDING_ID } from '../test-building.js';
import { TEST_MAP_RANGE, createTestMap } from '../test-map.js';
import { townCells, type TownKit } from './kit.js';
import { TownStructures } from './town-structures.js';

const GLASS: [number, number] = [0.5 / 16, 0.5 / 16];
const cells = townCells({ cells: { glass: { uv: GLASS, hex: '#000' } } });

/** Quad 0.8 × 1 m at y 1–2 m; uv in the glass cell when `glass`. */
function quad(glass: boolean): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.4, 1, 0, 0.4, 1, 0, 0.4, 2, 0, -0.4, 2, 0]), 3),
  );
  const [u, v] = glass ? GLASS : [0.9, 0.9];
  g.setAttribute('uv', new BufferAttribute(new Float32Array([u, v, u, v, u, v, u, v]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Window modules carry glass; everything else (and `-broken`) does not. */
function glassKit(): TownKit {
  const withGlass = quad(true);
  const plain = quad(false);
  const geometries = new (class extends Map<string, BufferGeometry> {
    override get(n: string): BufferGeometry {
      return /^(window|shopwin)-/.test(n) && !/-(broken|lit)$/.test(n) ? withGlass : plain;
    }
    override has(): boolean {
      return true;
    }
  })();
  return { geometries, material: {} as never, cells, detail: {} as never };
}

describe('TownStructures window panes (bld-spec §4)', () => {
  it('outside windows get glass + a card behind it; +2 objects whatever the count', () => {
    const s = new TownStructures(createTestMap(), glassKit());
    s.loadRange(TEST_MAP_RANGE);
    const p = s.windowPanes();
    expect(p).toBeDefined();
    expect(p!.size).toBeGreaterThan(2);
    expect(p!.root.children).toHaveLength(2);
    // Every card sits inside its building: 0.4 m from the glass plane on the room side.
    const m = new Matrix4();
    for (let i = 0; i < p!.size; i++) {
      p!.card.getMatrixAt(i, m);
      const c = new Vector3().setFromMatrixPosition(m);
      p!.glass.getMatrixAt(i, m);
      const g = new Vector3().setFromMatrixPosition(m);
      expect(c.distanceTo(g)).toBeCloseTo(0.4, 3);
    }
  });

  it('cutaway lowers / hides: no glass or card; near player: card off, glass on', () => {
    const s = new TownStructures(createTestMap(), glassKit());
    s.loadRange(TEST_MAP_RANGE);
    const p = s.windowPanes()!;
    const shown = () => Array.from({ length: p.size }, (_, i) => p.cardShown(i)).filter(Boolean);
    const all = shown().length;
    s.setCutaway({ building: TEST_BUILDING_ID, tx: 13, ty: 15, side: { sx: 1, sz: 1 } });
    expect(shown().length).toBeLessThan(all);
    s.setCutaway({ building: 0, tx: 0, ty: 0, side: { sx: 1, sz: 1 } });
    s.setFade({ px: 13, py: 15, yaw: 0, z: 0 }, 16);
    expect(shown().length).toBeLessThan(all);
    expect(Array.from({ length: p.size }, (_, i) => p.glassShown(i)).every(Boolean)).toBe(true);
  });

  it('night lit windows drop the pane (emissive module); dispose frees it', () => {
    const s = new TownStructures(createTestMap(), glassKit());
    s.loadRange(TEST_MAP_RANGE);
    const p = s.windowPanes()!;
    s.setRoomLit(new Set());
    s.setMinute(23 * 60);
    const glass = Array.from({ length: p.size }, (_, i) => p.glassShown(i));
    expect(glass.some((g) => !g)).toBe(true);
    s.dispose();
    expect(s.windowPanes()).toBeUndefined();
  });
});
