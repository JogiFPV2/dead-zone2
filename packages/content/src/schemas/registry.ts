import type { z } from 'zod';
import { AppearancePartSchema } from './appearance-part.js';
import { ContainerTypeSchema } from './container-type.js';
import type { ContentType } from './content-type.js';
import { GameModeSchema } from './game-mode/index.js';
import { ItemSchema } from './item/index.js';
import { LootTableSchema } from './loot-table.js';
import { MoodleSchema } from './moodle.js';
import { ColorPaletteSchema } from './palette.js';
import { ProfessionSchema } from './profession.js';
import { RecipeSchema } from './recipe/index.js';
import { SkillSchema } from './skill.js';
import { StationSchema } from './station.js';
import { TagDefSchema } from './tag-def.js';
import { TileSchema } from './tile.js';
import { TraitSchema } from './trait/index.js';
import { ZombieTypeSchema } from './zombie-type.js';
import { AnimalTypeSchema } from './animal-type.js';
import { TreeSpeciesSchema } from './tree-species.js';
import { VehicleTypeSchema } from './vehicle-type.js';

/** Schemat dla każdego rodzaju definicji. */
export const CONTENT_SCHEMAS = {
  item: ItemSchema,
  recipe: RecipeSchema,
  skill: SkillSchema,
  trait: TraitSchema,
  profession: ProfessionSchema,
  moodle: MoodleSchema,
  lootTable: LootTableSchema,
  zombieType: ZombieTypeSchema,
  animalType: AnimalTypeSchema,
  treeSpecies: TreeSpeciesSchema,
  vehicleType: VehicleTypeSchema,
  containerType: ContainerTypeSchema,
  tile: TileSchema,
  gameMode: GameModeSchema,
  station: StationSchema,
  appearancePart: AppearancePartSchema,
  palette: ColorPaletteSchema,
  tag: TagDefSchema,
} as const satisfies Record<ContentType, z.ZodType>;

export type ContentOf<T extends ContentType> = z.infer<(typeof CONTENT_SCHEMAS)[T]>;
