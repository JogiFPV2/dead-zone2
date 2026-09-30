import { z } from 'zod';
import { FractionSchema, TilesSchema } from './common/index.js';

/**
 * Widzenie — ten sam model dla gracza i zombie. Zasięg w dzień `dayRangeTiles`; w nocy
 * × `nightFactor`; w świetle (lampa, latarka, ognisko) czynnik rośnie o `lightBonus` × jasność,
 * najwyżej do 1. Strefy mapy z `role: 'dark'` liczą się jak noc także w dzień.
 */
export const VisionSettingsSchema = z
  .strictObject({
    enabled: z.boolean().default(true),
    dayRangeTiles: TilesSchema.default(30),
    nightFactor: FractionSchema.default(0.4),
    lightBonus: FractionSchema.default(0.5),
  })
  .prefault({});

export type VisionSettings = z.infer<typeof VisionSettingsSchema>;
