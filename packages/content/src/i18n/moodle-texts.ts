/**
 * Polish texts of moodles (name and level labels) keyed by moodle id. The content carries only
 * i18n keys (`moodle.base.dirty.level-1`); until language packs ship texts the HUD and the sim
 * can take them from here. Index 0 of `levels` = level 1.
 */
export const MOODLE_TEXTS_PL = {
  'base:dirty': {
    name: 'Brud',
    levels: ['Brudny', 'Bardzo brudny', 'Umorusany', 'Cuchnący'],
  },
} as const satisfies Record<string, { name: string; levels: readonly string[] }>;

const lookup = (
  id: string,
): { readonly name: string; readonly levels: readonly string[] } | undefined =>
  (MOODLE_TEXTS_PL as Readonly<Record<string, { name: string; levels: readonly string[] }>>)[id];

/** Polish name of a moodle; undefined when there is no text yet. */
export const moodleNamePl = (id: string): string | undefined => lookup(id)?.name;

/** Polish label of moodle level `level` (1-based); undefined when there is no text yet. */
export const moodleLevelPl = (id: string, level: number): string | undefined =>
  lookup(id)?.levels[level - 1];
