import type { CommandRejectReason } from '@deadzone/protocol';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { rngFor } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems, hasToolTag } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf, tileKey, type ActionState, type ItemInstance } from '../items/store.js';
import { floorZ } from '../world/levels.js';
import { onFootNear } from './near.js';
import { vehicleSettings } from './settings.js';
import type { Vehicle } from './types.js';

/**
 * Fuel (docs/sim-architecture.md 9.36): gas can levels (`ItemInstance.fuelL`, litres), pouring
 * a can into a tank (`refuel`), filling a can at a pump map object (`fillFuel`; powered fast,
 * hand crank slow, reserve per pump rolled on first use) and siphoning a tank into a can with a
 * hose (`siphonFuel`). Duration = litres / rate; an interrupted action moves what it managed.
 */

const EPS = 1e-4;
const f = Math.fround;
const fuelCfg = (w: SimWorld) => vehicleSettings(w).fuel;

/** The item is a gas can (`fuel.canItem`). */
export function isCan(w: SimWorld, item: ItemInstance): boolean {
  const st = w.items;
  return !!st && defOf(st, item).id === fuelCfg(w).canItem;
}

export const canLevel = (item: ItemInstance): number => item.fuelL ?? 0;

/** Carried gas can `itemId` of player `eid`. */
export function carriedCan(w: SimWorld, eid: number, itemId: number): ItemInstance | undefined {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return undefined;
  return carriedItems(st, p.inventory).find((i) => i.id === itemId && isCan(w, i));
}

function setCan(w: SimWorld, item: ItemInstance, litres: number): void {
  const l = f(Math.max(0, Math.min(fuelCfg(w).canCapacityL, litres)));
  if (l > EPS) item.fuelL = l;
  else delete item.fuelL;
  w.items!.version++;
}

/** Fuel pump map object on tile (x, y, z), if any. */
export function pumpAt(w: SimWorld, x: number, y: number, z: number): boolean {
  const id = fuelCfg(w).pumpItem;
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const lx = x - cx * CHUNK_SIZE;
  const ly = y - cy * CHUNK_SIZE;
  return (w.map.getChunk(cx, cy, z)?.objects ?? []).some(
    (o) => o.contentId === id && o.x === lx && o.y === ly,
  );
}

/** Litres left in the pump on (x, y, z) (rolled from `pumpReserveL` on first use). */
export function pumpReserve(w: SimWorld, x: number, y: number, z: number): number {
  const st = w.items!;
  const key = tileKey(x, y, z);
  const have = st.pumps.get(key);
  if (have !== undefined) return have;
  const r = fuelCfg(w).pumpReserveL;
  return f(r.min + (r.max - r.min) * rngFor(w.seed, 'fuel-pump', x, y, z).nextFloat());
}

const pumpRate = (w: SimWorld): number =>
  w.items?.powered ? fuelCfg(w).pumpPoweredLps : fuelCfg(w).pumpManualLps;

/** Tile (x, y) within `fuel.reachTiles` of the player (tile centre), same floor. */
function nearTile(w: SimWorld, eid: number, x: number, y: number): boolean {
  const r = fuelCfg(w).reachTiles + 0.5;
  const dx = x + 0.5 - (w.c.Position.x[eid] ?? 0);
  const dy = y + 0.5 - (w.c.Position.y[eid] ?? 0);
  return dx * dx + dy * dy <= r * r;
}

type Kind = 'refuel' | 'fill' | 'siphon';
const KIND: Record<string, Kind> = { refuel: 'refuel', fillFuel: 'fill', siphonFuel: 'siphon' };

