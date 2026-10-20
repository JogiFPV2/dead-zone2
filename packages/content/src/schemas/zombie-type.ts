import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  FractionSchema,
  I18nKeySchema,
  LootTableRefSchema,
  NumberRangeSchema,
  RealSecondsSchema,
  TagListSchema,
  TilesSchema,
} from './common/index.js';
import { ZombieAttackReachSchema, ZombieWindupMsSchema } from './zombie-attack.js';

export const ZombieTypeSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  tags: TagListSchema,
  health: z.number().positive(),
  /** Prędkości w kaflach na sekundę (czas rzeczywisty). */
  speed: z.strictObject({
    wanderTilesPerSec: z.number().min(0),
    chaseTilesPerSec: z.number().min(0),
  }),
  damage: NumberRangeSchema,
  attackCooldownSec: RealSecondsSchema,
  /** Zasięg ciosu (m) od krawędzi ciał; brak = DEFAULT_ZOMBIE_ATTACK_REACH_M. */
  attackReachM: ZombieAttackReachSchema.optional(),
  /** Czas zamachu (ms); brak = DEFAULT_ZOMBIE_WINDUP_MS. */
  windupMs: ZombieWindupMsSchema.optional(),
  /** Szansa na ugryzienie przy udanym ataku (reszta to zadrapania/rany szarpane). */
  biteChance: FractionSchema,
  /** Zasięg zmysłów. */
  sightRangeTiles: TilesSchema,
  hearingRangeTiles: TilesSchema,
  /** Waga przy losowaniu typu w spawnie. */
  spawnWeight: z.number().min(0).default(1),
  /** Loot na zwłokach. */
  lootTable: LootTableRefSchema.optional(),
  model: z.string().optional(),
  ext: ExtSchema,
});

export type ZombieType = z.infer<typeof ZombieTypeSchema>;
