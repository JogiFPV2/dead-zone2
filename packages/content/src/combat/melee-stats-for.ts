import type { DeepReadonly } from '../bundle/deep-freeze.js';
import type { Item } from '../schemas/item/item.js';
import type { ImprovisedWeapon } from '../schemas/item/improvised-weapon.js';
import type { WeaponMeleeItem } from '../schemas/item/weapon-melee.js';
import {
  IMPROVISED_DEFAULTS,
  IMPROVISED_SKILL,
  defaultMeleeStats,
  staminaFromWeight,
} from './improvised-defaults.js';
import type { MeleeStatsView } from './melee-stats-view.js';

const SHARP_SKILLS = new Set(['base:blade-short', 'base:blade-long', 'base:spear']);

function fromWeapon(item: DeepReadonly<WeaponMeleeItem>): MeleeStatsView {
  const m = item.melee;
  return {
    damage: { min: m.damage.min, max: m.damage.max },
    rangeTiles: m.rangeTiles,
    attackSpeed: m.attacksPerSec,
    durability: m.durability.max,
    breakChancePct: Math.round(m.durability.lossChancePerUse * 1000) / 10,
    skill: m.skill,
    twoHanded: m.twoHanded,
    damageType: SHARP_SKILLS.has(m.skill) ? 'sharp' : 'blunt',
    staminaCost: m.staminaCost,
    critChance: m.critChance,
    source: 'weapon',
  };
}

function fromImprovised(b: DeepReadonly<ImprovisedWeapon>, weightKg: number): MeleeStatsView {
  return {
    damage: { min: b.damage.min, max: b.damage.max },
    rangeTiles: b.rangeTiles,
    attackSpeed: b.attackSpeed,
    durability: b.durability,
    breakChancePct: b.breakChancePct,
    skill: b.skill ?? IMPROVISED_SKILL[b.damageType],
    twoHanded: b.twoHanded,
    damageType: b.damageType,
    staminaCost: b.staminaCost ?? staminaFromWeight(weightKg),
    critChance: IMPROVISED_DEFAULTS.critChance,
    source: 'improvised',
  };
}

/** Przedmiot nieraniący (`harmless`): zamach bez obrażeń, bez zużycia i bez XP. */
function harmlessStats(weightKg: number): MeleeStatsView {
  return {
    ...defaultMeleeStats(weightKg),
    damage: { min: 0, max: 0 },
    breakChancePct: 0,
    critChance: 0,
    twoHanded: false,
  };
}

/**
 * Statystyki ataku wręcz przedmiotu w ręku: broń biała z katalogu (`melee`), blok
 * `improvisedWeapon`, a dla reszty (też broń palna jako pałka) słabe wartości domyślne z wagi.
 */
export function meleeStatsFor(item: Item | DeepReadonly<Item>): MeleeStatsView {
  if (item.kind === 'weapon_melee') return fromWeapon(item);
  if (item.harmless) return harmlessStats(item.weightKg);
  if (item.improvisedWeapon) return fromImprovised(item.improvisedWeapon, item.weightKg);
  return defaultMeleeStats(item.weightKg);
}
