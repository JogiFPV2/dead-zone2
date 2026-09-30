import { z } from 'zod';
import { ZoneNameSchema } from '../map/zone.js';

/**
 * Odwołanie trybu do strefy mapy: po roli (`{ role: 'villa' }` — dowolna strefa z tą rolą)
 * albo po id konkretnej strefy (`{ zone: 'villa-east' }`, wymaga `map` w trybie).
 */
export const ZoneRefSchema = z.union([
  z.strictObject({ role: ZoneNameSchema }),
  z.strictObject({ zone: ZoneNameSchema }),
]);

export type ZoneRef = z.infer<typeof ZoneRefSchema>;
