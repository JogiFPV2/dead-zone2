import { z } from 'zod';
import { ContainerTypeRefSchema, FootprintSchema, StationRefSchema } from '../common/index.js';
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
    /** Miejsce do spania (łóżko, kanapa); bez tego śpi się na podłodze. */
    sleepSurface: z.enum(['bed', 'sofa']).optional(),
    /** Siedzisko (krzesło, fotel): odpoczynek `rest` w pełni (łóżko i kanapa też). */
    seat: z.boolean().optional(),
    /** Zajmowane kafle przy `rot = 0` (`footprintOf`); brak = 1×1. */
    footprint: FootprintSchema.optional(),
  }),
});

export type PlaceableItem = z.infer<typeof PlaceableItemSchema>;
