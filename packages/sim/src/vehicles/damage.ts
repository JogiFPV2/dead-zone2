import type { VehiclePart } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import type { Impact, UnderBody } from './collide.js';
import type { VehicleConfig } from './config.js';
import { NO_MODS, type DriveMods } from './drive.js';
import { tryStartEngine } from './keys.js';
import { Zone, type Vehicle } from './types.js';

/**
 * Car damage (PR B): parts with hp 0..100 — engine, tyres FL / FR / RL / RR, body zones front /
 * rear / left / right, windows front / rear / left / right. Impacts take hp by their energy at
 * the zone of the hit point; driving reads the parts back as `DriveMods` (engine power, flat
 * tyre pull and grip). Deterministic: only + − × ÷ on f32-rounded values, no RNG.
 */

const f = Math.fround;
const ZONE_NAMES = ['Front', 'Rear', 'Left', 'Right'] as const;
const TIRE_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

/**
 * Missing part arrays (states from before PR B) → full hp; no window grabs. `battery` /
 * `fuelTank` (protocol 19) stay absent until they take damage (absent = 100: saves and hashes of
 * undamaged cars are unchanged).
 */
export function ensureVehicleParts(v: Vehicle): void {
  if (typeof v.engine !== 'number') v.engine = 100;
  if (!Array.isArray(v.tires) || v.tires.length !== 4) v.tires = [100, 100, 100, 100];
  if (!Array.isArray(v.windows) || v.windows.length !== 4) v.windows = [100, 100, 100, 100];
  if (!Array.isArray(v.zones) || v.zones.length !== 4) v.zones = [100, 100, 100, 100];
  const n = v.occupants.length;
  if (!Array.isArray(v.grab) || v.grab.length !== n) v.grab = new Array<number>(n).fill(0);
  if (!Array.isArray(v.grabBy) || v.grabBy.length !== n) v.grabBy = new Array<number>(n).fill(0);
}

/** Bit i = window i (front, rear, left, right) at 0 hp (snapshot `engine` bits 8–11). */
export function brokenWindowsMask(v: Vehicle): number {
  let m = 0;
  for (let i = 0; i < 4; i++) if ((v.windows[i] ?? 100) <= 0) m |= 1 << i;
  return m;
}

interface Slot {
  get(): number;
  set(hp: number): void;
}

/** Scalar part fields: `engine` and the gameplay parts (`battery`, `fuelTank`; absent = 100). */
const scalar = (v: Vehicle, key: 'engine' | 'battery' | 'fuelTank'): Slot => ({
  get: () => v[key] ?? 100,
  set: (hp) => {
    v[key] = hp;
  },
});

/** Slot of a part name (read / write its hp). */
function slot(v: Vehicle, part: VehiclePart): Slot | undefined {
  if (part === 'engine' || part === 'battery' || part === 'fuelTank') return scalar(v, part);
  const arr = (a: number[], i: number): Slot | undefined =>
    i < 0
      ? undefined
      : {
          get: () => a[i]!,
          set: (hp) => {
            a[i] = hp;
          },
        };
  if (part.startsWith('tire')) {
    return arr(v.tires, TIRE_NAMES.indexOf(part.slice(4) as (typeof TIRE_NAMES)[number]));
  }
  if (part.startsWith('body')) {
    return arr(v.zones, ZONE_NAMES.indexOf(part.slice(4) as (typeof ZONE_NAMES)[number]));
  }
  if (part.startsWith('window')) {
    return arr(v.windows, ZONE_NAMES.indexOf(part.slice(6) as (typeof ZONE_NAMES)[number]));
  }
  return undefined;
}

/** Current hp 0..100 of `part` (undefined for an unknown part name). */
export function partHp(v: Vehicle, part: VehiclePart): number | undefined {
  return slot(v, part)?.get();
}

function stopBroken(w: SimWorld, v: Vehicle): void {
  if (!v.engineOn) return;
  v.engineOn = false;
  w.events.push({ type: 'engineStop', tick: w.tick, vehicleId: v.id, reason: 'broken' });
}

/**
 * Takes `dmg` hp from `part`; a part reaching 0 sends `vehiclePartBroken` at (x, y), a dead
 * engine also stops (`engineStop` reason `broken`).
 */
function hurt(w: SimWorld, v: Vehicle, part: VehiclePart, dmg: number, x: number, y: number): void {
  if (!(dmg > 0)) return;
  const s = slot(v, part);
  if (!s) return;
  const before = s.get();
  if (before <= 0) return;
  const after = f(Math.max(0, before - dmg));
  s.set(after);
  if (after > 0) return;
  w.events.push({
    type: 'vehiclePartBroken',
    tick: w.tick,
    vehicleId: v.id,
    part,
    x: f(x),
    y: f(y),
  });
  if (part === 'engine') stopBroken(w, v);
}

/** Wheel (FL 0, FR 1, RL 2, RR 3) nearest to the world point (x, y). */
export function wheelAt(v: Vehicle, x: number, y: number): number {
  const dx = x - v.x;
  const dy = y - v.y;
  const front = dx * v.hx + dy * v.hy >= 0;
  const right = -dx * v.hy + dy * v.hx >= 0;
  return (front ? 0 : 2) + (right ? 1 : 0);
}

