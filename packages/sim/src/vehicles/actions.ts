import { registerAction } from '../actions/queue.js';
import { gridOf } from '../ai/commands.js';
import { emitNoise } from '../ai/noise.js';
import { ticksPerGameMinute } from '../core/clock.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import type { ActionState } from '../items/store.js';
import { addXp, skillLevel } from '../progress/skills.js';
import { enterBlock, enterNow, exitBlock, exitNow, openDoor } from './commands.js';
import { carriedKey, drivenBy, tryStartEngine } from './keys.js';
import { vehicleSettings } from './settings.js';
import type { Vehicle } from './types.js';

/**
 * Timed vehicle actions (docs/sim-architecture.md „Pojazdy — rozgrywka”): `enterVehicle`,
 * `exitVehicle` (Fizyka's instant stubs are the last step, checked again at the end) and
 * `hotwire`. Zombies do not interrupt them (getting into a car is the escape); moving does.
 */

/** Real seconds (at ×1) → game minutes (the queue converts back with the wound slowdown). */
const secMin = (w: SimWorld, sec: number): number =>
  (sec * TICKS_PER_SECOND) / ticksPerGameMinute(w.clock);

/** Why player `eid` cannot hotwire the car it drives (undefined = it can). */
export function hotwireBlock(w: SimWorld, eid: number, a: ActionState) {
  const v = drivenBy(w, eid);
  if (!v || v.id !== a.vehicle) return 'invalid-state' as const;
  if (v.hotwired || v.keyIn || v.engineOn || carriedKey(w, eid, v)) return 'invalid-state' as const;
  const h = vehicleSettings(w).hotwire;
  if (skillLevel(w, eid, h.electricalSkill) < h.minElectrical) return 'skill-too-low' as const;
  if (skillLevel(w, eid, h.mechanicsSkill) < h.minMechanics) return 'skill-too-low' as const;
  return undefined;
}

/** Chance of one hotwiring attempt for player `eid`. */
export function hotwireChance(w: SimWorld, eid: number): number {
  const h = vehicleSettings(w).hotwire;
  const c =
    h.baseChance +
    skillLevel(w, eid, h.electricalSkill) * h.chancePerElectrical +
    skillLevel(w, eid, h.mechanicsSkill) * h.chancePerMechanics;
  return Math.min(h.maxChance, Math.max(0, c));
}

const vehicleOf = (w: SimWorld, a: ActionState): Vehicle | undefined =>
  a.vehicle === undefined ? undefined : w.physics.vehicles.get(a.vehicle);

let registered = false;

/** Registers the vehicle action handlers (idempotent; via `registerItemActions`). */
export function registerVehicleActions(): void {
  if (registered) return;
  registered = true;

  registerAction('enterVehicle', {
    validate: (w, eid, a) => enterBlock(w, eid, a.vehicle ?? 0, a.seat ?? 0),
    durationMin: (w) => secMin(w, vehicleSettings(w).enterSec),
    ignore: ['threat'],
    begin(w, _eid, a) {
      const v = vehicleOf(w, a);
      if (v) openDoor(w, v, a.seat ?? 0);
    },
    complete(w, eid, a) {
      enterNow(w, eid, a.vehicle ?? 0, a.seat ?? 0);
    },
  });

  registerAction('exitVehicle', {
    validate(w, eid, a) {
      const at = exitBlock(w, gridOf(w), eid);
      if (typeof at === 'string') return at;
      return at.v.id === a.vehicle ? undefined : 'invalid-state';
    },
    durationMin: (w) => secMin(w, vehicleSettings(w).exitSec),
    ignore: ['threat'],
    begin(w, _eid, a) {
      const v = vehicleOf(w, a);
      if (v) openDoor(w, v, a.seat ?? 0);
    },
    complete(w, eid) {
      exitNow(w, gridOf(w), eid);
    },
  });

  registerAction('hotwire', {
    validate: hotwireBlock,
    durationMin: (w) => secMin(w, vehicleSettings(w).hotwire.sec),
    ignore: ['threat'],
    begin(w, eid, a) {
      const v = vehicleOf(w, a);
      const n = vehicleSettings(w).hotwire.noise;
      if (v)
        emitNoise(w, v.x, v.y, v.z, n.radiusTiles, n.volume, 'action', 0, { eid, kind: 'hotwire' });
    },
    complete(w, eid, a) {
      const v = vehicleOf(w, a)!;
      const h = vehicleSettings(w).hotwire;
      const success = w.rng.actions.nextFloat() < hotwireChance(w, eid);
      addXp(w, eid, h.electricalSkill, h.xp);
      if (success) {
        v.hotwired = true;
        tryStartEngine(w, v);
      }
      w.events.push({
        type: 'hotwired',
        tick: w.tick,
        vehicleId: v.id,
        playerId: w.c.Player.id[eid] ?? 0,
        success,
      });
    },
  });
}
