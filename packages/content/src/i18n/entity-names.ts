/**
 * Polish display names of creatures and vehicles (base pack), keyed by content id. The content
 * types carry only i18n keys (`zombie.base.walker.name`); until language packs ship texts the sim
 * uses this table for the HUD target card (`TargetView.name`). Unknown ids: `entityNamePl`
 * falls back to the id without the namespace.
 */
export const ENTITY_NAMES_PL = {
  zombie: {
    'base:walker': 'Zombie',
  },
  animal: {
    'base:bird': 'Ptak',
    'base:cat': 'Kot',
    'base:deer': 'Sarna',
    'base:dog': 'Pies',
    'base:rabbit': 'Królik',
    'base:squirrel': 'Wiewiórka',
  },
  vehicle: {
    'base:sedan': 'Sedan',
  },
} as const satisfies Record<'zombie' | 'animal' | 'vehicle', Record<string, string>>;

export type EntityNameKind = keyof typeof ENTITY_NAMES_PL;

/** Polish name of a zombie / animal / vehicle type; fallback `base:foo-bar` → `foo bar`. */
export function entityNamePl(kind: EntityNameKind, typeId: string): string {
  const names: Readonly<Record<string, string>> = ENTITY_NAMES_PL[kind];
  return names[typeId] ?? typeId.replace(/^[^:]*:/, '').replace(/-/g, ' ');
}
