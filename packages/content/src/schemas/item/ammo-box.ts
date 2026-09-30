import { z } from 'zod';
import { GameMinutesSchema, ItemRefSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';

/** Pudełko amunicji: po otwarciu daje `count` sztuk przedmiotu `ammo` (rodzaju `ammo`). */
export const AmmoBoxItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('ammo_box'),
  ammoBox: z.strictObject({
    ammo: ItemRefSchema,
    count: z.number().int().min(1).max(500),
    /** Czas rozpakowania (minuty gry). */
    unpackMin: GameMinutesSchema.default(0.5),
  }),
});

export type AmmoBoxItem = z.infer<typeof AmmoBoxItemSchema>;
