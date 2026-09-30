import { z } from 'zod';
import { ContainerTypeRefSchema, StationRefSchema } from '../common/index.js';
import { StationLevelSchema } from '../station.js';
import { itemBaseShape } from './base.js';
import { LightSchema } from './light.js';
import { PowerConsumerSchema, PowerSourceSchema } from './power.js';

/**
 * Przedmiot, który po postawieniu staje się obiektem świata — np. skrzynia z desek albo lampa.
 * `containerType` wskazuje definicję schowka (pojemność i zawartość zapisuje stan chunka),
 * `light` czyni obiekt źródłem światła. Oba opcjonalne (np. krzesło nie ma żadnego).
 */
export const PlaceableItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('placeable'),
  placeable: z.strictObject({
    containerType: ContainerTypeRefSchema.optional(),
    light: LightSchema.optional(),
    /** Postawiony przedmiot jest stacją `id` na poziomie `level`. */
    station: z.strictObject({ id: StationRefSchema, level: StationLevelSchema }).optional(),
    /** Potrzebuje prądu (telewizor). */
    power: PowerConsumerSchema.optional(),
    /** Daje prąd (generator). */
    powerSource: PowerSourceSchema.optional(),
  }),
});

export type PlaceableItem = z.infer<typeof PlaceableItemSchema>;
