import { z } from 'zod';

/**
 * Pojemnik na wodę (butelka): ile litrów mieści pełny. Napełnianie przy kranie albo zbiorniku
 * (`placeable.waterTank`) dzieli `capacityL` na porcje przedmiotu (`drink.uses`).
 */
export const WaterContainerSchema = z.strictObject({
  capacityL: z.number().positive().finite(),
});

export type WaterContainer = z.infer<typeof WaterContainerSchema>;
