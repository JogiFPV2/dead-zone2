import { WOUND_KINDS } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { inflictWound } from '../survival/wounds.js';
import type { Impact } from './collide.js';
import type { VehicleConfig } from './config.js';
import { playerEidOf } from './seats.js';

/** Body parts an occupant hits in a crash (wheel, dashboard, side window, seat). */
const CRASH_PARTS = [0, 1, 2, 3, 7, 8, 11, 12] as const; // head, neck, torso, forearms, thighs
const SCRATCH = WOUND_KINDS.indexOf('scratch');
const LACERATION = WOUND_KINDS.indexOf('laceration');
const DEEP = WOUND_KINDS.indexOf('deep');

/** Wound kinds of a crash at `speed` m/s, most severe first, capped at `crashMaxWounds`. */
export function crashWounds(speed: number, cfg: VehicleConfig): number[] {
  const out: number[] = [];
  if (speed >= cfg.crashDeepSpeed) out.push(DEEP, LACERATION);
  else if (speed >= cfg.crashLacerationSpeed) out.push(LACERATION);
  else if (speed >= cfg.crashInjurySpeed) out.push(SCRATCH);
  return out.slice(0, Math.max(0, cfg.crashMaxWounds));
}

/**
 * Occupants of a car that hit a wall / fence / car hard enough get hurt (`wounded` events, no
 * seatbelts). One call per impact; a car stopped by a wall has no closing speed on the next
 * tick, so a crash wounds once. Draws `rng.health` per wound (body part).
 */
export function crashInjuries(w: SimWorld, hit: Impact, cfg: VehicleConfig): void {
  if (
    hit.targetKind !== 'wall' &&
    hit.targetKind !== 'fence' &&
    hit.targetKind !== 'vehicle' &&
    hit.targetKind !== 'furniture'
  )
    return;
  const kinds = crashWounds(hit.closing, cfg);
  if (!kinds.length || !w.survival) return;
  const v = hit.vehicle;
  for (const sid of v.occupants) {
    const eid = sid ? playerEidOf(w, sid) : undefined;
    if (eid === undefined) continue;
    for (const kind of kinds) {
      const part = CRASH_PARTS[w.rng.health.int(0, CRASH_PARTS.length - 1)] ?? 2;
      inflictWound(w, eid, part, kind);
    }
  }
}
