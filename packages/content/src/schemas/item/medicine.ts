import { z } from 'zod';

/** Domyślne punkty choroby (skala 0–100) zdejmowane przez lek. */
export const DEFAULT_MEDICINE_REDUCE_SICKNESS = 30;
/** Domyślny czas działania leku (minuty gry). */
export const DEFAULT_MEDICINE_DURATION_MIN = 60;

/** Lek na chorobę. Schemat nie wstawia domyślnych; wartości startowe w `DEFAULT_MEDICINE_*`. */
export const MedicineSchema = z.strictObject({
  reduceSickness: z.number().min(0).max(100),
  durationMin: z.number().positive(),
});

export type Medicine = z.infer<typeof MedicineSchema>;
