import { z } from 'zod';
import { FractionSchema, NoiseSchema, TilesSchema } from './common/index.js';
import {
  BarricadeSettingsSchema,
  ForceSettingsSchema,
  WindowActionsSettingsSchema,
} from './openings-actions-settings.js';

const HpSchema = z.number().min(1).max(10000);
/**
 * Drzwi, okna i bramy (krawędzie `door` / `window` / `gate` mapy) — stan żyje w Symulacji (`openings`), mapa
 * ma tylko stan domyślny `closed`. Zombie walą w zamknięte drzwi i okna (obrażenia typu ×
 * `zombieBashMul` co `attackCooldownSec`), przez okno otwarte lub rozbite przechodzi się wolniej.
 */
export const OpeningsSettingsSchema = z
  .strictObject({
    /** Wytrzymałość drzwi zamkniętych / na klucz. Po zniszczeniu stan `broken` (przejście). */
    doorHp: HpSchema.default(60),
    /** Wytrzymałość okna (szyby). Po zniszczeniu `broken`. */
    windowHp: HpSchema.default(6),
    /** Wytrzymałość bramy w ogrodzeniu (`gate`, otwierana jak drzwi). */
    gateHp: HpSchema.default(80),
    /** Mnożnik obrażeń ciosu zombie w drzwi / okno / deski. */
    zombieBashMul: z.number().min(0).max(100).default(1),
    /** Hałas uderzenia zombie w drzwi (ściąga inne zombie). */
    bashNoise: NoiseSchema.default({ radiusTiles: 14, volume: 0.8 }),
    /** Hałas rozbicia okna (gracz lub zombie). */
    breakNoise: NoiseSchema.default({ radiusTiles: 20, volume: 1 }),
    /** Hałas otwarcia / zamknięcia. */
    toggleNoise: NoiseSchema.default({ radiusTiles: 3, volume: 0.3 }),
    /** Mnożnik prędkości przy przechodzeniu przez otwarte / rozbite okno (gracz i zombie). */
    windowSpeedMul: FractionSchema.default(0.3),
    /** Zasięg komend `toggleDoor` / `breakWindow` od środka krawędzi. */
    reachTiles: TilesSchema.default(1.5),
    barricade: BarricadeSettingsSchema,
    window: WindowActionsSettingsSchema,
    force: ForceSettingsSchema,
  })
  .prefault({});

export type OpeningsSettings = z.infer<typeof OpeningsSettingsSchema>;
