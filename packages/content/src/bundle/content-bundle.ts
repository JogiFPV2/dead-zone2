import type { AppearancePart } from '../schemas/appearance-part.js';
import type { ContainerType } from '../schemas/container-type.js';
import type { GameMode } from '../schemas/game-mode/game-mode.js';
import type { Item } from '../schemas/item/item.js';
import type { LootTable } from '../schemas/loot-table.js';
import type { ModManifest } from '../schemas/mod-manifest.js';
import type { Moodle } from '../schemas/moodle.js';
import type { ColorPalette } from '../schemas/palette.js';
import type { Profession } from '../schemas/profession.js';
import type { Recipe } from '../schemas/recipe/recipe.js';
import type { Skill } from '../schemas/skill.js';
import type { Station } from '../schemas/station.js';
import type { Tile } from '../schemas/tile.js';
import type { Trait } from '../schemas/trait/trait.js';
import type { WorldSettings } from '../schemas/world-settings.js';
import type { ZombieType } from '../schemas/zombie-type.js';
import type { AnimalType } from '../schemas/animal-type.js';
import type { DeepReadonly } from './deep-freeze.js';

/**
 * Kontrakt z Symulacją (packages/sim): cała zawartość gry po walidacji i nałożeniu modów,
 * jako Recordy po id, głęboko zamrożona. `containers` to typy schowków w świecie.
 */
export type ContentBundle = DeepReadonly<{
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
  skills: Record<string, Skill>;
  traits: Record<string, Trait>;
  professions: Record<string, Profession>;
  moodles: Record<string, Moodle>;
  lootTables: Record<string, LootTable>;
  zombieTypes: Record<string, ZombieType>;
  /** Zwierzęta (sim `animals/*`): dzikie i miejskie, łowne lub nie. */
  animalTypes: Record<string, AnimalType>;
  containers: Record<string, ContainerType>;
  /** Elementy statyczne mapy (podłogi, dachy, ściany, okna, drzwi). */
  tiles: Record<string, Tile>;
  /** Tryby gry singleplayer (cel, preset świata, zasady startu, wynik). */
  gameModes: Record<string, GameMode>;
  /** Stacje rzemieślnicze z poziomami 1–3. */
  stations: Record<string, Station>;
  /** Części wyglądu do tworzenia postaci (slot, modelRef, kanały barwienia). */
  appearanceParts: Record<string, AppearancePart>;
  palettes: Record<string, ColorPalette>;
  worldSettings: WorldSettings;
  /** Mody w kolejności wczytywania. */
  mods: ModManifest[];
}>;
