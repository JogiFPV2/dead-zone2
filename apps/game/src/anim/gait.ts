import { splitmix32 } from '@deadzone/sim';

/**
 * Per-zombie shamble parameters, fully determined by the gait seed (contract `gaitSeed`; until
 * the sim sends it, `gaitSeedOf(StableId)`), so every client draws the same zombie the same way.
 */
export interface Gait {
  /** Walk / run clip playback multiplier. */
  rate: number;
  /** Clip phase offset 0..1 (zombies don't step in sync). */
  phase: number;
  /** Side-to-side roll amplitude per step (rad). */
  swayAmp: number;
  /** Constant forward lean (rad). */
  lean: number;
  /** Limp -1..1: one step drops / rolls more than the other. */
  limp: number;
  /** Constant sideways tilt (rad, sign = side). */
  tilt: number;
  /** Heading wobble amplitude (rad) and frequency (Hz). */
  wobble: number;
  wobbleHz: number;
  /** Max turn rate (rad/s). */
  turnRate: number;
}

/** Steps per second of the walk clip at rate 1 (Quaternius walk: about 1 s per cycle). */
const STEP_HZ = 2;

export function gaitOf(seed: number): Gait {
  const r = splitmix32(seed | 0);
  const u = (): number => (r() >>> 0) / 0x1_0000_0000;
  const range = (a: number, b: number): number => a + (b - a) * u();
  return {
    rate: range(0.5, 0.85),
    phase: u(),
    swayAmp: range(0.04, 0.13),
    lean: range(0.04, 0.24),
    limp: range(-1, 1),
    tilt: range(-0.08, 0.08),
    wobble: range(0.04, 0.16),
    wobbleHz: range(0.2, 0.55),
    turnRate: range(2.5, 5),
  };
}

export interface GaitOffsets {
  /** Roll around the facing axis (rad). */
  roll: number;
  /** Forward lean (rad, + = forward). */
  pitch: number;
  /** Heading offset (rad). */
  yaw: number;
  /** Vertical bob (world units, at most 0). */
  bob: number;
}

/**
 * Body offsets of a shambling zombie at time `t` (s). `move` 0..1 blends idle swaying into the
 * full stagger-step. Pure; writes into `out`.
 */
export function gaitOffsets(g: Gait, t: number, move: number, out: GaitOffsets): GaitOffsets {
  const step = 2 * Math.PI * (STEP_HZ * g.rate * t + g.phase);
  const s = Math.sin(step / 2);
  // One step per half cycle: roll swings left / right, the limp side dips deeper.
  const limpDip = g.limp * Math.max(0, s);
  const amp = g.swayAmp * (0.35 + 0.65 * move);
  out.roll = g.tilt + amp * s + amp * 0.7 * limpDip;
  out.pitch = g.lean * (0.6 + 0.4 * move) + 0.03 * move * Math.abs(Math.sin(step));
  const w = 2 * Math.PI * g.wobbleHz * t + g.phase * 11;
  out.yaw = g.wobble * (Math.sin(w) + 0.5 * Math.sin(w * 2.3 + 1.7)) * (0.3 + 0.7 * move);
  out.bob = -move * (0.025 * Math.abs(Math.sin(step)) + 0.03 * Math.abs(limpDip));
  return out;
}
