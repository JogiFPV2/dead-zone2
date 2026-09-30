import { z } from 'zod';
import { itemBaseShape } from './base.js';

/** Przedmiot bez specjalnej mechaniki (śmieci, klucze, drobiazgi, pusta butelka). */
export const MiscItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('misc'),
});

export type MiscItem = z.infer<typeof MiscItemSchema>;
