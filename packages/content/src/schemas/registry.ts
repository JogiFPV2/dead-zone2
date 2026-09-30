import type { z } from 'zod';
import { ContainerTypeSchema } from './container-type.js';
import type { ContentType } from './content-type.js';
import { ItemSchema } from './item/index.js';
import { LootTableSchema } from './loot-table.js';
import { MoodleSchema } from './moodle.js';
import { ProfessionSchema } from './profession.js';
import { RecipeSchema } from './recipe/index.js';
import { SkillSchema } from './skill.js';
import { TraitSchema } from './trait/index.js';
import { ZombieTypeSchema } from './zombie-type.js';

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
  containerType: ContainerTypeSchema,
} as const satisfies Record<ContentType, z.ZodType>;

export type ContentOf<T extends ContentType> = z.infer<(typeof CONTENT_SCHEMAS)[T]>;
