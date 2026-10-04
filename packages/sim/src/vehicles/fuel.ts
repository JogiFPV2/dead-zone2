import type { ActionView, CommandRejectReason } from '@deadzone/protocol';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { registerAction } from '../actions/queue.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { noteReject } from '../core/reject-note.js';
import { rngFor } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems, hasToolTag } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { defOf, tileKey, type ActionState, type ItemInstance } from '../items/store.js';
import { floorZ } from '../world/levels.js';
import { circleVsObb, obbOf } from './geometry.js';
import { onFootNear } from './near.js';
import { seatOf, vehicleTypes } from './seats.js';
import { vehicleSettings } from './settings.js';
import type { Vehicle } from './types.js';

/**
 * Fuel (docs/sim-architecture.md 9.36): gas can levels (`ItemInstance.fuelL`, litres), pouring
 * a can into a tank (`refuel`), filling a can at a pump map object (`fillFuel`; powered fast,
 * hand crank slow, reserve per pump rolled on first use) and siphoning a tank into a can with a
 * hose (`siphonFuel`), or filling a car straight from a pump (`refuel` with `a.pump`, no can:
 * the car within `pumpHoseTiles` of the pump). Duration = litres / rate; an interrupted action
 * moves what it managed. A damaged tank (`fuelTank` < 100) leaks (`tankLeak`).
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

/** How pumps work now: mains power or the hand crank. */
export const pumpSource = (w: SimWorld): 'power' | 'crank' =>
  w.items?.powered ? 'power' : 'crank';

/** Rejects `no-item` with `missing.items` = the gas can (UI: „Brakuje: kanister”). */
function noCan(w: SimWorld): 'no-item' {
  noteReject(w, { missing: { items: [fuelCfg(w).canItem] } });
  return 'no-item';
}

/** Litres a car can take straight from the pump on (x, y) of the player's floor, or why not. */
function pumpToCar(w: SimWorld, eid: number, a: ActionState): number | CommandRejectReason {
  const [x, y] = a.pump!;
  const z = floorZ(w, eid);
  if (!pumpAt(w, x, y, z)) return 'no-station';
  const v = a.vehicle === undefined ? undefined : w.physics.vehicles.get(a.vehicle);
  const t = v && vehicleTypes(w)[v.type];
  if (!v || !t) return 'invalid-target';
  if (seatOf(w, w.c.StableId.value[eid] ?? 0)) return 'invalid-state';
  if (!nearTile(w, eid, x, y)) return 'out-of-range';
  if (
    Math.floor(v.z) !== z ||
    !circleVsObb(obbOf(v, t), x + 0.5, y + 0.5, fuelCfg(w).pumpHoseTiles)
  ) {
    noteReject(w, { detail: 'hose' });
    return 'out-of-range';
  }
  if (v.fuelMax - v.fuel <= EPS) return 'no-space';
  const left = pumpReserve(w, x, y, z);
  if (left <= EPS) return 'no-fuel';
  return Math.min(v.fuelMax - v.fuel, left);
}

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
  if (kind === 'refuel' && a.pump) return pumpToCar(w, eid, a);
  const can = carriedCan(w, eid, a.item);
  if (!can) return noCan(w);
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
  if (!hasToolTag(w, eid, fuelCfg(w).hoseTag)) {
    noteReject(w, { missing: { tools: [fuelCfg(w).hoseTag] } });
    return 'missing-tool';
  }
  if (v.fuel <= EPS) return 'no-fuel';
  if (cap - canLevel(can) <= EPS) return 'no-space';
  return Math.min(v.fuel, cap - canLevel(can));
}

const rateOf = (w: SimWorld, kind: Kind, a: ActionState): number =>
  kind === 'refuel'
    ? a.pump
      ? pumpRate(w)
      : fuelCfg(w).refuelLps
    : kind === 'siphon'
      ? fuelCfg(w).siphonLps
      : pumpRate(w);

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Pump → car (`refuel` with `a.pump`): moves `litres`, emits `refueled` kind `pump`. */
function movePumpToCar(w: SimWorld, eid: number, a: ActionState, litres: number): void {
  if (litres <= EPS) return;
  const [x, y] = a.pump!;
  const z = floorZ(w, eid);
  const v = w.physics.vehicles.get(a.vehicle!)!;
  const stock = f(Math.max(0, pumpReserve(w, x, y, z) - litres));
  w.items!.pumps.set(tileKey(x, y, z), stock);
  w.items!.version++;
  v.fuel = f(Math.min(v.fuelMax, v.fuel + litres));
  w.events.push({
    type: 'refueled',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    kind: 'pump',
    item: 0,
    litres: round2(litres),
    canL: 0,
    vehicleId: v.id,
    fuel: round2(v.fuel),
    pumpL: round2(stock),
  });
}

/** Moves `litres` (≤ what is transferable) and emits `refueled`. */
function move(w: SimWorld, eid: number, a: ActionState, kind: Kind, litres: number): void {
  if (kind === 'refuel' && a.pump) return movePumpToCar(w, eid, a, litres);
  const can = carriedCan(w, eid, a.item);
  if (!can || litres <= EPS) return;
  let v: Vehicle | undefined;
  let pumpL: number | undefined;
  if (kind === 'fill') {
    const [x, y] = a.pump!;
    const z = floorZ(w, eid);
    pumpL = f(Math.max(0, pumpReserve(w, x, y, z) - litres));
    w.items!.pumps.set(tileKey(x, y, z), pumpL);
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
    litres: round2(litres),
    canL: round2(canLevel(can)),
    ...(v ? { vehicleId: v.id, fuel: round2(v.fuel) } : {}),
    ...(pumpL !== undefined ? { pumpL: round2(pumpL) } : {}),
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
        return typeof l === 'string' ? 1 : Math.ceil((l / rateOf(w, kind, a)) * TICKS_PER_SECOND);
      },
      complete(w, eid, a) {
        const l = transferable(w, eid, a, kind);
        if (typeof l !== 'string') move(w, eid, a, kind, l);
      },
      interrupted(w, eid, a) {
        const l = transferable(w, eid, a, kind);
        if (typeof l === 'string') return;
        const done = (rateOf(w, kind, a) * (w.tick - a.startTick)) / TICKS_PER_SECOND;
        move(w, eid, a, kind, Math.min(l, done));
      },
    });
  }
}

/** `ActionView.fuel` of a running fuel action (undefined for other actions). */
export function fuelActionView(w: SimWorld, a: ActionState, kindName: string): ActionView['fuel'] {
  const kind = KIND[kindName];
  if (!kind) return undefined;
  const lps = rateOf(w, kind, a);
  const pump = kind === 'fill' || (kind === 'refuel' && a.pump);
  return {
    source: pump ? pumpSource(w) : kind === 'siphon' ? 'hose' : 'can',
    lps,
    ...(pump && a.pump ? { pump: { x: a.pump[0], y: a.pump[1] } } : {}),
  };
}

/** Per active car and tick: a damaged tank (`fuelTank` < 100) loses `tankLeakLps` × damage. */
export function tankLeak(w: SimWorld, v: Vehicle): void {
  const hp = v.fuelTank;
  if (hp === undefined || hp >= 100 || v.fuel <= 0) return;
  const lps = fuelCfg(w).tankLeakLps * (1 - Math.max(0, hp) / 100);
  if (lps > 0) v.fuel = f(Math.max(0, v.fuel - lps / TICKS_PER_SECOND));
}
