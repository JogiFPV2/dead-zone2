import { z } from 'zod';
import { ContainerTypeRefSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';

/**
 * Przedmiot, który po postawieniu staje się obiektem świata — np. skrzynia z desek.
 * Wskazuje na definicję schowka (`container-type`), której pojemność i zawartość zapisuje chunk.
 */
export const PlaceableItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('placeable'),
  placeable: z.strictObject({
    containerType: ContainerTypeRefSchema,
  }),
});

export type PlaceableItem = z.infer<typeof PlaceableItemSchema>;
