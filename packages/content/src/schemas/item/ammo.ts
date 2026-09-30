import { z } from 'zod';
import { itemBaseShape } from './base.js';

export const AmmoItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('ammo'),
  ammo: z.strictObject({
    /** Kaliber (np. `9mm`, `12ga`) — informacyjnie, powiązanie z bronią idzie przez id amunicji. */
    caliber: z.string().min(1),
    damageMultiplier: z.number().min(0).default(1),
  }),
});

export type AmmoItem = z.infer<typeof AmmoItemSchema>;
