import type { NumberRange } from '../schemas/common/index.js';
import type { MeleeDamageType } from '../schemas/item/improvised-weapon.js';

/** Skąd są statystyki: broń z katalogu, blok `improvisedWeapon` albo wartości domyślne z wagi. */
export type MeleeStatsSource = 'weapon' | 'improvised' | 'default';

/**
 * Statystyki ataku wręcz dowolnego przedmiotu w ręku. Jednostki jak w `melee` katalogu broni:
 * `damage` w punktach HP, `rangeTiles` w kaflach (1 m), `attackSpeed` = ataki na sekundę (czas
 * rzeczywisty, poziom 0), `durability` = punkty trwałości, `breakChancePct` = szansa 0–100 na utratę
 * punktu trwałości przy trafieniu, `skill` = umiejętność dostająca XP.
 */
export interface MeleeStatsView {
  readonly damage: Readonly<NumberRange>;
  readonly rangeTiles: number;
  readonly attackSpeed: number;
  readonly durability: number;
  readonly breakChancePct: number;
  readonly skill: string;
  readonly twoHanded: boolean;
  readonly damageType: MeleeDamageType;
  readonly staminaCost: number;
  readonly critChance: number;
  readonly source: MeleeStatsSource;
}
