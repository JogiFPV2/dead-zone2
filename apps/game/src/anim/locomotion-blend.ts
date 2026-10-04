import type { Gait } from '@deadzone/protocol';

/**
 * Player locomotion blend from the sim's movement fields (protocol v13: `speed` m/s after
 * collisions, `accel` m/s² along the motion, `gait` profile):
 * - one shared gait phase (cycles) drives both the walk and the run clip, so blending between
 *   them never jumps a foot,
 * - the step length (`gain`: stride scale of the leg swing) and the cadence follow the real
 *   speed together: cadence · stride = speed, so the planted foot stays put at any speed,
 *   including while braking (the phase slows down with the body),
 * - walk ↔ run blend by speed, crouch for sneaking, sprint pose (deeper lean, longer stride,
 *   arms pumping), lean from `accel` (forward speeding up, back braking), roll into turns.
 * 1 tile = 1 m, so m/s = tiles/s. Pure; `apps/game/src/anim/leg-pose.ts` applies the bones.
 */

/** A locomotion clip: ground speed of its stance foot at rate 1 and the phase of left contact. */
export interface LocoClip {
  /** Body speed (m/s) the clip covers at playback rate 1 and stride gain 1 (character 1.6 m). */
  speed: number;
  /** Clip length (s). */
  duration: number;
  /** Clip time fraction where the left foot touches down (phase 0 of the shared cycle). */
  leftContact: number;
}

// Measured on quaternius-characters/casual.glb scaled to PLAYER_HEIGHT (locomotion-blend.test.ts
// re-measures them from the model and fails when they drift).
export const WALK_CLIP: LocoClip = { speed: 1.15, duration: 1.333, leftContact: 0.92 };
export const RUN_CLIP: LocoClip = { speed: 2.57, duration: 0.792, leftContact: 0.29 };

/** Sim profile speeds (m/s, `movement-settings`): reference for the sprint / sneak poses. */
export const GAIT_SPEED: Record<Gait, number> = {
  sneak: 0.75,
  walk: 1.5,
  run: 3.75,
  sprint: 4.875,
};

/** Walk → run blend over this real-speed band (m/s). */
const BLEND_FROM = 2.1;
const BLEND_TO = 3.2;
/** Below this the body stands (m/s). */
export const STAND_SPEED = 0.2;
/** Stride gain limits (leg swing scale): short shuffling steps … long sprint strides. */
const GAIN_MIN = 0.6;
const GAIN_MAX = 1.35;
/** Smoothing (1/s) of crouch / sprint / lean / roll. */
const POSE_RATE = 7;
const SPEED_RATE = 14;
/** Lean per m/s² of `accel` (rad) and its limits (forward, back). */
const ACCEL_LEAN = 0.03;
const MAX_LEAN_FWD = 0.16;
const MAX_LEAN_BACK = 0.12;
/** Share of the physical banking angle atan(v·ω / g) the body rolls into a turn. */
const TURN_BANK = 0.7;
const MAX_BANK = 0.22;
/** Extra forward pitch of the sprint pose (rad). */
const SPRINT_PITCH = 0.16;

export interface LocoInput {
  /** Real ground speed (m/s). */
  speed: number;
  /** Longitudinal acceleration (m/s², + speeding up). */
  accel: number;
  gait: Gait;
  /** Turn rate of the drawn body (rad/s, + = towards +y). */
  yawRate: number;
  dt: number;
}

export interface LocoPose {
  /** Shared gait phase in cycles (0..1, 0 = left contact). */
  phase: number;
  /** Run clip weight (walk = 1 − run). */
  run: number;
  /** Stride gain of the leg / arm swing. */
  gain: number;
  /** Crouch 0..1 (sneak), sprint 0..1. */
  crouch: number;
  sprint: number;
  /** Forward pitch (rad, + forward) and roll into the turn (rad, + = right side down). */
  pitch: number;
  roll: number;
  /** Smoothed real speed (m/s); `moving` above STAND_SPEED. */
  speed: number;
  moving: boolean;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const smooth01 = (v: number): number => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};
const toward = (v: number, target: number, rate: number, dt: number): number =>
  v + (target - v) * (1 - Math.exp(-rate * dt));

/** Clip time (s) of `clip` at shared phase `phase`. */
export const clipTime = (clip: LocoClip, phase: number): number =>
  ((((phase + clip.leftContact) % 1) + 1) % 1) * clip.duration;

/** Stride gain for a speed on a clip: half the speed change goes into stride, half into cadence. */
export const strideGain = (clip: LocoClip, speed: number): number =>
  clamp(Math.sqrt(Math.max(speed, 1e-3) / clip.speed), GAIN_MIN, GAIN_MAX);

export class LocoBlend {
  readonly pose: LocoPose = {
    phase: 0,
    run: 0,
    gain: 1,
    crouch: 0,
    sprint: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    moving: false,
  };

  update(i: LocoInput): LocoPose {
    const p = this.pose;
    const dt = Math.max(0, i.dt);
    p.speed = toward(p.speed, Math.max(0, i.speed), SPEED_RATE, dt);
    const v = p.speed;
    p.moving = v > STAND_SPEED;
    // Clip mix by real speed: a run order still starts with walking steps while accelerating.
    p.run = i.gait === 'sneak' ? 0 : smooth01((v - BLEND_FROM) / (BLEND_TO - BLEND_FROM));
    const sprintTarget =
      i.gait === 'sprint'
        ? smooth01((v - GAIT_SPEED.run) / (GAIT_SPEED.sprint - GAIT_SPEED.run) + 0.35)
        : 0;
    p.sprint = toward(p.sprint, sprintTarget, POSE_RATE, dt);
    p.crouch = toward(p.crouch, i.gait === 'sneak' ? 1 : 0, POSE_RATE, dt);
    // Stride length of the blend; cadence = speed / stride, so cadence × stride = speed.
    const gw = strideGain(WALK_CLIP, v);
    const gr = strideGain(RUN_CLIP, v) * (1 + 0.08 * p.sprint);
    p.gain = gw + (Math.min(gr, GAIN_MAX) - gw) * p.run;
    const stride =
      WALK_CLIP.speed * WALK_CLIP.duration * gw * (1 - p.run) +
      RUN_CLIP.speed * RUN_CLIP.duration * Math.min(gr, GAIN_MAX) * p.run;
    if (p.moving) p.phase = (p.phase + (v / stride) * dt) % 1;
    const lean = clamp(i.accel * ACCEL_LEAN, -MAX_LEAN_BACK, MAX_LEAN_FWD);
    // Whole-body pitch: lean + sprint; the crouch bends the spine instead (leg-pose.ts).
    p.pitch = toward(p.pitch, lean + SPRINT_PITCH * p.sprint, POSE_RATE, dt);
    const bank = clamp(TURN_BANK * Math.atan((v * i.yawRate) / 9.81), -MAX_BANK, MAX_BANK);
    p.roll = toward(p.roll, p.moving ? bank : 0, POSE_RATE, dt);
    return p;
  }
}
