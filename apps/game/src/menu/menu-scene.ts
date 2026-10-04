import { OrthographicCamera, Scene, Vector3, WebGLRenderer, type Object3D } from 'three';
import { CAMERA_DISTANCE, isometricOffset } from '../camera/isometric.js';
import { createWorldLighting, type LampDef } from '../lighting/index.js';
import { CharacterRig } from '../models/character-rig.js';
import { ModelKit, ZOMBIE_MODELS } from '../models/model-kit.js';
import { tintZombie } from '../models/zombie-views.js';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { simToWorld } from '../sim/coords.js';
import type { ChunkRange } from '../world/chunk.js';
import { Structures } from '../world/structures.js';
import { Terrain } from '../world/terrain.js';
import { GraphicsStylePass } from '../render/graphics-style.js';
import { addHulls } from '../render/style-materials.js';
import type { GraphicsStyle } from '../settings/schema.js';
import { MenuDayCycle, menuClock, parseMenuCycleQuery } from './menu-day-cycle.js';
import { menuCameraFrustum, menuDrift, shambleStep, type Shambler } from './menu-scene-model.js';

/** Menu background (spec deadzone-menu-spec §1): test-town crossroads in a 55 s day loop, no player/HUD. */
const MAP = 'test-town';
/** Crossroads of the town grid (sim tiles): roads x 0..3 and y 0..3, houses at 10..21. */
const FOCUS = { x: 2, y: 2 };
const RANGE: ChunkRange = { cx0: -1, cy0: -1, cx1: 0, cy1: 0, z: 0 };
const VIEW_HEIGHT = 22;
const LAMPS: LampDef[] = [
  { x: -0.6, z: 5.5, armX: 1, armZ: 0, working: true },
  { x: 4.6, z: -1.5, armX: -1, armZ: 0, working: true },
  { x: 5.5, z: 4.6, armX: 0, armZ: -1, working: true },
  { x: -1.5, z: -0.6, armX: 0, armZ: 1, working: false },
  { x: 4.6, z: 12, armX: -1, armZ: 0, working: true },
  { x: 12, z: -0.6, armX: 0, armZ: 1, working: true },
];
/** Scripted zombies relative to the crossroads (sim units): x, y, heading, model, phase 0..1. */
const ZOMBIES: readonly (readonly [number, number, number, number, number])[] = [
  [3.0, 1.4, -1.9, 0, 0.2],
  [5.0, -1.6, -2.3, 1, 0.7],
  [-1.4, 5.2, 2.6, 0, 0.1],
  [7.4, 1.8, -1.6, 1, 0.45],
  [1.6, 8.0, 3.0, 0, 0.9],
  [9.8, -0.8, -1.7, 1, 0.3],
];

export interface MenuScene {
  /** Blurs the scene for sub-screens (CSS filter on the canvas). */
  setDimmed(dim: boolean): void;
  readonly renderer: WebGLRenderer;
  dispose(): void;
}

/** Clip playback speed of the shambling menu zombies. */
const SHAMBLE_SPEED = 0.55;

interface ZombieActor extends Shambler {
  rig: CharacterRig;
  clipTime: number;
  object: Object3D;
}

export async function createMenuScene(
  container: HTMLElement,
  style: () => GraphicsStyle = () => 'classic',
): Promise<MenuScene> {
  const renderer = new WebGLRenderer({ antialias: true });
  // „Styl grafiki” previewed live behind the settings screen.
  const stylePass = new GraphicsStylePass(renderer);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.className = 'dzm-canvas';
  container.prepend(renderer.domElement);

  const scene = new Scene();
  const { loadBaseMap } = await import('../world/load-content-map.js');
  const world = await loadBaseMap(MAP);
  const terrain = new Terrain(world.source);
  terrain.loadRange(RANGE);
  scene.add(terrain.root);
  const structures = new Structures(world.source);
  structures.loadRange(RANGE);
  scene.add(structures.root);

  // One shadowed lamp keeps the menu under the 250 draw-call budget (each shadow = a pass).
  const lighting = createWorldLighting(scene, renderer, LAMPS, CAMERA_DISTANCE, undefined, {
    shadowedLights: 1,
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 55 s day loop (menu-day-cycle.ts); `?menuTime=0..55` pins it for screenshots.
  const cycle = new MenuDayCycle();
  const clock = menuClock({
    ...parseMenuCycleQuery(location.search),
    reducedMotion: () => reducedMotion.matches,
  });
  cycle.apply(lighting, clock(0));

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 4);
  const focus = simToWorld(FOCUS.x, FOCUS.y, 0);
  const target = new Vector3();
  const offset = isometricOffset(CAMERA_DISTANCE);

  const zombies: ZombieActor[] = [];
  let disposed = false;
  void ModelKit.create(renderer).then(async (kit) => {
    if (!kit || disposed) return;
    for (const [dx, dy, heading, model, phase] of ZOMBIES) {
      try {
        const t = await kit.character(ZOMBIE_MODELS[model] ?? ZOMBIE_MODELS[0]!, PLAYER_HEIGHT);
        if (disposed) return;
        tintZombie(t.object);
        addHulls(t.object);
        const rig = new CharacterRig(t.object, t.clips);
        scene.add(t.object);
        zombies.push({
          rig,
          clipTime: phase * 3,
          object: t.object,
          x: FOCUS.x + dx,
          y: FOCUS.y + dy,
          heading,
          phase,
          timer: phase * 6,
          walking: phase > 0.4,
        });
      } catch (e) {
        console.warn('menu zombie', e);
      }
    }
  });

  function resize(): void {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    Object.assign(camera, menuCameraFrustum(w / Math.max(h, 1), VIEW_HEIGHT));
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let last: number | undefined;
  renderer.setAnimationLoop((time) => {
    const dt = last === undefined ? 0 : Math.min(0.1, (time - last) / 1000);
    last = time;
    const d = reducedMotion.matches ? { x: 0, z: 0 } : menuDrift(time / 1000);
    target.set(focus.x + d.x, focus.y, focus.z + d.z);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const z of zombies) {
      const moving = shambleStep(z, dt);
      z.clipTime += dt * SHAMBLE_SPEED;
      z.rig.pose(moving ? 'walk' : 'idle', z.clipTime, true);
      z.rig.update(dt);
      const p = simToWorld(z.x, z.y, 0);
      z.object.position.set(p.x, p.y, p.z);
      // Quaternius models walk along +Z.
      z.object.rotation.y = Math.atan2(Math.cos(z.heading), Math.sin(z.heading));
    }
    cycle.apply(lighting, clock(time));
    lighting.update(camera, target.x, target.z);
    stylePass.setStyle(style());
    stylePass.render(scene, camera);
    if (import.meta.env.DEV) {
      (globalThis as { dzMenuDrawCalls?: number }).dzMenuDrawCalls = renderer.info.render.calls;
    }
  });

  return {
    renderer,
    setDimmed(dim) {
      renderer.domElement.classList.toggle('dzm-canvas--dim', dim);
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      stylePass.dispose();
      scene.traverse((o) => {
        const m = o as Partial<{ geometry: { dispose(): void } }>;
        m.geometry?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
