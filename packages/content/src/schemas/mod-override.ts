import { z } from 'zod';
import { ContentIdSchema } from './common/index.js';
import { CONTENT_TYPES } from './content-type.js';

/**
 * Nadpisanie definicji z innej paczki (pliki w `overrides/`).
 * - `merge`: głęboki merge obiektu `data` do celu (tablice są zastępowane),
 * - `replace`: `data` to pełna nowa definicja (to samo id),
 * - `remove`: usuwa definicję.
 * Po merge/replace wynik jest ponownie walidowany schematem typu.
 */
export const ModOverrideSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('merge'),
    type: z.enum(CONTENT_TYPES),
    target: ContentIdSchema,
    data: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    op: z.literal('replace'),
    type: z.enum(CONTENT_TYPES),
    target: ContentIdSchema,
    data: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    op: z.literal('remove'),
    type: z.enum(CONTENT_TYPES),
    target: ContentIdSchema,
  }),
]);

export type ModOverride = z.infer<typeof ModOverrideSchema>;
