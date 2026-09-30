/**
 * Minimap math (spec §3.9). World = three.js floor plane (x east, z south; sim `y` = world `z`).
 * The iso camera sits at +(sin yaw, ·, cos yaw) from the player (apps/game camera/isometric.ts),
 * so "screen up" on the ground is (−sin yaw, −cos yaw). Rotating the map by the camera yaw makes
 * "map up" = "screen up". `north-up` is the same with yaw = 0 (north = −z).
 */

/** 1 m = 2.5 px → radius ≈ 40 m on the Ø200 map. */
export const MINIMAP_PX_PER_M = 2.5;
export const MINIMAP_SIZE = 200;
/** Road width on the minimap (Designer: 6 m ≈ 15 px). */
export const MINIMAP_ROAD_WIDTH_M = 6;
/** Inner radius (Ø200 minus the 2 px border). */
export const MINIMAP_INNER_RADIUS = MINIMAP_SIZE / 2 - 2;
/** The "N" sits on the rim, 8 px in from the (inner) edge. */
export const MINIMAP_NORTH_INSET = 8;
export const MINIMAP_NORTH_RADIUS = MINIMAP_INNER_RADIUS - MINIMAP_NORTH_INSET;

export type MinimapOrientation = 'camera' | 'north-up';

export interface Vec2 {
  x: number;
  z: number;
}

export const effectiveYaw = (cameraYaw: number, orientation: MinimapOrientation): number =>
  orientation === 'camera' ? cameraYaw : 0;

/** World point → minimap pixel offset from the centre (+x right, +y down). */
export function projectToMinimap(
  point: Vec2,
  player: Vec2,
  yaw: number,
  pxPerM: number = MINIMAP_PX_PER_M,
): { x: number; y: number } {
  const dx = point.x - player.x;
  const dz = point.z - player.z;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: (dx * c - dz * s) * pxPerM, y: (dx * s + dz * c) * pxPerM };
}

/** SVG transform for world-space layers (roads, buildings): same mapping as `projectToMinimap`. */
export const worldLayerTransform = (player: Vec2, yaw: number, pxPerM = MINIMAP_PX_PER_M): string =>
  `rotate(${round(deg(yaw))}) scale(${pxPerM}) translate(${round(-player.x)} ${round(-player.z)})`;

/**
 * Player marker rotation in degrees. `heading` = sim `facingRad` (from +x towards +z).
 * The triangle points up at 0°, so add 90°.
 */
export const playerMarkerDeg = (heading: number, yaw: number): number =>
  round(deg(heading + yaw + Math.PI / 2));

/** Rotation of the "N" glyph: it turns with the map (0° in north-up). */
export const northLetterDeg = (yaw: number): number => round(deg(yaw));

/** Where the "N" letter sits on the rim (pixel offset from the centre). */
export function northMarker(yaw: number, radius: number): { x: number; y: number } {
  const a = yaw - Math.PI / 2;
  return { x: round(Math.cos(a) * radius), y: round(Math.sin(a) * radius) };
}

const deg = (rad: number): number => (rad * 180) / Math.PI;
const round = (n: number): number => Math.round(n * 1000) / 1000 + 0;
