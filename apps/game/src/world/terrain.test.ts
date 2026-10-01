import { expect, it } from 'vitest';
import { InstancedMesh } from 'three';
import { Terrain } from './terrain.js';
import { TEST_MAP_RANGE, createTestMap } from './test-map.js';

it('builds one group per chunk and one InstancedMesh per tile type', () => {
  const terrain = new Terrain(createTestMap());
  terrain.loadRange(TEST_MAP_RANGE);
  expect(terrain.root.children).toHaveLength(16);
  let meshes = 0;
  let instances = 0;
  terrain.root.traverse((o) => {
    if (o instanceof InstancedMesh) {
      meshes++;
      instances += o.count;
    }
  });
  // grass, asphalt, concrete lots and sidewalks in every chunk.
  expect(meshes).toBe(16 * 4);
  expect(instances).toBe(128 * 128);
  terrain.dispose();
});
