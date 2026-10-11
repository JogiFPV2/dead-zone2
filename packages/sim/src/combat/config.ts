/**
 * Stage 4 combat tuning without data fields yet (docs 9.8). Weapon stats come from
 * `melee` of the item in `hand_primary`, zombie damage / cooldown / bite chance from
 * `zombieTypes`, infection chance per wound kind from `worldSettings.survival.wounds`.
 * Proposed data fields in the comments.
 */
export interface CombatConfig {
  /** `combat.unarmed`: bare-hands "weapon". */
  unarmed: {
    damage: { min: number; max: number };
    rangeTiles: number;
    attacksPerSec: number;
    staminaCost: number;
    knockback: number;
  };
  /** `combat.arcHalfDeg`: swing cone around the facing. */
  arcHalfDeg: number;
  /** `combat.exhaustedDamageMul`: endurance below the swing's cost → damage × this, cooldown ÷ this. */
  exhaustedDamageMul: number;
  /** `combat.critMul`: damage × this on a critical hit (`melee.critChance`). */
  critMul: number;
  /** `combat.shove`. */
  shove: {
    rangeTiles: number;
    cooldownSec: number;
    staminaCost: number;
  };
  /** `combat.attackNoise`: noise of a swing when the weapon has no `hitNoise`. */
  attackNoise: { radiusTiles: number; volume: number };
  /** `combat.zombie`: hit chance of a zombie attack and reach beyond the colliders. */
  zombie: { hitChance: number; reachTiles: number; windupSec: number };
  /** `combat.zombieWoundWeights`: non-bite wound kinds of a successful zombie hit. */
  zombieWoundWeights: { scratch: number; laceration: number };
  /** Snapshot `anim = attack` this long after a swing. */
  attackAnimSec: number;
  /** XP to the held item's melee skill per swing that hits (`meleeStatsFor(item).skill`). */
  meleeXpPerHit: number;
  /** Knock-back of items without a `melee` block (improvised weapons), like bare hands. */
  improvisedKnockback: number;
  /** `worldSettings.firearms` (data wins, see ai/state.ts). */
  firearms: {
    hitFalloffAtRange: number;
    spread: Record<'pistol' | 'revolver' | 'shotgun' | 'rifle', number>;
    spreadModifiers: {
      moving: number;
      running: number;
      exhaustion: number;
      fatigue: number;
      panic: number;
      max: number;
    };
    projectileRadiusTiles: number;
    magazineLoadSecPerRound: number;
    accuracyPerSkillLevel: number;
    reloadTimeReductionPerLevel: number;
    xpPerHit: number;
    xpPerReload: number;
  };
}

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  unarmed: {
    damage: { min: 1, max: 3 },
    rangeTiles: 0.8,
    attacksPerSec: 1.5,
    staminaCost: 1,
    knockback: 0.3,
  },
  arcHalfDeg: 60,
  exhaustedDamageMul: 0.5,
  critMul: 2,
  shove: { rangeTiles: 1.2, cooldownSec: 0.8, staminaCost: 4 },
  attackNoise: { radiusTiles: 4, volume: 0.3 },
  zombie: { hitChance: 0.7, reachTiles: 0.9, windupSec: 0.5 },
  zombieWoundWeights: { scratch: 0.6, laceration: 0.4 },
  attackAnimSec: 0.4,
  meleeXpPerHit: 1,
  improvisedKnockback: 0.3,
  firearms: {
    hitFalloffAtRange: 0.6,
    spread: { pistol: 0.03, revolver: 0.03, shotgun: 0.12, rifle: 0.015 },
    spreadModifiers: { moving: 0.8, running: 1, exhaustion: 0.6, fatigue: 0.4, panic: 0.6, max: 4 },
    projectileRadiusTiles: 0.15,
    magazineLoadSecPerRound: 0.4,
    accuracyPerSkillLevel: 0.04,
    reloadTimeReductionPerLevel: 0.04,
    xpPerHit: 2,
    xpPerReload: 1,
  },
};
