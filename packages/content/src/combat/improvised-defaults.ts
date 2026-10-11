import type { MeleeDamageType } from '../schemas/item/improvised-weapon.js';
import type { MeleeStatsView } from './melee-stats-view.js';

/** Umiejętność dostająca XP wg rodzaju obrażeń (jak improwizowana broń z katalogu). */
export const IMPROVISED_SKILL: Readonly<Record<MeleeDamageType, string>> = {
  blunt: 'base:blunt',
  sharp: 'base:blade-short',
};

/** Słabe wartości dla przedmiotu bez bloku `improvisedWeapon`, skalowane wagą. */
export const IMPROVISED_DEFAULTS = {
  rangeTiles: 0.6,
  durability: 10,
  breakChancePct: 30,
  critChance: 0.02,
  /** Od tej wagi (kg) przedmiot trzyma się oburącz. */
  twoHandedFromKg: 5,
  maxDamage: 6,
} as const;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Koszt staminy zamachu z wagi (skala katalogu: kamień 1,5, kij bejsbolowy 4,5). */
export const staminaFromWeight = (weightKg: number): number =>
  round1(Math.min(1 + 0.8 * weightKg, 6));

/** Domyślne statystyki: cięższy = mocniej, ale wolniej; zawsze słabiej od prawdziwej broni. */
export function defaultMeleeStats(weightKg: number): MeleeStatsView {
  const w = Math.max(0, weightKg);
  const max = round1(Math.min(2 + w, IMPROVISED_DEFAULTS.maxDamage));
  const min = round1(Math.min(1 + 0.5 * w, max));
  return {
    damage: { min, max },
    rangeTiles: IMPROVISED_DEFAULTS.rangeTiles,
    attackSpeed: round1(Math.max(0.4, 1.3 - 0.1 * w)),
    durability: IMPROVISED_DEFAULTS.durability,
    breakChancePct: IMPROVISED_DEFAULTS.breakChancePct,
    skill: IMPROVISED_SKILL.blunt,
    twoHanded: w >= IMPROVISED_DEFAULTS.twoHandedFromKg,
    damageType: 'blunt',
    staminaCost: staminaFromWeight(w),
    critChance: IMPROVISED_DEFAULTS.critChance,
    source: 'default',
  };
}
