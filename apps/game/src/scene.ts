import { GridHelper, Scene, type Material } from 'three';

/**
 * Placeholder world: faint tile grid overlay. Lights, fog and background come from the
 * lighting module (`lighting/index.ts`); terrain and structures are added separately.
 */
export function createScene(): Scene {
  const scene = new Scene();

  // Grid lines sit on tile borders (1 tile = 1 unit), slightly above the floor to avoid z-fighting.
  // Unlit lines, so kept faint to not glow in the night scene.
  const grid = new GridHelper(128, 128, '#5a6470', '#2a3038');
  grid.position.y = 0.01;
  const material = grid.material as Material;
  material.transparent = true;
  material.opacity = 0.18;
  material.depthWrite = false;
  scene.add(grid);

  return scene;
}
