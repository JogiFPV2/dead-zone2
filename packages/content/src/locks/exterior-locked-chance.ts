import type { LocksSettings } from '../schemas/locks-settings.js';

type LockChances = Pick<LocksSettings, 'exteriorLockedChance' | 'exteriorLockedChanceByBuilding'>;

/**
 * Szansa, że drzwi zewnętrzne budynku rodzaju `buildingKind` (albo brama, `gate`) są na starcie
 * zamknięte na klucz: wpis z `exteriorLockedChanceByBuilding`, a dla rodzaju spoza mapy (i gdy
 * rodzaj nieznany) — `exteriorLockedChance`.
 */
export function exteriorLockedChanceFor(
  settings: LockChances,
  buildingKind: string | undefined,
): number {
  const byKind: Readonly<Record<string, number | undefined>> =
    settings.exteriorLockedChanceByBuilding ?? {};
  const hit = buildingKind === undefined ? undefined : byKind[buildingKind];
  return hit ?? settings.exteriorLockedChance;
}
