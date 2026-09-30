import type { ContentType } from '../schemas/content-type.js';
import type { ContentError } from '../validate/errors.js';
import { formatError } from '../validate/format.js';
import type { PackSource } from '../validate/pack-source.js';
import { validatePacks, type ValidationResult } from '../validate/validate-packs.js';
import type { ContentBundle } from './content-bundle.js';
import { deepFreeze } from './deep-freeze.js';

/** Klucz w `ContentBundle` dla każdego typu definicji. */
export const BUNDLE_KEYS = {
  item: 'items',
  recipe: 'recipes',
  skill: 'skills',
  trait: 'traits',
  profession: 'professions',
  moodle: 'moodles',
  lootTable: 'lootTables',
  zombieType: 'zombieTypes',
  containerType: 'containers',
  tile: 'tiles',
  gameMode: 'gameModes',
} as const satisfies Record<ContentType, keyof ContentBundle>;

export class ContentValidationError extends Error {
  readonly errors: readonly ContentError[];
  constructor(errors: readonly ContentError[]) {
    const head = errors.slice(0, 10).map(formatError).join('\n');
    const more = errors.length > 10 ? `\n… i ${errors.length - 10} kolejnych` : '';
    super(`Content nie przeszedł walidacji (${errors.length} błędów):\n${head}${more}`);
    this.name = 'ContentValidationError';
    this.errors = errors;
  }
}

/** Zamienia wynik walidacji na zamrożony `ContentBundle` (bez sprawdzania `ok`). */
export function toContentBundle(result: ValidationResult): ContentBundle {
  const record = result.content.toRecord();
  const bundle: Record<string, unknown> = {
    worldSettings: structuredClone(result.worldSettings),
    mods: structuredClone(result.loadOrder),
  };
  for (const [type, key] of Object.entries(BUNDLE_KEYS)) {
    bundle[key] = structuredClone(record[type as ContentType]);
  }
  return deepFreeze(bundle) as unknown as ContentBundle;
}

/**
 * Waliduje paczki, łączy mody w kolejności wczytywania i zwraca zamrożony bundle.
 * Rzuca `ContentValidationError`, jeśli jest choć jeden błąd.
 */
export function buildContentBundle(packs: readonly PackSource[]): ContentBundle {
  const result = validatePacks(packs);
  if (!result.ok) throw new ContentValidationError(result.errors);
  return toContentBundle(result);
}
