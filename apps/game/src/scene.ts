import { AmbientLight, Color, DirectionalLight, GridHelper, Scene } from 'three';

/** Placeholder world: tile grid overlay + basic lighting. Terrain is added separately. */
export function createScene(): Scene {
  const scene = new Scene();
  scene.background = new Color('#0b0d10');

  // Grid lines sit on tile borders (1 tile = 1 unit), slightly above the floor to avoid z-fighting.
  const grid = new GridHelper(128, 128, '#5a6470', '#2a3038');
  grid.position.y = 0.01;
  scene.add(grid);
  scene.add(new AmbientLight('#ffffff', 0.4));

  const sun = new DirectionalLight('#fff4e0', 1.2);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  return scene;
}
