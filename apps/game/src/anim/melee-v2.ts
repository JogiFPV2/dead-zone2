import type { Grip } from '../weapons/grip.js';

/**
 * Anim v2 melee attack (anim-spec §2): length per weapon (one-handed 0.45 s, two-handed 0.7 s,
 * knife thrust 0.35 s) split into wind-up 35 %, strike 15 %, recovery 50 %; the sim's hit
 * (`physics` `hitLanded` with this attacker as `source`) lands on the end of the strike.
 */

export const WINDUP = 0.35;
export const STRIKE = 0.15;
/** Progress at the end of the strike (where the hit lands). */
export const IMPACT = WINDUP + STRIKE;

/** Attack length (s) for a grip; unarmed swings like a one-handed weapon. */
export function meleeDuration(grip: Grip | undefined): number {
  switch (grip) {
    case 'knife':
      return 0.35;
    case 'two_hand':
    case 'spear':
    case 'chainsaw':
      return 0.7;
    default:
      return 0.45;
  }
}

export type MeleePhase = 'windup' | 'strike' | 'recover';

export function meleePhase(progress: number): MeleePhase {
  if (progress < WINDUP) return 'windup';
  if (progress < IMPACT) return 'strike';
  return 'recover';
}

/**
 * Attack progress 0..1 from the time since the attack started (s). With the hit time known
 * (s since the start), the timeline is shifted so the hit sits exactly on `IMPACT`.
 */
export function meleeProgress(elapsed: number, duration: number, hitAt?: number): number {
  const t = hitAt === undefined ? elapsed : elapsed - hitAt + IMPACT * duration;
  return Math.max(0, Math.min(1, t / duration));
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Hand extension of the blow (−0.3 pulled back … 1 full reach): wind-up pulls back, the
 * strike snaps out to full reach at the impact, the recovery returns to guard.
 */
export function meleeExtension(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  if (p < WINDUP) return -0.3 * smooth(p / WINDUP);
  if (p < IMPACT) return -0.3 + 1.3 * smooth((p - WINDUP) / STRIKE);
  return 1 - smooth((p - IMPACT) / (1 - IMPACT));
}
