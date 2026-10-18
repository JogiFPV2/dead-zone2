import {
  BUILDING_KINDS,
  buildingKindFromRooms,
  type BuildingKind as ContentBuildingKind,
} from '@deadzone/content';
import type { BuildingKind } from './osm/types.js';

/**
 * Building kinds for the sim (`SimChunk.buildingKinds`, content chunk `buildingKinds`): the keys
 * of `openings.locks.exteriorLockedChanceByBuilding` = `BUILDING_KINDS` of `@deadzone/content`
 * (#224), derived from rooms by its `buildingKindFromRooms` (one table, no copy here).
 */
export type LockBuildingKind = ContentBuildingKind;
export const LOCK_BUILDING_KINDS: readonly LockBuildingKind[] = BUILDING_KINDS;

/**
 * Generator / OSM kind → lock kind (#224: `block` and `kostka` are houses, `station` a shop,
 * `fire-station` an office, `shed` a garage; `church` has none — the sim uses the default).
 */
export const LOCK_KIND_OF: Readonly<Record<BuildingKind, LockBuildingKind | undefined>> = {
  house: 'house',
  block: 'house',
  kostka: 'house',
  shop: 'shop',
  pharmacy: 'pharmacy',
  hospital: 'hospital',
  school: 'school',
  gym: 'gym',
  church: undefined,
  police: 'police',
  'fire-station': 'office',
  office: 'office',
  station: 'shop',
  fuel: 'fuel',
  industrial: 'industrial',
  garage: 'garage',
  shed: 'garage',
  ruin: 'ruin',
};

/** Kind from the room types of a building (content priority table). */
export function kindFromRooms(roomTypes: Iterable<string>): LockBuildingKind | undefined {
  return buildingKindFromRooms(roomTypes);
}

/** Lock kind of a generator building: its own kind, else from its rooms. */
export function lockKindOf(
  kind: string | undefined,
  roomTypes: Iterable<string>,
): LockBuildingKind | undefined {
  if (kind !== undefined && Object.hasOwn(LOCK_KIND_OF, kind)) {
    const k = LOCK_KIND_OF[kind as BuildingKind];
    if (k) return k;
    if (kind === 'church') return undefined;
  }
  return kindFromRooms(roomTypes);
}
