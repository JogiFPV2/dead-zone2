import { ContentIdSchema } from './id.js';

/**
 * Referencje do innych definicji. Kształt to zwykłe id z namespace;
 * istnienie celu sprawdza walidator krzyżowy (src/validate/checks).
 */
export const ItemRefSchema = ContentIdSchema.describe('ref:item');
export const SkillRefSchema = ContentIdSchema.describe('ref:skill');
export const TraitRefSchema = ContentIdSchema.describe('ref:trait');
export const ProfessionRefSchema = ContentIdSchema.describe('ref:profession');
export const RecipeRefSchema = ContentIdSchema.describe('ref:recipe');
export const LootTableRefSchema = ContentIdSchema.describe('ref:lootTable');
export const ContainerTypeRefSchema = ContentIdSchema.describe('ref:containerType');
export const MoodleRefSchema = ContentIdSchema.describe('ref:moodle');
export const TileRefSchema = ContentIdSchema.describe('ref:tile');
/** Typ pomieszczenia, np. `base:room-kitchen`; pasuje do `rooms` w loot tables. */
export const RoomTypeSchema = ContentIdSchema.describe('ref:roomType');
