import type { CombatView, MeleeWeaponView } from '@deadzone/protocol';

/**
 * Weapon panel for a held non-firearm item (sim contract docs/sim-architecture.md 9.41, Designer
 * notes 11.10): icon, name, a grey tag (IMPROWIZOWANA / PRZEDMIOT), OBURĄCZ chip and the
 * durability bar (red below 25 %). Pure view model of `CombatView.melee`.
 */

/** Durability below this (%) turns the bar red. */
export const MELEE_LOW_PCT = 25;
/** Broken weapon: grey + shake of the icon (ms). */
export const WEAPON_BROKE_MS = 600;

export type DurabilityLevel = 'ok' | 'mid' | 'low';

export interface MeleeVM {
  weapon: string;
  name: string;
  source: Exclude<MeleeWeaponView['source'], 'unarmed'>;
  /** IMPROWIZOWANA (improvised), PRZEDMIOT (default from weight); none for catalogue weapons. */
  tag?: string;
  twoHanded: boolean;
  /** 0..100; undefined = the item does not wear. */
  conditionPct?: number;
  level: DurabilityLevel;
  /** „OBR 2–4 · 1,2/s · 1,1 m” (tooltip). */
  stats: string;
}

const TAGS: Partial<Record<MeleeWeaponView['source'], string>> = {
  improvised: 'IMPROWIZOWANA',
  default: 'PRZEDMIOT',
};

export function durabilityLevel(pct: number): DurabilityLevel {
  if (pct < MELEE_LOW_PCT) return 'low';
  return pct <= 50 ? 'mid' : 'ok';
}

const num = (n: number, digits = 1): string =>
  (Math.round(n * 10 ** digits) / 10 ** digits).toString().replace('.', ',');

function conditionOf(c: CombatView, m: MeleeWeaponView): number | undefined {
  if (m.conditionPct !== undefined) return Math.max(0, Math.min(100, Math.round(m.conditionPct)));
  if (c.condition !== null && c.maxCondition) {
    return Math.max(0, Math.min(100, Math.round((100 * c.condition) / c.maxCondition)));
  }
  return undefined;
}

/**
 * Panel VM: an item (any non-firearm) in the active hand. Undefined for bare hands, a firearm
 * (no `melee`) or no combat view yet.
 */
export function meleeVM(
  c: CombatView | undefined,
  name: (id: string) => string,
  /** Content `melee.category` of a catalogue weapon (stone, brick: `improvised`). */
  category?: (id: string) => string | undefined,
): MeleeVM | undefined {
  const m = c?.melee;
  if (!c || !m || m.source === 'unarmed' || !c.weapon) return undefined;
  const conditionPct = conditionOf(c, m);
  // Harmless items (tissue, clothing, bandage: `harmless`) only push.
  const tag =
    m.damage.max <= 0
      ? 'NIE RANI'
      : m.source === 'weapon' && category?.(c.weapon) === 'improvised'
        ? TAGS.improvised
        : TAGS[m.source];
  return {
    weapon: c.weapon,
    name: name(c.weapon),
    source: m.source,
    ...(tag ? { tag } : {}),
    twoHanded: m.twoHanded,
    ...(conditionPct !== undefined ? { conditionPct } : {}),
    level: durabilityLevel(conditionPct ?? 100),
    stats: `OBR ${num(m.damage.min)}–${num(m.damage.max)} · ${num(m.attacksPerSec)}/s · ${num(m.rangeTiles)} m`,
  };
}
