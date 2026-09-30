import { z } from 'zod';
import { ItemRefSchema, TagSchema } from '../common/index.js';

/** Narzędzie potrzebne, ale niezużywane (traci trwałość o `durabilityLoss`). */
const extra = { durabilityLoss: z.number().int().min(0).default(0) };

export const ToolRequirementSchema = z.union([
  z.strictObject({ item: ItemRefSchema, ...extra }),
  z.strictObject({ tag: TagSchema, ...extra }),
]);

export type ToolRequirement = z.infer<typeof ToolRequirementSchema>;
