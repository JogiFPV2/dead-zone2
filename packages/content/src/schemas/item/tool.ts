import { z } from 'zod';
import { itemBaseShape } from './base.js';
import { DurabilitySchema } from './durability.js';
import { HeldLightSchema } from './light.js';

/**
 * Narzędzie (młotek, piła, śrubokręt, otwieracz). Receptury wymagają narzędzi po tagu
 * (np. `base:tool/hammer`), więc tagi narzędzia trzymamy w `tags` przedmiotu.
 */
export const ToolItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('tool'),
  tool: z.strictObject({
    durability: DurabilitySchema.optional(),
    /** Mnożnik czasu akcji (lepsze narzędzie = szybciej). */
    speedMultiplier: z.number().positive().max(10).default(1),
  }),
  /** Narzędzie świecące w ręce (latarka). */
  light: HeldLightSchema.optional(),
});

export type ToolItem = z.infer<typeof ToolItemSchema>;
