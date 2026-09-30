import { z } from 'zod';

/** Przedział całkowity {min,max}, min ≤ max. */
export const IntRangeSchema = z
  .strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) })
  .refine((r) => r.min <= r.max, { message: 'min nie może być większe niż max', path: ['max'] });

/** Przedział rzeczywisty {min,max}, min ≤ max. */
export const NumberRangeSchema = z
  .strictObject({ min: z.number().min(0), max: z.number().min(0) })
  .refine((r) => r.min <= r.max, { message: 'min nie może być większe niż max', path: ['max'] });

export type IntRange = z.infer<typeof IntRangeSchema>;
export type NumberRange = z.infer<typeof NumberRangeSchema>;