/** Litres the action can still move now, or why it cannot run. */
function transferable(
  w: SimWorld,
  eid: number,
  a: ActionState,
  kind: Kind,
): number | CommandRejectReason {
  const can = carriedCan(w, eid, a.item);
  if (!can) return 'no-item';
  const cap = fuelCfg(w).canCapacityL;
  if (kind === 'fill') {
    const [x, y] = a.pump ?? [0, 0];
    const z = floorZ(w, eid);
    if (!pumpAt(w, x, y, z)) return 'no-station';
    if (!nearTile(w, eid, x, y)) return 'out-of-range';
    if (cap - canLevel(can) <= EPS) return 'no-space';
    const left = pumpReserve(w, x, y, z);
    if (left <= EPS) return 'no-fuel';
    return Math.min(cap - canLevel(can), left);
  }
  const v = a.vehicle === undefined ? undefined : w.physics.vehicles.get(a.vehicle);
  if (!v) return 'invalid-target';
  if (!onFootNear(w, eid, v, fuelCfg(w).reachTiles)) return 'out-of-range';
  if (kind === 'refuel') {
    if (canLevel(can) <= EPS) return 'no-fuel';
    if (v.fuelMax - v.fuel <= EPS) return 'no-space';
    return Math.min(canLevel(can), v.fuelMax - v.fuel);
  }
  if (!hasToolTag(w, eid, fuelCfg(w).hoseTag)) return 'missing-tool';
  if (v.fuel <= EPS) return 'no-fuel';
  if (cap - canLevel(can) <= EPS) return 'no-space';
  return Math.min(v.fuel, cap - canLevel(can));
}

const rateOf = (w: SimWorld, kind: Kind): number =>
  kind === 'refuel' ? fuelCfg(w).refuelLps : kind === 'siphon' ? fuelCfg(w).siphonLps : pumpRate(w);

/** Moves `litres` (≤ what is transferable) and emits `refueled`. */
function move(w: SimWorld, eid: number, a: ActionState, kind: Kind, litres: number): void {
  const can = carriedCan(w, eid, a.item);
  if (!can || litres <= EPS) return;
  let v: Vehicle | undefined;
  if (kind === 'fill') {
    const [x, y] = a.pump!;
    const z = floorZ(w, eid);
    w.items!.pumps.set(tileKey(x, y, z), f(Math.max(0, pumpReserve(w, x, y, z) - litres)));
    setCan(w, can, canLevel(can) + litres);
  } else {
    v = w.physics.vehicles.get(a.vehicle!)!;
    const sign = kind === 'refuel' ? 1 : -1;
    v.fuel = f(Math.max(0, Math.min(v.fuelMax, v.fuel + sign * litres)));
    setCan(w, can, canLevel(can) - sign * litres);
  }
  w.events.push({
    type: 'refueled',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    kind,
    item: can.id,
    litres: Math.round(litres * 100) / 100,
    canL: Math.round(canLevel(can) * 100) / 100,
    ...(v ? { vehicleId: v.id, fuel: Math.round(v.fuel * 100) / 100 } : {}),
  });
}

let registered = false;

export function registerFuelActions(): void {
  if (registered) return;
  registered = true;
  for (const name of ['refuel', 'fillFuel', 'siphonFuel'] as const) {
    const kind = KIND[name]!;
    registerAction(name, {
      validate(w, eid, a) {
        const l = transferable(w, eid, a, kind);
        return typeof l === 'string' ? l : undefined;
      },
      durationMin: () => 1,
      ticks(w, eid, a) {
        const l = transferable(w, eid, a, kind);
        return typeof l === 'string' ? 1 : Math.ceil((l / rateOf(w, kind)) * TICKS_PER_SECOND);
      },
      complete(w, eid, a) {
        const l = transferable(w, eid, a, kind);
        if (typeof l !== 'string') move(w, eid, a, kind, l);
      },
      interrupted(w, eid, a) {
        const l = transferable(w, eid, a, kind);
        if (typeof l === 'string') return;
        const done = (rateOf(w, kind) * (w.tick - a.startTick)) / TICKS_PER_SECOND;
        move(w, eid, a, kind, Math.min(l, done));
      },
    });
  }
}
