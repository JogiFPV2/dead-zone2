import type { BuildingId, ContentId, EdgeKind } from '../chunk.js';

/** Wall skins of the town kit (`wall-<skin>`, `window-<skin>`, `doorway-<skin>`, `stub-<skin>`). */
export type Skin = 'green' | 'beige' | 'blue' | 'brick' | 'plaster' | 'interior';

const SIDING: readonly Skin[] = ['green', 'beige', 'blue'];

/** Small stable hash in [0, 1) (no randomness: the same map always looks the same). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Exterior skin of a building from its wall content: explicit skins for the siding / plaster /
 * brick walls, `hash(buildingId)` siding for the generic `base:wall-plain`.
 */
export function skinOfWall(wall: ContentId | undefined, building: BuildingId): Skin {
  switch (wall) {
    case 'base:siding-green':
      return 'green';
    case 'base:siding-beige':
      return 'beige';
    case 'base:siding-blue':
      return 'blue';
    case 'base:plaster-wall':
      return 'plaster';
    case 'base:brick-wall':
      return 'brick';
    default:
      return SIDING[Math.floor(hash01(building, 7) * SIDING.length)] ?? 'green';
  }
}

/** Visual state of one edge module. */
export interface EdgeLook {
  lowered: boolean;
  lit?: boolean;
  broken?: boolean;
}

/**
 * Module name for an edge: walls `wall-<skin>`, windows `window-<skin>` (wooden window on the
 * outside of a brick house: `window-brick-wood`), doors `doorway-<skin>` (frame only, the leaf
 * is an opening piece). Lowered by the cutaway: `stub-<skin>`. Windows at night: `-lit`, smashed:
 * `-broken` (no glass).
 */
export function edgeModule(kind: EdgeKind, skin: Skin, content: ContentId, look: EdgeLook): string {
  if (look.lowered) return `stub-${skin}`;
  if (kind === 'door') return `doorway-${skin}`;
  if (kind === 'window') {
    const base =
      content === 'base:wooden-window' && skin === 'brick' ? 'window-brick-wood' : `window-${skin}`;
    if (look.broken) return `${base}-broken`;
    return look.lit ? `${base}-lit` : base;
  }
  return `wall-${skin}`;
}

/** Door leaf model for a doorway: interior doors are wooden, exterior ones by building skin. */
export function doorLeaf(skin: Skin): string {
  switch (skin) {
    case 'green':
      return 'door-red';
    case 'plaster':
      return 'door-glass';
    case 'blue':
    case 'interior':
      return 'door-wood';
    default:
      return 'door-green';
  }
}

/** Every module an edge may switch to at runtime (all must be in its chunk's BatchedMesh). */
export function edgeVariants(kind: EdgeKind, skin: Skin, content: ContentId): string[] {
  const out = new Set<string>();
  for (const lowered of [false, true]) {
    for (const lit of kind === 'window' ? [false, true] : [false]) {
      for (const broken of kind === 'window' ? [false, true] : [false]) {
        out.add(edgeModule(kind, skin, content, { lowered, lit, broken }));
      }
    }
  }
  return [...out];
}

/** Roof shape from the roof content: flat slabs + parapet, or a generated pitched roof. */
export type RoofStyle = 'flat' | 'hip' | 'gable';
export function roofStyle(roof: ContentId | undefined): RoofStyle {
  if (roof === 'base:roof-gable') return 'gable';
  if (roof === 'base:roof-shingles') return 'hip';
  return 'flat';
}

const ROOF_COLOURS = ['roof-a', 'roof-b', 'roof-c', 'roof-d'] as const;
export const roofColour = (building: BuildingId): string =>
  ROOF_COLOURS[((building % 4) + 4) % 4] ?? 'roof-a';

/** Wall colour cell of a skin (gable ends of pitched roofs). */
export const WALL_CELL: Record<Skin, string> = {
  green: 'wall-siding-green',
  beige: 'wall-siding-beige',
  blue: 'wall-siding-blue',
  brick: 'wall-brick',
  plaster: 'wall-plaster',
  interior: 'wall-interior',
};

/**
 * Lit windows at night: about a third of the windows, each switching on at its own time between
 * 19:00 and 20:30 and off at 6:00 (HUD spec 4.3). `minute` = minute of day.
 */
export const LIT_WINDOW_FRACTION = 0.38;
export function windowLit(seed: number, minute: number): boolean {
  if (hash01(seed, 11) >= LIT_WINDOW_FRACTION) return false;
  const on = 19 * 60 + hash01(seed, 13) * 90;
  return minute >= on || minute < 6 * 60;
}
