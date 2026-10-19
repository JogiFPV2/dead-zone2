import { z } from 'zod';
import {
  ContainerTypeRefSchema,
  FootprintSchema,
  StationRefSchema,
  SurfaceHeightMSchema,
} from '../common/index.js';
import { StationLevelSchema } from '../station.js';
import { itemBaseShape } from './base.js';
import { CookingApplianceSchema } from './cooking.js';
import { LightSchema } from './light.js';
import { PowerConsumerSchema, PowerSourceSchema } from './power.js';
import { WaterTankSchema } from './water-tank.js';

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
    /** Kuchenka: źródło ciepła palników i piekarnika (`item/cooking.ts`). */
    cooking: CookingApplianceSchema.optional(),
    /** Zbiornik wody (spłuczka toalety): skończony zapas, jakość, dopełnianie z sieci (`item/water-tank.ts`). */
    waterTank: WaterTankSchema.optional(),
    /** Zajmowane kafle przy `rot = 0` (`footprintOf`); brak = 1×1. */
    footprint: FootprintSchema.optional(),
    /** Wysokość blatu (m), na którym można postawić mebel z `onSurface` (stół 0.75). */
    surfaceHeightM: SurfaceHeightMSchema.optional(),
    /** Stoi na blacie mebla pod spodem (telewizor, radio, lampka), nie na podłodze. */
    onSurface: z.boolean().optional(),
  }),
});

export type PlaceableItem = z.infer<typeof PlaceableItemSchema>;
