import type { Gait } from '@deadzone/protocol';
import type { LocoPose } from './locomotion-blend.js';

/**
 * Anim v2 locomotion layer (anim-spec §1 / §2) on top of `LocoBlend`: hip bob (twice per
 * cycle) and hip roll, torso pitch per gait, arm follow-through when stopping, a pivot step on
 * a sharp reversal and small steps when turning on the spot. Everything from the sim's real
 * `speed` / `accel` and the drawn body's yaw; never from input.
 */

const DEG = Math.PI / 180;

export interface GaitShape {
  /** Hip bob amplitude (m, peak to rest, twice per cycle). */
  bob: number;
  /** Hip roll (rad, ± once per cycle). */
  hipRoll: number;
  /** Torso forward (rad). */
  torso: number;
}

/** §2 table (at stride gain 1; amplitudes scale linearly with the gain). */
export const GAIT_SHAPE: Record<Gait, GaitShape> = {
  sneak: { bob: 0.01, hipRoll: 1.5 * DEG, torso: 20 * DEG },
  walk: { bob: 0.025, hipRoll: 3 * DEG, torso: 3 * DEG },
  run: { bob: 0.05, hipRoll: 3 * DEG, torso: 10 * DEG },
  sprint: { bob: 0.05, hipRoll: 3 * DEG, torso: 15 * DEG },
};

/** Arms finish their swing for this long after the body stops (s). */
export const FOLLOW_THROUGH = 0.15;
/** Pivot step: reversal over this angle (rad) above this speed (m/s), for this long (s). */
export const PIVOT_ANGLE = 120 * DEG;
export const PIVOT_SPEED = 2;
export const PIVOT_TIME = 0.25;
/** Back lean during the pivot (rad, the braking cap). */
export const PIVOT_LEAN = 0.12;
/** Turning on the spot: steps start past 45° and take 2 steps per 90°. */
export const TURN_START = 45 * DEG;
export const TURN_STEPS_PER_RAD = 2 / (90 * DEG);

export interface LocoV2Out {
  /** Root lift (m; negative = down). */
  bob: number;
  /** Extra roll (rad) and pitch (rad, + forward). */
  roll: number;
  pitch: number;
  /** Gait phase to draw (follows the body, keeps going through follow-through / turn steps). */
  phase: number;
  /** Arm swing weight 0..1 (1 while moving, fading over the follow-through). */
  arms: number;
  /** Pivot step running. */
  pivot: boolean;
  /** Stepping on the spot. */
  turning: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Gait shape blended by the run weight (walk ↔ run / sprint), sneak as is. */
export function gaitShape(gait: Gait, run: number, sprint: number): GaitShape {
  if (gait === 'sneak') return GAIT_SHAPE.sneak;
  const w = GAIT_SHAPE.walk;
  const r = GAIT_SHAPE.run;
  const s = GAIT_SHAPE.sprint;
  return {
    bob: lerp(w.bob, r.bob, run),
    hipRoll: lerp(w.hipRoll, r.hipRoll, run),
    torso: lerp(lerp(w.torso, r.torso, run), s.torso, sprint),
  };
}

export class LocoV2 {
  private phase = 0;
  private stopT = Infinity;
  private cadence = 0;
  private pivotT = Infinity;
  private moveDir: number | undefined;
  private standYaw: number | undefined;
  private turnLeft = 0;

  /**
   * `loco` = this frame's LocoBlend pose, `moveDir` the direction of travel (rad, from the
   * sim velocity), `yaw` the drawn body yaw (rad).
   */
  update(loco: LocoPose, gait: Gait, moveDir: number, yaw: number, dt: number): LocoV2Out {
    const shape = gaitShape(gait, loco.run, loco.sprint);
    let arms = 1;
    let turning = false;
    if (loco.moving) {
      // Cadence (cycles/s) from the phase LocoBlend advanced: the stride rule stays theirs.
      if (dt > 0) this.cadence = ((loco.phase - this.phase + 1) % 1) / dt;
      this.phase = loco.phase;
      this.stopT = 0;
      this.standYaw = undefined;
      this.turnLeft = 0;
      // Pivot: the travel direction flips by > 120° at speed.
      if (this.moveDir !== undefined && loco.speed > PIVOT_SPEED) {
        if (Math.abs(wrap(moveDir - this.moveDir)) > PIVOT_ANGLE) this.pivotT = 0;
      }
      this.moveDir = moveDir;
    } else {
      this.moveDir = undefined;
      this.stopT += dt;
      if (this.stopT < FOLLOW_THROUGH) {
        // Follow-through: the arms finish the swing at a decaying cadence.
        const k = 1 - this.stopT / FOLLOW_THROUGH;
        this.phase = (this.phase + this.cadence * k * dt) % 1;
        arms = k;
      } else {
        arms = 0;
        // Turning on the spot: two small steps per 90° once the body is 45° off.
        if (this.standYaw === undefined) this.standYaw = yaw;
        const off = wrap(yaw - this.standYaw);
        if (Math.abs(off) > TURN_START && this.turnLeft <= 0) {
          this.turnLeft = Math.abs(off) * TURN_STEPS_PER_RAD * 0.5;
          this.standYaw = yaw;
        }
        if (this.turnLeft > 0) {
          const step = Math.min(this.turnLeft, 1.6 * dt);
          this.phase = (this.phase + step) % 1;
          this.turnLeft -= step;
          turning = true;
        }
      }
    }
    this.pivotT += dt;
    const pivot = this.pivotT < PIVOT_TIME;
    const g = loco.gain;
    const c = Math.cos(4 * Math.PI * this.phase);
    const live = loco.moving ? 1 : turning ? 0.3 : 0;
    return {
      bob: -shape.bob * g * live * 0.5 * (1 + c),
      roll: shape.hipRoll * g * live * Math.sin(2 * Math.PI * this.phase),
      pitch: (loco.moving ? shape.torso : 0) - (pivot ? PIVOT_LEAN : 0),
      phase: this.phase,
      arms,
      pivot,
      turning,
    };
  }
}
