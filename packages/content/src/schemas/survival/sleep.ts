import { z } from 'zod';
import { minutes, mul, num, stat } from './num.js';

/** Posłanie: tempo spadku zmęczenia (punkty na minutę gry snu). */
const surface = (fatigueRecoveryPerMin: number) =>
  z.strictObject({ fatigueRecoveryPerMin: num(fatigueRecoveryPerMin, 10) }).prefault({});

/**
 * Sen. Potrzeby w czasie snu mnoży `activity.sleeping`. Budzi: `wakeAtFatigue`, limit czasu,
 * hałas o głośności ≥ `wakeOnNoiseVolume`, zombie bliżej niż `wakeOnZombieTiles`.
 */
export const SleepSettingsSchema = z
  .strictObject({
    minFatigueToSleep: stat(30),
    wakeAtFatigue: stat(2),
    maxDurationMin: minutes(720),
    surfaces: z
      .strictObject({ bed: surface(0.1), sofa: surface(0.075), floor: surface(0.05) })
      .prefault({}),
    /** Jakość snu: ból ≥ progu albo moodle „Zimno” ≥ 2 mnożą regenerację. */
    painAbove: stat(35),
    painQualityMul: mul(0.7),
    coldQualityMul: mul(0.7),
    /** Mnożnik gojenia i regeneracji zdrowia we śnie. */
    healingMul: mul(1.5),
    wakeOnNoiseVolume: z.number().min(0).max(1).default(0.3),
    wakeOnZombieTiles: num(6, 100),
    /** Podpowiedź dla hosta (`timeScaleHint`), jeśli nic nie grozi. */
    timeScaleHint: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(4),
  })
  .prefault({});

export type SleepSettings = z.infer<typeof SleepSettingsSchema>;
