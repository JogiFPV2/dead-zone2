import { AmbientLight, Color, DirectionalLight, GridHelper, Scene } from 'three';

/** Empty placeholder world: ground grid + basic lighting. Real terrain comes in Etap 1. */
export function createScene(): Scene {
  const scene = new Scene();
  scene.background = new Color('#0b0d10');

  scene.add(new GridHelper(64, 64, '#5a6470', '#2a3038'));
  scene.add(new AmbientLight('#ffffff', 0.4));

  const sun = new DirectionalLight('#fff4e0', 1.2);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  return scene;
}
