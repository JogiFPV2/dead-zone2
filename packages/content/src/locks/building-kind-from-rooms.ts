import { BUILDING_KIND_ROOMS, type BuildingKind } from '../schemas/building-kind.js';

/**
 * Rodzaj budynku z typów jego pomieszczeń (`base:room-*`), wg priorytetu `BUILDING_KIND_ROOMS`
 * (publiczne > sklepy i usługi > dom > biuro, magazyn > garaż > ruina). `undefined`, gdy żadne
 * pomieszczenie nic nie mówi (np. sama sala `base:room-hall`).
 */
export function buildingKindFromRooms(roomTypes: Iterable<string>): BuildingKind | undefined {
  const have = new Set(roomTypes);
  for (const [kind, rooms] of BUILDING_KIND_ROOMS) if (rooms.some((r) => have.has(r))) return kind;
  return undefined;
}
