/** Rodzaje definicji w paczce i odpowiadające im katalogi. */
export const CONTENT_TYPES = [
  'item',
  'recipe',
  'skill',
  'trait',
  'profession',
  'moodle',
  'lootTable',
  'zombieType',
  'containerType',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_FOLDERS: Record<ContentType, string> = {
  item: 'items',
  recipe: 'recipes',
  skill: 'skills',
  trait: 'traits',
  profession: 'professions',
  moodle: 'moodles',
  lootTable: 'loot-tables',
  zombieType: 'zombie-types',
  containerType: 'containers',
};

export const OVERRIDES_FOLDER = 'overrides';
export const MANIFEST_FILE = 'mod.json';
export const WORLD_SETTINGS_FILE = 'world-settings.json';
