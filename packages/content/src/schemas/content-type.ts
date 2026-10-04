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
  'animalType',
  'containerType',
  'tile',
  'gameMode',
  'station',
  'appearancePart',
  'palette',
  'tag',
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
  animalType: 'animal-types',
  containerType: 'containers',
  tile: 'tiles',
  gameMode: 'game-modes',
  station: 'stations',
  appearancePart: 'appearance-parts',
  palette: 'palettes',
  tag: 'tags',
};

export const OVERRIDES_FOLDER = 'overrides';
export const MANIFEST_FILE = 'mod.json';
export const WORLD_SETTINGS_FILE = 'world-settings.json';
/** Opcjonalne fragmenty ustawień świata (głęboki merge po `world-settings.json`). */
export const WORLD_SETTINGS_DIR = 'world-settings/';
/** Mapy: `maps/<mapId>/manifest.json` i `maps/<mapId>/chunks/*.json` (poza definicjami). */
export const MAPS_FOLDER = 'maps';
