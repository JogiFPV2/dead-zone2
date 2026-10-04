import { TICKS_PER_SECOND } from '../core/constants.js';
import { atan2Bam } from '../core/dmath.js';
import type { VehicleTypeDef } from '../content/adapter.js';
import type { VehicleConfig } from './config.js';
import { dsincos, dtan } from './math.js';
import type { Vehicle } from './types.js';

const DT = 1 / TICKS_PER_SECOND;
const TWO_PI = 6.283185307179586;
const f = Math.fround;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Extra per-vehicle factors (damage, PR B): engine power and a steady steering pull. */
export interface DriveMods {
  powerMul: number;
  /** Steering offset −1..1 added to the wheels (a flat tyre pulls to its side). */
  pull: number;
  /** Tyre grip factor 0..1 (flat tyres). */
  gripMul: number;
}
export const NO_MODS: DriveMods = { powerMul: 1, pull: 0, gripMul: 1 };

/**
 * One tick of the driving model (arcade bicycle model with tyre slip): velocity lives in the
 * world frame; engine, brakes and drag act along the nose, the tyres remove the sideways part
 * of the velocity up to the grip limit (less at speed, much less on the rear with the
 * handbrake: the car slides), and the yaw rate follows the kinematic rate
 * v · tan(δ) / wheelbase, limited by front grip. Moves the car by its velocity (collisions are
 * resolved afterwards, `collide.ts`). Pure, deterministic (only + − × ÷ and `dsincos`).
 */
export function driveStep(v: Vehicle, t: VehicleTypeDef, cfg: VehicleConfig, mods = NO_MODS): void {
  const hx = v.hx;
  const hy = v.hy;
  // Local velocity: along the nose and towards the right side (−hy, hx).
  let vLong = v.vx * hx + v.vy * hy;
  let vLat = -v.vx * hy + v.vy * hx;
  const spd = Math.sqrt(vLong * vLong + vLat * vLat);
  const gripMul = mods.gripMul / (1 + spd / cfg.gripFalloffMs);
  const grip = cfg.gripAccel * gripMul;

  // Steering follows the input at a limited rate; less lock at speed.
  const step = cfg.steerRatePerSec * DT;
  v.steer = f(clamp(v.steer + clamp(v.steerInput - v.steer, -step, step), -1, 1));
  const steer = clamp(v.steer + mods.pull, -1, 1);
  const delta = (steer * cfg.maxSteerRad) / (1 + Math.abs(vLong) / cfg.steerFalloffMs);

  // Longitudinal: engine (power-limited, traction-limited), brake / reverse, handbrake, drag.
  let a = 0;
  const running = v.engineOn && v.fuel > 0;
  if (running && v.throttle > 0) {
    if (vLong < -cfg.stopSpeed)
      a += cfg.brakeDecel * v.throttle; // throttle while reversing brakes
    else if (vLong < t.maxSpeed) {
      const power = (t.enginePower * 1000 * cfg.drivetrainEff * mods.powerMul) / t.mass;
      a += Math.min(power / Math.max(vLong, cfg.minPowerSpeed), grip) * v.throttle;
    }
  }
  if (v.brake > 0) {
    if (vLong > cfg.stopSpeed) a -= cfg.brakeDecel * v.brake;
    else if (running && v.throttle === 0 && vLong > -cfg.reverseMaxSpeed)
      a -= cfg.reverseAccel * v.brake;
    // Rolling backwards too fast, or without a running engine (a bounce, a dead engine): brake.
    else if (vLong < -cfg.reverseMaxSpeed || (!running && vLong < -cfg.stopSpeed))
      a += cfg.brakeDecel * v.brake;
  }
  const resist = cfg.rolling + cfg.drag * vLong * vLong + (v.handbrake ? cfg.handbrakeDecel : 0);
  const before = vLong;
  vLong += a * DT;
  // Resistance only slows down, never reverses the car.
  const r = resist * DT;
  vLong = vLong > r ? vLong - r : vLong < -r ? vLong + r : a === 0 ? 0 : vLong;
  // Braking stops the car; it does not reverse it in the same tick.
  if ((before > cfg.stopSpeed && vLong < 0) || (before < -cfg.stopSpeed && vLong > 0)) vLong = 0;

  // Lateral: tyres remove the sideways velocity up to the grip limit.
  const rear = v.handbrake ? cfg.handbrakeGrip : 1;
  const remove = Math.min(
    Math.abs(vLat) * Math.min(1, cfg.lateralGripPerSec * rear * gripMul * DT),
    grip * rear * DT,
  );
  vLat = vLat > 0 ? vLat - remove : vLat + remove;

  // Yaw: kinematic rate limited by front grip (understeer), more with the handbrake.
  let target = (vLong * dtan(delta)) / t.wheelbase;
  if (v.handbrake) target *= cfg.handbrakeYawMul;
  const maxYaw = grip / Math.max(Math.abs(vLong), 1);
  target = clamp(
    target,
    -maxYaw * (v.handbrake ? cfg.handbrakeYawMul : 1),
    maxYaw * (v.handbrake ? cfg.handbrakeYawMul : 1),
  );
  v.angVel = f(v.angVel + (target - v.angVel) * cfg.yawResponse);
  if (Math.abs(vLong) < 0.05 && Math.abs(vLat) < 0.05) v.angVel = 0;

  // Back to the world frame with the old heading (inertia), then turn the nose.
  v.vx = f(vLong * hx - vLat * hy);
  v.vy = f(vLong * hy + vLat * hx);
  const [s, c] = dsincos(v.angVel * DT);
  let nx = hx * c - hy * s;
  let ny = hx * s + hy * c;
  const n = Math.sqrt(nx * nx + ny * ny);
  nx /= n;
  ny /= n;
  v.hx = f(nx);
  v.hy = f(ny);
  v.heading = atan2Bam(v.hy, v.hx);
  v.x = f(v.x + v.vx * DT);
  v.y = f(v.y + v.vy * DT);

  // Derived view state.
  v.speed = f(vLong);
  const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
  v.slip = f(clamp(Math.abs(vLat) / Math.max(sp, 2), 0, 1));
  let spin = v.wheelSpin + (vLong * DT) / t.wheelRadius;
  spin -= Math.floor(spin / TWO_PI) * TWO_PI;
  v.wheelSpin = f(spin);
  const aLong = (vLong - before) / DT;
  const aLat = vLong * v.angVel;
  const pitch = clamp(aLong / 40, -0.4, 0.4);
  const roll = clamp(aLat / 40, -0.4, 0.4);
  // Braking dips the nose (front compresses), turning right loads the left side.
  v.susp[0] = f(clamp(0.5 - pitch + roll, 0, 1));
  v.susp[1] = f(clamp(0.5 - pitch - roll, 0, 1));
  v.susp[2] = f(clamp(0.5 + pitch + roll, 0, 1));
  v.susp[3] = f(clamp(0.5 + pitch - roll, 0, 1));

  // Fuel: consumption at full throttle, idle share when the engine just runs.
  if (running) {
    const use = t.consumption * (cfg.idleConsumption + (1 - cfg.idleConsumption) * v.throttle) * DT;
    v.fuel = f(Math.max(0, v.fuel - use));
  }
}
