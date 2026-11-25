import { z } from 'zod';

/**
 * Pojemnik na wodę (butelka): ile litrów mieści pełny. Napełnianie przy kranie albo zbiorniku
 * (`placeable.waterTank`) dzieli `capacityL` na porcje przedmiotu (`drink.uses`).
 */
export const WaterContainerSchema = z.strictObject({
  capacityL: z.number().positive().finite(),
});

export type WaterContainer = z.infer<typeof WaterContainerSchema>;

/**
 * Naczynie na wodę do podlewania (garnek, szklanka, konewka, wiadro): ile litrów mieści.
 * Napełnia się przy kranie, prysznicu, wannie, zbiorniku albo w rzece / stawie (brudna woda);
 * stan w przedmiocie (`waterL`, `waterDirty`). Nie służy do picia.
 */
export const WaterVesselSchema = z.strictObject({
  capacityL: z.number().positive().max(50),
});

export type WaterVessel = z.infer<typeof WaterVesselSchema>;
