import type { Grip } from '../weapons/grip.js';

/**
 * Anim v2 P2 actions (anim-spec §2): shot recoil, reload, item use, draw / holster. Pure
 * timing + amplitudes here; `PlayerView` adds the result to the arm bones after the grip pose.
 */

const DEG = Math.PI / 180;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Shot: 0.12 s kick, then 0.25 s return. */
export const SHOT_KICK = 0.12;
export const SHOT_RETURN = 0.25;

/** Recoil envelope 0..1 at `t` s after the shot (0 before / after). */
export function shotEnvelope(t: number): number {
  if (!(t >= 0)) return 0;
  if (t < SHOT_KICK) return smooth(t / SHOT_KICK);
  return 1 - smooth((t - SHOT_KICK) / SHOT_RETURN);
}

/** Additive offsets on the bones (rad / m); unset = 0. */
export interface ActionOffsets {
  /** Right wrist pitched up (pistol kick). */
  wristR?: number;
  /** Right elbow bent more. */
  elbowR?: number;
  /** Right shoulder pushed back (m, long guns). */
  shoulderBackR?: number;
  /** Torso pitched back. */
  torso?: number;
  /** Left hand reaching to the belt (0 at the gun … 1 at the belt). */
  leftToBelt?: number;
  /** Left hand (held can / food) raised to the mouth 0..1. */
  leftToMouth?: number;
  /** Left forearm wrapped by the right hand (bandage) 0..1. */
  wrap?: number;
  /** Right hand reaching to the holster (`back` over the right shoulder, `belt`) 0..1. */
  holster?: number;
  holsterAt?: 'back' | 'belt';
}

/** Pistol: wrist 12°, elbow 8°; long guns (`rifle` grip, shotguns too): shoulder 6 cm back, torso 4°. */
export function shotOffsets(grip: Grip | undefined, t: number): ActionOffsets {
  const e = shotEnvelope(t);
  if (e === 0) return {};
  if (grip === 'rifle') return { shoulderBackR: 0.06 * e, torso: 4 * DEG * e };
  return { wristR: 12 * DEG * e, elbowR: 8 * DEG * e };
}

/**
 * Reload length (s) when the sim gives none: pistol 1.2 s, single-round (shotgun) 0.6 s per
 * round. The sim's `reload` event `untilTick` is the real timing.
 */
export function reloadDuration(single: boolean): number {
  return single ? 0.6 : 1.2;
}

/** Reload `k` 0..1: left hand to the belt (0–35 %), holds (–55 %), back to the gun (–100 %). */
export function reloadOffsets(k: number): ActionOffsets {
  if (!(k >= 0) || k >= 1) return {};
  const b = k < 0.35 ? smooth(k / 0.35) : k < 0.55 ? 1 : 1 - smooth((k - 0.55) / 0.45);
  return { leftToBelt: b };
}

export type UseKind = 'eat' | 'drink' | 'bandage';

/** Item use loop (s): eating / drinking 1.0 s, bandage 1.5 s. */
export const USE_LOOP: Record<UseKind, number> = { eat: 1.0, drink: 1.0, bandage: 1.5 };

/** Use pose at `t` s into the action: can to the mouth in a loop, or the bandage wrap. */
export function useOffsets(kind: UseKind, t: number): ActionOffsets {
  if (!(t >= 0)) return {};
  const ph = (t % USE_LOOP[kind]) / USE_LOOP[kind];
  const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
  const lift = smooth(t / 0.25);
  return kind === 'bandage' ? { wrap: lift * (0.6 + 0.4 * w) } : { leftToMouth: lift * w };
}

/** Draw 0.4 s, holster 0.35 s; the model switches at the midpoint. */
export const DRAW_TIME = 0.4;
export const HOLSTER_TIME = 0.35;

/** Two-handed items come off the back over the right shoulder, the rest from the belt. */
export function holsterAt(grip: Grip | undefined): 'back' | 'belt' {
  return grip === 'two_hand' || grip === 'spear' || grip === 'chainsaw' || grip === 'rifle'
    ? 'back'
    : 'belt';
}

export interface DrawState {
  /** 0..1 progress, 1 = done. */
  k: number;
  /** The new model is shown (second half). */
  swapped: boolean;
  offsets: ActionOffsets;
}

/** Draw / holster at `t` s: the hand goes to the holster, swaps the model halfway, returns. */
export function drawState(kind: 'draw' | 'holster', grip: Grip | undefined, t: number): DrawState {
  const d = kind === 'draw' ? DRAW_TIME : HOLSTER_TIME;
  const k = clamp01(t / d);
  if (k >= 1) return { k: 1, swapped: true, offsets: {} };
  return {
    k,
    swapped: k >= 0.5,
    offsets: { holster: Math.sin(Math.PI * k), holsterAt: holsterAt(grip) },
  };
}

/** Sum of offsets (numbers add, `holsterAt` from the last that sets it). */
export function addOffsets(...all: ActionOffsets[]): ActionOffsets {
  const out: ActionOffsets = {};
  for (const o of all)
    for (const [key, v] of Object.entries(o) as [keyof ActionOffsets, number | string][])
      if (typeof v === 'number')
        (out as Record<string, number>)[key] = ((out as Record<string, number>)[key] ?? 0) + v;
      else if (v !== undefined) out.holsterAt = v as 'back' | 'belt';
  return out;
}
