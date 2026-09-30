import { expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { yawForStep } from '../camera/rotation.js';
import { cameraSide } from './cutaway.js';
import { Structures } from './structures.js';
import { TEST_BUILDING_ID, TEST_BUILDING_INSIDE } from './test-building.js';
import { TEST_MAP_RANGE, createTestMap } from './test-map.js';

const meshes = (s: Structures): InstancedMesh[] =>
  s.root.children.filter((o): o is InstancedMesh => o instanceof InstancedMesh);
const heights = (mesh: InstancedMesh) =>
  Array.from({ length: mesh.count }, (_, i) => {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    return new Vector3().setFromMatrixScale(m).y;
  });

it('builds wall, window and roof meshes for the test building and cuts it away', () => {
  const s = new Structures(createTestMap());
  s.loadRange(TEST_MAP_RANGE);
  const parts = meshes(s);
  expect(parts.map((m) => m.name)).toEqual([
    'base:wall-plain@0,0,0',
    'base:window-plain@0,0,0',
    'base:roof-flat@0,0,0',
  ]);
  const [walls, , roof] = parts;
  if (!walls || !roof) throw new Error('missing meshes');
  const fullWalls = heights(walls);
  expect(heights(roof).every((h) => h > 0)).toBe(true);

  const tx = Math.floor(TEST_BUILDING_INSIDE.x);
  const ty = Math.floor(TEST_BUILDING_INSIDE.y);
  s.setCutaway({ building: TEST_BUILDING_ID, tx, ty, side: cameraSide(yawForStep(0)) });
  expect(heights(roof).every((h) => h === 0)).toBe(true);
  const cut0 = heights(walls);
  const lowered = cut0.filter((h, i) => h < (fullWalls[i] ?? 0)).length;
  expect(lowered).toBeGreaterThan(0);
  expect(lowered).toBeLessThan(cut0.length);

  s.setCutaway({ building: TEST_BUILDING_ID, tx, ty, side: cameraSide(yawForStep(2)) });
  expect(heights(walls)).not.toEqual(cut0);

  s.setCutaway({ building: 0, tx, ty, side: cameraSide(yawForStep(0)) });
  expect(heights(walls)).toEqual(fullWalls);
  expect(heights(roof).every((h) => h > 0)).toBe(true);
  s.dispose();
});
