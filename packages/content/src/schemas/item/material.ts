import { z } from 'zod';
import { itemBaseShape } from './base.js';

/** Surowiec do craftingu (deski, gwoździe, szmaty, taśma). */
export const MaterialItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('material'),
});

export type MaterialItem = z.infer<typeof MaterialItemSchema>;
