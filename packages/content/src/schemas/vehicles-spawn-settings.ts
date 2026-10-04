import { z } from 'zod';
import { ContentIdSchema, FractionSchema, TilesSchema } from './common/index.js';

/**
 * Auta z danych chunka (`SimChunk.vehicles`, generator): rzuty per auto z ziarna świata.
 * Kluczyk: w stacyjce / w schowku / w schowku pobliskiego budynku (ten sam chunk) / na zombie
 * (pierwszy zabity w promieniu `keyZombieTiles`) / zgubiony — wagi `key`.
 */
export const VehicleSpawnSettingsSchema = z
  .strictObject({
    /** Typ, gdy chunk go nie podaje. */
    defaultType: ContentIdSchema.default('base:sedan'),
    lockedChance: FractionSchema.default(0.6),
    key: z
      .strictObject({
        ignition: z.number().min(0).max(1000).default(10),
        glovebox: z.number().min(0).max(1000).default(15),
        building: z.number().min(0).max(1000).default(20),
        zombie: z.number().min(0).max(1000).default(15),
        none: z.number().min(0).max(1000).default(40),
      })
      .prefault({}),
    /** Paliwo jako ułamek baku. */
    fuel: z
      .strictObject({ min: FractionSchema, max: FractionSchema })
      .default({ min: 0, max: 0.6 }),
    keyZombieTiles: TilesSchema.default(40),
  })
  .prefault({});
