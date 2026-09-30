import { z } from 'zod';

/** Wolne pole na dane modów, których schemat bazowy nie zna. Walidator go nie interpretuje. */
export const ExtSchema = z.record(z.string(), z.unknown()).optional();
