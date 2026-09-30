import { z } from 'zod';
import { CapacityKgSchema, FractionSchema, TagSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';
import { EquipSlotSchema } from './equip-slot.js';

/**
 * Przenośny pojemnik: reklamówka, torba sportowa, plecak szkolny/turystyczny/wojskowy, kabura.
 * `weightReductionPct` 0–100 — procent wagi zawartości, który „znika” przy noszeniu w docelowym slocie.
 */
export const BagStatsSchema = z.strictObject({
  capacityKg: CapacityKgSchema,
  weightReductionPct: z.number().min(0).max(100),
  /** Gdzie można nosić; pusta lista = tylko w ręce. */
  slots: z.array(EquipSlotSchema).min(1),
  /** Opcjonalne ograniczenie zawartości do tagów (np. tylko amunicja). */
  acceptsTags: z.array(TagSchema).optional(),
  /** Kara do szybkości przy pełnym obciążeniu, 0..1. */
  movementPenalty: FractionSchema.default(0),
});

export const ContainerItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('container'),
  bag: BagStatsSchema,
});

export type BagStats = z.infer<typeof BagStatsSchema>;
export type ContainerItem = z.infer<typeof ContainerItemSchema>;
