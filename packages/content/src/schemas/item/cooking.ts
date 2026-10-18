import { z } from 'zod';

/** Źródło ciepła części kuchenki: gaz (działa bez prądu) albo prąd (`no-power` bez sieci). */
export const HeatSourceSchema = z.enum(['gas', 'electric']);

/**
 * Kuchenka (Symulacja, docs 9.52): palniki i piekarnik z własnym źródłem ciepła, np. `base:range`
 * = palniki gazowe + piekarnik elektryczny. Część bez prądu nie liczy się jako stacja dla
 * receptur z `station.appliance` tej części. Brak pola = stacja zawsze działa (ognisko, piec).
 */
export const CookingApplianceSchema = z.strictObject({
  burners: HeatSourceSchema.optional(),
  oven: HeatSourceSchema.optional(),
});

/** Część kuchenki, której potrzebuje receptura (`RecipeStation.appliance`). */
export const ApplianceSchema = z.enum(['burners', 'oven']);

export type HeatSource = z.infer<typeof HeatSourceSchema>;
export type CookingAppliance = z.infer<typeof CookingApplianceSchema>;
export type Appliance = z.infer<typeof ApplianceSchema>;
