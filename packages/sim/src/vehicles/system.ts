import { CHUNK_SIZE } from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import type { SimWorld } from '../core/world.js';
import { isActive, updateActiveWindows } from '../physics/active.js';
import type { TileGrid } from '../world/grid.js';
import { collideVehicle, type Impact, type UnderBody } from './collide.js';
import { ramBody, rollOver } from './ram.js';
import { pinOccupant, releaseControls } from './commands.js';
import { driveStep } from './drive.js';
import { windowGrabStep } from './windows.js';
import { applyImpactDamage, applyRollDamage, driveMods } from './damage.js';
import { playerEidOf, vehicleTypes } from './seats.js';
import type { Vehicle } from './types.js';
import { tankLeak } from './fuel.js';

/** Vehicles in StableId order (deterministic). */
export function sortedVehicles(w: SimWorld): Vehicle[] {
  return [...w.physics.vehicles.values()].sort((a, b) => a.id - b.id);
}

/** Drops seats whose player is gone, dead or no longer `driving` (death, a debug teleport). */
function checkOccupants(w: SimWorld, v: Vehicle): void {
  for (let s = 0; s < v.occupants.length; s++) {
    const sid = v.occupants[s]!;
    if (sid === 0) continue;
    const eid = playerEidOf(w, sid);
    const b = w.physics.bodies.get(sid);
    if (eid !== undefined && b && b.state === 'driving' && !w.survival?.dead[eid]) continue;
    v.occupants[s] = 0;
    if (b && b.vehicle === v.id) {
      b.vehicle = 0;
      b.seat = -1;
    }
    if (s === 0) {
      releaseControls(v);
      if (v.engineOn) {
        v.engineOn = false;
        w.events.push({ type: 'engineStop', tick: w.tick, vehicleId: v.id, reason: 'driver-left' });
      }
    }
  }
}

/**
 * Pipeline step `vehicles` (after `movement.facing`, before `physics`): drive model, collisions
 * (walls, fences, bodies, other cars), doors, fuel, engine noise and seat pinning. Cars outside
 * every active chunk window are frozen (no update at all; door timers count active ticks).
 * No-op without vehicles (old states keep their hashes).
 */
export function vehicleSystem(w: SimWorld, grid: TileGrid): void {
  if (w.physics.vehicles.size === 0) return;
  const types = vehicleTypes(w);
  const cfg = w.physics.cfg.vehicle;
  updateActiveWindows(w);
  const impacts: Impact[] = [];
  const under: UnderBody[] = [];
  for (const v of sortedVehicles(w)) {
    const t = types[v.type];
    if (!t) continue;
    if (!isActive(v.x, v.y)) {
      if (v.frozenAt < 0) v.frozenAt = w.tick;
      continue;
    }
    v.frozenAt = -1;
    checkOccupants(w, v);
    tankLeak(w, v);
    if (v.engineOn && v.fuel <= 0) {
      v.engineOn = false;
      v.throttle = 0;
      w.events.push({ type: 'engineStop', tick: w.tick, vehicleId: v.id, reason: 'no-fuel' });
    }
    const eff = v.engineOn ? v.throttle : 0;
    const saved = v.throttle;
    v.throttle = eff;
    driveStep(v, t, cfg, driveMods(v, cfg));
    v.throttle = saved;
    collideVehicle(w, grid, v, types, cfg, impacts, under);
    v.cx = Math.floor(v.x / CHUNK_SIZE);
    v.cy = Math.floor(v.y / CHUNK_SIZE);
    for (let s = 0; s < v.doorTicks.length; s++) {
      if (v.doorTicks[s]! > 0 && --v.doorTicks[s]! === 0) v.doorsOpen &= ~(1 << s);
    }
    if (v.engineOn && (w.tick + v.id) % cfg.noiseEveryTicks === 0) {
      const r = cfg.noiseIdleTiles + (cfg.noiseFullTiles - cfg.noiseIdleTiles) * v.throttle;
      const driver = v.occupants[0] ? playerEidOf(w, v.occupants[0]) : undefined;
      const by = driver === undefined ? undefined : { eid: driver, kind: 'vehicle' as const };
      emitNoise(w, v.x, v.y, v.z, r, cfg.noiseVolume, 'vehicle', 0, by);
    }
  }
  // Pin after all cars moved (a car pushed by another one carries its occupants too).
  for (const v of w.physics.vehicles.values()) {
    if (v.frozenAt >= 0) continue;
    for (let s = 0; s < v.occupants.length; s++) {
      const eid = v.occupants[s] ? playerEidOf(w, v.occupants[s]!) : undefined;
      if (eid !== undefined) pinOccupant(w, eid, v, s);
    }
  }
  // Ramming and rolling over bodies (after all cars moved; contact order is deterministic).
  for (const hit of impacts) ramBody(w, grid, hit, cfg);
  for (const u of under) rollOver(w, grid, u, cfg);
  // Damage after the reactions (impact order = deterministic contact order).
  for (const hit of impacts) applyImpactDamage(w, hit, cfg);
  for (const u of under) applyRollDamage(w, u, cfg);
  // Zombies at broken windows (after the damage of this tick: a window broken now counts).
  for (const v of sortedVehicles(w)) if (v.frozenAt < 0) windowGrabStep(w, grid, v);
  for (const hit of impacts) {
    if (hit.energy >= cfg.minImpactJ) {
      w.events.push({
        type: 'vehicleImpact',
        tick: w.tick,
        vehicleId: hit.vehicle.id,
        energy: Math.round(hit.energy),
        speed: Math.fround(hit.closing),
        targetKind: hit.targetKind,
        target: hit.target,
        x: Math.fround(hit.x),
        y: Math.fround(hit.y),
        nx: Math.fround(hit.nx),
        ny: Math.fround(hit.ny),
      });
    }
  }
}
