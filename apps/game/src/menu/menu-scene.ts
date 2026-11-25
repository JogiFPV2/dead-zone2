import { OrthographicCamera, Scene, Vector3, WebGLRenderer, type Object3D } from 'three';
import { CAMERA_DISTANCE, isometricOffset } from '../camera/isometric.js';
import { createWorldLighting, type LampDef } from '../lighting/index.js';
import { CharacterRig } from '../models/character-rig.js';
import { ModelKit, PLAYER_MODEL, ZOMBIE_MODELS } from '../models/model-kit.js';
import { rebuildCharacter, SURVIVOR, ZOMBIE_BODIES } from '../models/painted-body/body.js';
import { tintZombie } from '../models/zombie-views.js';

/** Preview of the new painted bodies (`?body=painted`, Paweł 24.11, before they become default). */
const NEW_BODIES =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('body') === 'painted';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { simToWorld } from '../sim/coords.js';
import type { ChunkRange } from '../world/chunk.js';
import { osmScene, type OsmScene } from '../world/osm/scenes.js';
import { Structures } from '../world/structures.js';
import { Terrain } from '../world/terrain.js';
import { GraphicsStylePass } from '../render/graphics-style.js';
import { addHulls } from '../render/style-materials.js';
import type { GraphicsStyle } from '../settings/schema.js';
import { MENU_CYCLE, MenuDayCycle, menuClock, parseMenuCycleQuery } from './menu-day-cycle.js';
import { menuCameraFrustum, menuDrift, shambleStep, type Shambler } from './menu-scene-model.js';
import { createMenuTown, menuRange, menuWindowMinute, type MenuTown } from './menu-town.js';

/**
 * Menu background (spec deadzone-menu-spec §1) in the 55 s day loop (menu-day-cycle.ts).
 * Default: the OSM scene of Stalowa Wola (KEN viaduct by ul. Okulickiego) drawn with the game's
 * town kit, the player standing at the scene start and the scene's zombies shambling around.
 * `?menuScene=test-town` (or a failed kit / map load) keeps the old grey-box crossroads.
 */
export const MENU_SCENE_DEFAULT = 'osm-okulickiego';
/** Widest screen the drawn chunk window covers (21:9); narrower screens see less of it. */
const OSM_MAX_ASPECT = 21 / 9;
/**
 * Menu staging per OSM scene (sim tiles), Designer: the player and 3–4 zombies in the bright
 * right-middle of the screen, under the street lamps at the corner of ul. KEN and Okulickiego
 * (lamps at 179.5,198.5 and 180.5,201.5); the viaduct may leave the frame. `focus` is the camera
 * target (66 % / 52 % of the screen), `zombies` replace the first scene zombies (the rest keep
 * their scene spots). Undefined = scene focus / start / zombies as they are.
 */
interface MenuStaging {
  focus: { x: number; y: number };
  player: { x: number; y: number; heading: number };
  zombies: readonly { x: number; y: number; heading: number }[];
}
/** Heading (sim radians) from a point towards another. */
const towards = (x: number, y: number, tx: number, ty: number) => Math.atan2(ty - y, tx - x);
const PLAYER_SPOT = { x: 180.5, y: 200.2 };
const MENU_STAGING: Readonly<Record<string, MenuStaging>> = {
  'osm-okulickiego': {
    focus: { x: 179.5, y: 199.9 },
    // Turned 3/4 to the camera (the camera looks from +x +y).
    player: { ...PLAYER_SPOT, heading: Math.PI / 4 + 0.5 },
    zombies: [
      [183.0, 202.2],
      [183.6, 199.0],
      [178.0, 203.4],
      [181.8, 197.2],
    ].map(([x, y]) => ({ x: x!, y: y!, heading: towards(x!, y!, PLAYER_SPOT.x, PLAYER_SPOT.y) })),
  },
};

