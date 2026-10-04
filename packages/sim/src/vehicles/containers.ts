import type { VehicleTypeDef } from '../content/adapter.js';
import { deriveSeed } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { addContainer, type ItemContainer, type StoreContainerKind } from '../items/store.js';
import { floorZ } from '../world/levels.js';
import { seatOf, vehicleTypes } from './seats.js';
import { vehicleSettings } from './settings.js';
import type { Vehicle } from './types.js';

/**
 * Trunk and glovebox (docs/sim-architecture.md „Pojazdy — rozgrywka”): item containers of kind
 * `vehicle-trunk` / `vehicle-glovebox` owned by the vehicle (owner = its StableId, x / y = 0:
 * they move with the car). Capacity from the vehicle type, storage type (search time, default
 * loot table) from `worldSettings.vehicles.trunkContainer` / `gloveboxContainer`; loot is
 * generated lazily on the first search, like world storage. The trunk opens standing behind the
 * unlocked car, the glovebox only from a front seat.
 */

export const isVehicleContainer = (kind: StoreContainerKind): boolean =>
  kind === 'vehicle-trunk' || kind === 'vehicle-glovebox';

/** Creates the containers of a freshly spawned vehicle (needs the item store). */
export function createVehicleContainers(w: SimWorld, v: Vehicle, t: VehicleTypeDef): void {
  const st = w.items;
  if (!st) return;
  const cfg = vehicleSettings(w);
  const make = (kind: 'vehicle-trunk' | 'vehicle-glovebox', capacityKg: number, typeId: string) => {
    if (!(capacityKg > 0)) return;
    const type = st.content.containerTypeIndex.get(typeId) ?? -1;
    const c = addContainer(st, {
      kind,
      owner: v.id,
      type,
      x: 0,
      y: 0,
      z: 0,
      capacityKg,
      acceptsTags: undefined,
      roomType: undefined,
      lootKey: deriveSeed(w.seed, kind, v.id),
      lootDone: type < 0 || !st.content.containerTypes[type]?.defaultLootTable,
    });
    v.containers.push(c.id);
  };
  make('vehicle-trunk', t.trunkCapacity, cfg.trunkContainer);
  make('vehicle-glovebox', t.gloveboxCapacity, cfg.gloveboxContainer);
}

/** Container of kind `kind` of vehicle `v` (undefined = the type has none). */
export function vehicleContainer(
  w: SimWorld,
  v: Vehicle,
  kind: 'vehicle-trunk' | 'vehicle-glovebox',
): ItemContainer | undefined {
  for (const id of v.containers) {
    const c = w.items?.containers.get(id);
    if (c?.kind === kind) return c;
  }
  return undefined;
}

/** Point behind the car where the trunk is opened (0.3 m past the rear bumper). */
export function trunkPoint(v: Vehicle, t: VehicleTypeDef): { x: number; y: number } {
  const back = t.length / 2 + 0.3;
  return { x: v.x - v.hx * back, y: v.y - v.hy * back };
}

/** Seats of the front row (largest `offset.x`): they reach the glovebox. */
export function frontRow(t: VehicleTypeDef, seat: number): boolean {
  const x = t.seats[seat]?.offset.x;
  if (x === undefined) return false;
  return t.seats.every((s) => s.offset.x <= x + 1e-6);
}

/**
 * Why player `eid` cannot reach vehicle container `c` (undefined = in reach): trunk — on foot,
 * same level, within `trunkReachTiles` of the trunk point, car unlocked (`locked`); glovebox —
 * sitting in a front seat of that car.
 */
export function vehicleContainerBlock(
  w: SimWorld,
  eid: number,
  c: ItemContainer,
): 'out-of-range' | 'locked' | 'invalid-target' | undefined {
  const v = w.physics.vehicles.get(c.owner);
  const t = v ? vehicleTypes(w)[v.type] : undefined;
  if (!v || !t) return 'invalid-target';
  const at = seatOf(w, w.c.StableId.value[eid] ?? 0);
  if (c.kind === 'vehicle-glovebox')
    return at?.v === v && frontRow(t, at.seat) ? undefined : 'out-of-range';
  if (at) return 'out-of-range';
  if (floorZ(w, eid) !== Math.floor(v.z)) return 'out-of-range';
  const p = trunkPoint(v, t);
  const dx = (w.c.Position.x[eid] ?? 0) - p.x;
  const dy = (w.c.Position.y[eid] ?? 0) - p.y;
  const r = vehicleSettings(w).trunkReachTiles;
  if (dx * dx + dy * dy > r * r) return 'out-of-range';
  return v.locked ? 'locked' : undefined;
}

/** Tile of the access point (nearby view): trunk point or the seat. */
export function accessTile(
  w: SimWorld,
  c: ItemContainer,
): { x: number; y: number; z: number } | undefined {
  const v = w.physics.vehicles.get(c.owner);
  const t = v ? vehicleTypes(w)[v.type] : undefined;
  if (!v || !t) return undefined;
  const p = c.kind === 'vehicle-trunk' ? trunkPoint(v, t) : { x: v.x, y: v.y };
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(v.z) };
}
