import { TICKS_PER_SECOND } from '../core/constants.js';
import { dsincos } from '../vehicles/math.js';
import {
  CORNER_SPEED_MIN,
  PIVOT_SPEED_MPS,
  REVERSE_COS,
  TURN_RATE_MAX,
  TURN_SPEED_REF,
  type GaitProfile,
} from './constants.js';

/**
 * Character locomotion (players): velocity in polar form (direction + speed) with
 *
 * - a jerk-limited, overshoot-free speed curve per gait (`GaitProfile`): the acceleration builds
 *   up at `jerk`, is capped by `accel` / `brake` and tapers as √(2·jerk·Δv) near the target, so
 *   the speed lands on it without overshoot (critically damped);
 * - a movement turn rate that falls with speed (`TURN_RATE_MAX`, `TURN_SPEED_REF`), slower in a
 *   run and slower still in a sprint, and slows the target speed in a turn;
 * - reversals (input more than 120° off the direction): brake to `PIVOT_SPEED_MPS` first, then
 *   turn on the spot (180° goes through braking).
 *
 * Only + − × ÷, √ and the deterministic `dsincos`; results are f32. Units: m/s, m/s².
 */
const DT = 1 / TICKS_PER_SECOND;
const f = Math.fround;

export interface LocoOut {
  /** New velocity (m/s). */
  vx: number;
  vy: number;
  /** Acceleration state for the next tick (m/s², along the direction). */
  a: number;
  /** Realised longitudinal acceleration this tick (m/s²: Δspeed / dt). */
  accel: number;
}

/** Max turn rate of the movement direction at `speed` (rad/s, before inertia). */
export const turnRate = (speed: number): number => {
  const q = speed / TURN_SPEED_REF;
  return TURN_RATE_MAX / (1 + q * q);
};

/**
 * One tick: current velocity (vx, vy) and acceleration state `a`, target velocity (tx, ty)
 * (input direction × gait speed, already projected along walls), gait profile and the physics
 * inertia multiplier `mul` (load, endurance, mass; 0 = no control: nothing changes).
 */
export function locomotionStep(
  vx: number,
  vy: number,
  a: number,
  tx: number,
  ty: number,
  p: GaitProfile,
  mul: number,
  out: LocoOut,
): LocoOut {
  const s = Math.sqrt(vx * vx + vy * vy);
  if (mul <= 0) {
    out.vx = vx;
    out.vy = vy;
    out.a = 0;
    out.accel = 0;
    return out;
  }
  const sT = Math.sqrt(tx * tx + ty * ty);
  let dx = s > 0 ? vx / s : 0;
  let dy = s > 0 ? vy / s : 0;
  let target = sT;
  if (sT > 0) {
    const ux = tx / sT;
    const uy = ty / sT;
    if (s <= PIVOT_SPEED_MPS) {
      dx = ux;
      dy = uy;
    } else {
      const c = dx * ux + dy * uy;
      if (c < REVERSE_COS) {
        target = 0;
      } else {
        const cross = dx * uy - dy * ux;
        const max = turnRate(s) * mul * DT;
        // Angle still to turn: acos(c) without acos (compare cos values).
        const [sm, cm] = dsincos(max);
        if (c >= cm) {
          dx = ux;
          dy = uy;
        } else {
          const sg = cross < 0 ? -sm : sm;
          const nx = dx * cm - dy * sg;
          const ny = dx * sg + dy * cm;
          const n = Math.sqrt(nx * nx + ny * ny);
          dx = nx / n;
          dy = ny / n;
        }
        const left = dx * ux + dy * uy;
        target = sT * (CORNER_SPEED_MIN + (1 - CORNER_SPEED_MIN) * (left > 0 ? left : 0));
      }
    }
  }
  const delta = target - s;
  const jerk = p.jerk * mul;
  let aNext: number;
  let sNew: number;
  if (delta === 0) {
    aNext = 0;
    sNew = s;
  } else {
    const limit = (delta > 0 ? p.accel : p.brake) * mul;
    const mag = Math.min(limit, Math.sqrt(2 * jerk * Math.abs(delta)));
    const want = delta > 0 ? mag : -mag;
    // Builds up at `jerk`, falls back towards 0 (or flips) twice as fast.
    const rate = (want > 0 ? a < want && a >= 0 : a > want && a <= 0) ? jerk : 2 * jerk;
    const step = rate * DT;
    aNext = a < want ? Math.min(want, a + step) : Math.max(want, a - step);
    sNew = s + aNext * DT;
    if ((delta > 0 && sNew >= target) || (delta < 0 && sNew <= target)) {
      sNew = target;
      aNext = 0;
    }
  }
  if (sNew <= 0) {
    sNew = 0;
    if (aNext < 0) aNext = 0;
  }
  out.vx = f(dx * sNew);
  out.vy = f(dy * sNew);
  out.a = f(aNext);
  out.accel = f((sNew - s) / DT);
  return out;
}

/**
 * Removes the components of (x, y) going into the contact normals `n` (flat nx, ny pairs, unit,
 * pointing out of the obstacles): sliding along walls keeps the tangential part unchanged; two
 * opposing contacts (an inner corner) leave nothing. Writes the result into `out`.
 */
export function projectOnContacts(
  x: number,
  y: number,
  n: readonly number[],
  out: { x: number; y: number },
): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n.length; i += 2) {
      const d = x * n[i]! + y * n[i + 1]!;
      if (d < 0) {
        x -= d * n[i]!;
        y -= d * n[i + 1]!;
      }
    }
  }
  for (let i = 0; i < n.length; i += 2) {
    if (x * n[i]! + y * n[i + 1]! < -1e-6) {
      x = 0;
      y = 0;
      break;
    }
  }
  out.x = x;
  out.y = y;
}