/** Body-zone hp an impact of `energy` J takes (0 below `damageMinJ`). */
export const impactDamage = (energy: number, cfg: VehicleConfig): number =>
  (Math.max(0, energy - cfg.damageMinJ) / 1000) * cfg.zoneDmgPerKJ;

/**
 * One contact (wall, fence, body, car): the zone at the hit point loses `impactDamage` (soft
 * bodies × `softDmgMul`), its
 * window `windowDmgMul` × that, the nearest tyre `tireDmgMul` ×; front hits also hurt the engine
 * (`engineDmgShare`, the full damage once the front zone is below `engineExposedBelow`).
 */
export function applyImpactDamage(w: SimWorld, hit: Impact, cfg: VehicleConfig): void {
  const v = hit.vehicle;
  const soft =
    hit.targetKind !== 'wall' && hit.targetKind !== 'fence' && hit.targetKind !== 'vehicle';
  const dmg = impactDamage(hit.energy, cfg) * (soft ? cfg.softDmgMul : 1);
  if (dmg <= 0) return;
  const z = hit.zone;
  const name = ZONE_NAMES[z] ?? 'Front';
  const exposed = (v.zones[Zone.front] ?? 100) < cfg.engineExposedBelow;
  hurt(w, v, `body${name}`, dmg, hit.x, hit.y);
  hurt(w, v, `window${name}`, dmg * cfg.windowDmgMul, hit.x, hit.y);
  // Tyres: a front / rear hit shares the axle's pair; a side hit takes the nearest tyre on it.
  const td = dmg * cfg.tireDmgMul;
  if (z === Zone.front || z === Zone.rear) {
    const a = z === Zone.front ? 0 : 2;
    hurt(w, v, `tire${TIRE_NAMES[a]}`, td / 2, hit.x, hit.y);
    hurt(w, v, `tire${TIRE_NAMES[a + 1]!}`, td / 2, hit.x, hit.y);
  } else {
    const wheel = (wheelAt(v, hit.x, hit.y) & 2) + (z === Zone.right ? 1 : 0);
    hurt(w, v, `tire${TIRE_NAMES[wheel]!}`, td, hit.x, hit.y);
  }
  if (z === Zone.front)
    hurt(w, v, 'engine', dmg * (exposed ? 1 : cfg.engineDmgShare), hit.x, hit.y);
}

/**
 * A body under the wheels (one call per body per tick, see `rollOver`): the nearest tyre loses
 * `rollTireDmg` × speed / 10 m/s, the zone over it `rollBodyDmg` × that (underbody scrape).
 */
export function applyRollDamage(w: SimWorld, u: UnderBody, cfg: VehicleConfig): void {
  const v = u.vehicle;
  const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
  if (sp < 0.5) return;
  const wheel = wheelAt(v, u.x, u.y);
  const dmg = (cfg.rollTireDmg * sp) / 10;
  hurt(w, v, `tire${TIRE_NAMES[wheel]!}`, dmg, u.x, u.y);
  hurt(w, v, wheel < 2 ? 'bodyFront' : 'bodyRear', dmg * cfg.rollBodyDmg, u.x, u.y);
}

/**
 * Parts → drive factors: engine below `engineThreshold` gives proportionally less power (at
 * least `engineMinPower` while it runs); a tyre below `tireFlatBelow` is going flat (flatness
 * 0..1), pulling the steering to its side (`tirePull`, rear tyres half) and lowering grip by
 * `flatGripLoss` × mean flatness.
 */
export function driveMods(v: Vehicle, cfg: VehicleConfig): DriveMods {
  const e = v.engine;
  let flatSum = 0;
  let pull = 0;
  for (let i = 0; i < 4; i++) {
    const hp = v.tires[i] ?? 100;
    if (hp >= cfg.tireFlatBelow) continue;
    const flat = (cfg.tireFlatBelow - hp) / cfg.tireFlatBelow;
    flatSum += flat;
    pull += (i % 2 === 1 ? 1 : -1) * flat * (i < 2 ? 1 : 0.5);
  }
  if (e >= cfg.engineThreshold && flatSum === 0) return NO_MODS;
  return {
    powerMul: e >= cfg.engineThreshold ? 1 : Math.max(cfg.engineMinPower, e / cfg.engineThreshold),
    pull: pull * cfg.tirePull,
    gripMul: 1 - (cfg.flatGripLoss * flatSum) / 4,
  };
}

/**
 * Repairs / damage from outside (Symulacja): sets `part` to `hp` (clamped 0..100). An engine
 * repaired from 0 with a driver and fuel starts again (`engineStart`); one set to 0 stops
 * (`engineStop` `broken`). Returns false for an unknown part.
 */
export function setVehiclePartHp(w: SimWorld, v: Vehicle, part: VehiclePart, hp: number): boolean {
  const s = slot(v, part);
  if (!s || !Number.isFinite(hp)) return false;
  const value = f(Math.max(0, Math.min(100, hp)));
  const before = s.get();
  s.set(value);
  // A dead battery / leaking tank stop nothing that runs: the battery only blocks the next start.
  if (part !== 'engine') return true;
  if (value <= 0) stopBroken(w, v);
  // A key (ignition / carried) or hotwiring is needed too (`vehicles/keys.ts`).
  else if (before <= 0 && !v.engineOn && (v.occupants[0] ?? 0) !== 0) tryStartEngine(w, v);
  return true;
}