/** Grey-box fallback: test-town crossroads (sim tiles), roads x 0..3 and y 0..3. */
const TOWN_MAP = 'test-town';
const TOWN_FOCUS = { x: 2, y: 2 };
const TOWN_RANGE: ChunkRange = { cx0: -1, cy0: -1, cx1: 0, cy1: 0, z: 0 };
const VIEW_HEIGHT = 22;
/** OSM scenes: frame of the player and the zombies under the street lamps. */
const OSM_VIEW_HEIGHT = 26;
const TOWN_LAMPS: LampDef[] = [
  { x: -0.6, z: 5.5, armX: 1, armZ: 0, working: true },
  { x: 4.6, z: -1.5, armX: -1, armZ: 0, working: true },
  { x: 5.5, z: 4.6, armX: 0, armZ: -1, working: true },
  { x: -1.5, z: -0.6, armX: 0, armZ: 1, working: false },
  { x: 4.6, z: 12, armX: -1, armZ: 0, working: true },
  { x: 12, z: -0.6, armX: 0, armZ: 1, working: true },
];
/** Scripted zombies relative to the crossroads (sim units): x, y, heading, model, phase 0..1. */
const TOWN_ZOMBIES: readonly (readonly [number, number, number, number, number])[] = [
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

interface Actor extends Shambler {
  rig: CharacterRig;
  clipTime: number;
  object: Object3D;
  /** The player: stands (idle) and never walks. */
  still?: boolean;
}

/** `?menuScene=<id>`: an OSM scene id or `test-town`; default the Stalowa Wola scene. */
export function menuSceneId(search: string): string {
  return new URLSearchParams(search).get('menuScene') ?? MENU_SCENE_DEFAULT;
}

/** Scene zombies as shamblers (absolute sim tiles; model and phase spread by index). */
/**
 * Camera target of an OSM scene: hand-framed (`MENU_STAGING`), else halfway between the scene
 * focus (the landmark, e.g. the viaduct) and the player start.
 */
export function menuFocus(scene: OsmScene): { x: number; y: number } {
  return (
    MENU_STAGING[scene.map]?.focus ?? {
      x: (scene.focus.x + scene.player.x) / 2,
      y: (scene.focus.y + scene.player.y) / 2,
    }
  );
}

export function osmShamblers(
  scene: OsmScene,
): (readonly [number, number, number, number, number])[] {
  const staged = MENU_STAGING[scene.map]?.zombies ?? [];
  return scene.zombies.map((s, i) => {
    const z = staged[i] ?? s;
    return [z.x, z.y, z.heading, i % 2, (i * 0.37) % 1] as const;
  });
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
  const osm = osmScene(menuSceneId(location.search));
  let town: MenuTown | undefined;
  if (osm) {
    try {
      const world = await loadBaseMap(osm.map);
      town = await createMenuTown(
        world.source,
        osm,
        menuRange(menuFocus(osm), menuCameraFrustum(OSM_MAX_ASPECT, OSM_VIEW_HEIGHT)),
      );
      scene.add(town.root);
    } catch (e) {
      console.warn('Menu: scena OSM niedostępna, zostaje test-town', e);
    }
  }
  const scripted = town && osm ? osmShamblers(osm) : undefined;
  const focusTile = town && osm ? menuFocus(osm) : TOWN_FOCUS;
  const viewHeight = town ? OSM_VIEW_HEIGHT : VIEW_HEIGHT;
  if (!town) {
    const world = await loadBaseMap(TOWN_MAP);
    const terrain = new Terrain(world.source);
    terrain.loadRange(TOWN_RANGE);
    const structures = new Structures(world.source);
    structures.loadRange(TOWN_RANGE);
    scene.add(terrain.root, structures.root);
  }
  // ODbL: the attribution stays visible over an OSM background (small, bottom right, under the
  // music chips).
  const attribution = town && osm ? document.createElement('div') : undefined;
  if (attribution && osm) {
    attribution.className = 'dzm-attribution';
    attribution.textContent = osm.attribution;
    container.appendChild(attribution);
  }

  // One shadowed lamp keeps the menu inside the draw-call budget (each shadow = a pass).
  const lighting = createWorldLighting(
    scene,
    renderer,
    town?.lamps ?? TOWN_LAMPS,
    CAMERA_DISTANCE,
    undefined,
    { shadowedLights: 1 },
  );
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 55 s day loop (menu-day-cycle.ts); `?menuTime=0..55` pins it for screenshots.
  const cycle = new MenuDayCycle();
  const clock = menuClock({
    ...parseMenuCycleQuery(location.search),
    reducedMotion: () => reducedMotion.matches,
  });
  /** Lamps fade in during the sunset half of the loop, out at sunrise. */
  const mid = (MENU_CYCLE.lamps.onTo + MENU_CYCLE.lamps.offFrom) / 2;
  const applyCycle = (t: number) => {
    const level = cycle.lampLevel(t);
    cycle.apply(lighting, t);
    town?.setNight(level, menuWindowMinute(level, t < mid));
  };
  applyCycle(clock(0));

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 4);
  const focus = simToWorld(focusTile.x, focusTile.y, 0);
  const target = new Vector3();
  const offset = isometricOffset(CAMERA_DISTANCE);

  const actors: Actor[] = [];
  let disposed = false;
  void ModelKit.create(renderer).then(async (kit) => {
    if (!kit || disposed) return;
    if (town && osm) {
      try {
        const p = await kit.character(PLAYER_MODEL, PLAYER_HEIGHT);
        if (disposed) return;
        if (NEW_BODIES) rebuildCharacter(p.object, SURVIVOR);
        addHulls(p.object);
        scene.add(p.object);
        const { x, y, heading } = MENU_STAGING[osm.map]?.player ?? osm.player;
        actors.push({
          rig: new CharacterRig(p.object, p.clips),
          clipTime: 0,
          object: p.object,
          x,
          y,
          heading,
          phase: 0,
          timer: 0,
          walking: false,
          still: true,
        });
      } catch (e) {
        console.warn('menu player', e);
      }
    }
    const list =
      scripted ??
      TOWN_ZOMBIES.map(
        ([dx, dy, h, m, ph]) => [TOWN_FOCUS.x + dx, TOWN_FOCUS.y + dy, h, m, ph] as const,
      );
    for (const [x, y, heading, model, phase] of list) {
      try {
        const t = await kit.character(ZOMBIE_MODELS[model] ?? ZOMBIE_MODELS[0]!, PLAYER_HEIGHT);
        if (disposed) return;
        if (NEW_BODIES)
          rebuildCharacter(t.object, ZOMBIE_BODIES[actors.length % ZOMBIE_BODIES.length]!);
        else tintZombie(t.object);
        addHulls(t.object);
        scene.add(t.object);
        actors.push({
          rig: new CharacterRig(t.object, t.clips),
          clipTime: phase * 3,
          object: t.object,
          x,
          y,
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
    Object.assign(camera, menuCameraFrustum(w / Math.max(h, 1), viewHeight));
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // Count every pass of a frame (style post-process, shadow maps), not only the last render().
  renderer.info.autoReset = false;
  let last: number | undefined;
  let frames = 0;
  let fpsFrom = 0;
  renderer.setAnimationLoop((time) => {
    const dt = last === undefined ? 0 : Math.min(0.1, (time - last) / 1000);
    last = time;
    renderer.info.reset();
    const d = reducedMotion.matches ? { x: 0, z: 0 } : menuDrift(time / 1000);
    target.set(focus.x + d.x, focus.y, focus.z + d.z);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const a of actors) {
      const moving = a.still ? false : shambleStep(a, dt);
      a.clipTime += dt * (a.still ? 1 : SHAMBLE_SPEED);
      a.rig.pose(moving ? 'walk' : 'idle', a.clipTime, true);
      a.rig.update(dt);
      const p = simToWorld(a.x, a.y, 0);
      a.object.position.set(p.x, p.y, p.z);
      // Quaternius models walk along +Z.
      a.object.rotation.y = Math.atan2(Math.cos(a.heading), Math.sin(a.heading));
    }
    applyCycle(clock(time));
    lighting.update(camera, target.x, target.z);
    stylePass.setStyle(style());
    stylePass.render(scene, camera);
    // Draw calls / fps of the menu (perf checks in swiftshader; cheap, always on).
    frames++;
    if (time - fpsFrom >= 1000) {
      Object.assign(globalThis, {
        dzMenuFps: (frames * 1000) / (time - fpsFrom),
        dzMenuDrawCalls: renderer.info.render.calls,
        dzMenuActors: actors.length,
      });
      frames = 0;
      fpsFrom = time;
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
      town?.dispose();
      scene.traverse((o) => {
        const m = o as Partial<{ geometry: { dispose(): void } }>;
        m.geometry?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      attribution?.remove();
    },
  };
}
