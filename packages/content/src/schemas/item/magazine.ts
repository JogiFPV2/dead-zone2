import { z } from 'zod';
import { ItemRefSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';

/** Wymienny magazynek: pojemność i rodzaj amunicji. */
export const MagazineItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('magazine'),
  magazine: z.strictObject({
    ammo: ItemRefSchema,
    capacity: z.number().int().min(1).max(200),
  }),
});

export type MagazineItem = z.infer<typeof MagazineItemSchema>;
