import { Group, Mesh, MeshStandardMaterial, SpotLight, type Object3D } from 'three';
import type { SnapshotVehicle } from '@deadzone/protocol';
import type { LampDef } from '../lighting/street-lamps.js';
import type { ChunkRange, ChunkSource } from '../world/chunk.js';
import { OpeningsView } from '../world/openings.js';
import { withSceneVehicles, type OsmScene } from '../world/osm/scenes.js';
import { VehicleView } from '../vehicles/vehicle-view.js';
import type { HudVehicleType } from '../hud/content-index.js';

/**
 * The menu background drawn with the game's own town kit (same terrain, buildings, upper floors,
 * doors / windows / fences, lamps, trees and parked cars as in play), limited to a chunk window
 * around the scene focus. Static: no sim, no streaming, no floating origin (the window is small).
 */
export interface MenuTown {
  readonly root: Group;
  /** Street lamps of the window (decor), for `createWorldLighting`. */
  readonly lamps: LampDef[];
  /**
   * Night look of the town: lit windows (minute of day), window emission and the menu-only
   * ground lift, all × `level` 0..1 (the cycle's lamp level).
   */
  setNight(level: number, minute: number): void;
  dispose(): void;
}

/** Ortho frustum bounds around the camera target (world units on screen). */
export interface ViewBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Chunks the isometric menu camera can see: the frustum corners projected onto the ground
 * (screen right = (x − z)/√2, screen down = (x + z)·sin(35.26°)/√2 for the classic iso yaw/pitch),
 * plus `margin` tiles for the camera drift, tall buildings and shadows reaching into the frame.
 */
export function menuRange(
  focus: { x: number; y: number },
  view: ViewBounds,
  margin = 8,
  chunk = 32,
): ChunkRange {
  const k = Math.SQRT1_2;
  const down = Math.sin(Math.atan(Math.SQRT1_2)) * k;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const sx of [view.left, view.right]) {
    for (const sy of [-view.top, -view.bottom]) {
      // Invert sx = (dx − dz)·k, sy = (dx + dz)·down.
      const a = sx / k;
      const b = sy / down;
      const dx = (a + b) / 2;
      const dz = (b - a) / 2;
      x0 = Math.min(x0, dx);
      x1 = Math.max(x1, dx);
      y0 = Math.min(y0, dz);
      y1 = Math.max(y1, dz);
    }
  }
  return {
    cx0: Math.floor((focus.x + x0 - margin) / chunk),
    cy0: Math.floor((focus.y + y0 - margin) / chunk),
    cx1: Math.floor((focus.x + x1 + margin) / chunk),
    cy1: Math.floor((focus.y + y1 + margin) / chunk),
    z: 0,
  };
}

/**
 * Pseudo minute of day for the town's lit windows (`windowLit`: on from 19:00–20:30, off at
 * 06:00), from the menu cycle's lamp level: windows light up one by one while the lamps fade in
 * and stay lit until the lamps start to fade out. `rising` = lamps fading in (sunset).
 */
export function menuWindowMinute(level: number, rising: boolean): number {
  if (level <= 0) return 12 * 60;
  if (rising && level < 1) return 19 * 60 + level * 90;
  return rising || level >= 1 ? 23 * 60 : 5 * 60 + 59;
}

/** Parked cars of the scene in the window, as static vehicle snapshots. */
export function sceneCars(scene: OsmScene, range: ChunkRange, chunk = 32): SnapshotVehicle[] {
  const x0 = range.cx0 * chunk;
  const y0 = range.cy0 * chunk;
  const x1 = (range.cx1 + 1) * chunk;
  const y1 = (range.cy1 + 1) * chunk;
  return scene.vehicles
    .filter((v) => v.x >= x0 && v.x < x1 && v.y >= y0 && v.y < y1)
    .map(
      (v, i) =>
        ({
          stableId: i + 1,
          variant: 0,
          x: v.x,
          y: v.y,
          z: 0,
          facingRad: v.heading,
          speed: 0,
          steer: 0,
          headlights: false,
          brakeLight: false,
        }) as unknown as SnapshotVehicle,
    );
}

/**
 * Menu-only lift of the ground (asphalt, sidewalks, grass) at night: the town kit's asphalt is
 * much darker than the grey box, so under the dark night fill it read as one grey-brown mass.
 * Scales the terrain material colour (×1 by day → ×(1 + this) at full night); the game is not
 * affected (its own terrain material instance).
 */
export const MENU_NIGHT_GROUND_LIFT = 1;

/** `base:sedan` (packages/content vehicle-types/sedan.json): what the placeholder car needs. */
const SEDAN: HudVehicleType = {
  id: 'base:sedan',
  length: 4.6,
  width: 1.8,
  fuelMax: 50,
  seats: [],
  trunkCapacity: 0,
  gloveboxCapacity: 0,
};

export async function createMenuTown(
  source: ChunkSource,
  scene: OsmScene,
  range: ChunkRange,
): Promise<MenuTown> {
  const [kitMod, town] = await Promise.all([
    import('../world/town/kit.js'),
    import('../world/town/index.js'),
  ]);
  const kit = await kitMod.loadTownKit();
  const world = withSceneVehicles(source, scene);
  const root = new Group();
  root.name = 'menu-town';

  const decor = town.townDecor(new town.MapTiles(world, range.z), range, scene.trees);
  const terrain = new town.TownTerrain(world, kit);
  terrain.loadRange(range);
  const structures = new town.TownStructures(world, kit);
  structures.loadRange(range, decor.props);
  const upper = town.loadUpperLevels(world, range, kit);
  const openings = new OpeningsView(world, structures.lookup, {
    kit,
    leafOf: (e) =>
      town.doorLeaf(structures.doorSkin(e.tx, e.ty, e.side === 'n' ? 'N' : 'W') ?? 'interior'),
  });
  openings.loadRange(range);
  openings.update(0);
  root.add(terrain.root, structures.root, ...upper.map((l) => l.root), openings.root);

  // Parked cars: the game's car view, posed once. Their headlight spots stay out of the scene
  // (parked, off): an invisible light is not counted by the renderer (no extra shader cost).
  const cars = new VehicleView((variant) => (variant === 0 ? SEDAN : undefined), 50);
  cars.push(sceneCars(scene, range), 0);
  cars.update(1000, 0);
  cars.root.traverse((o: Object3D) => {
    if (o instanceof SpotLight) o.visible = false;
  });
  root.add(cars.root);

  const ground = terrain.root.children.find((c): c is Mesh => c instanceof Mesh)?.material;
  const groundMat = ground instanceof MeshStandardMaterial ? ground : undefined;
  let lastLevel = -1;
  return {
    root,
    lamps: decor.lamps,
    setNight(level, minute) {
      structures.setMinute(minute);
      for (const l of upper) l.setMinute(minute);
      if (level !== lastLevel) {
        lastLevel = level;
        kit.material.emissiveIntensity = town.WINDOW_EMISSIVE_NIGHT * level;
        groundMat?.color.setScalar(1 + MENU_NIGHT_GROUND_LIFT * level);
      }
    },
    dispose() {
      terrain.dispose();
      structures.dispose();
      for (const l of upper) l.dispose();
      openings.dispose();
      root.clear();
    },
  };
}
