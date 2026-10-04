import { z } from 'zod';
import { TagSchema } from './common/tags.js';
import { ItemRefSchema, TilesSchema } from './common/index.js';

const LitresSchema = z.number().min(0).max(10_000);
const LpsSchema = z.number().min(0.01).max(100);

/**
 * Paliwo: kanister (przedmiot `canItem`, poziom w litrach na egzemplarzu, 0..`canCapacityL`),
 * tankowanie auta z kanistra, napełnianie kanistra z dystrybutora (obiekt mapy `pumpItem`) i
 * spuszczanie paliwa z auta wężem (narzędzie z tagiem `hoseTag`). Akcje czasowe: czas = litry /
 * wydajność (l/s), przerwana akcja przelewa tyle, ile zdążyła.
 *
 * Dystrybutor: z prądem (`items.powered`) pompuje `pumpPoweredLps`, bez prądu ręczną korbą
 * `pumpManualLps` (wolniej, ale działa po odcięciu prądu — paliwo nie znika ze świata). Zapas
 * stacji losowany przy pierwszym użyciu z `pumpReserveL` (podgląd pokazuje ten sam wynik).
 * Tankowanie auta prosto z dystrybutora (bez kanistra): auto w zasięgu węża `pumpHoseTiles` od
 * kafla dystrybutora. Uszkodzony bak (część `fuelTank` < 100) cieknie: `tankLeakLps` × (1 − hp/100).
 */
export const FuelSettingsSchema = z
  .strictObject({
    canItem: ItemRefSchema.default('base:gas-can'),
    canCapacityL: LitresSchema.default(10),
    hoseTag: TagSchema.default('base:tool-hose'),
    pumpItem: ItemRefSchema.default('base:fuel-pump'),
    refuelLps: LpsSchema.default(1),
    siphonLps: LpsSchema.default(0.25),
    pumpPoweredLps: LpsSchema.default(1.5),
    pumpManualLps: LpsSchema.default(0.3),
    pumpReserveL: z
      .strictObject({ min: LitresSchema, max: LitresSchema })
      .default({ min: 200, max: 1000 }),
    /** Zasięg do obrysu auta (wlew / wąż) i do kafla dystrybutora. */
    reachTiles: TilesSchema.default(1.5),
    /** Zasięg węża dystrybutora do obrysu auta (tankowanie bez kanistra). */
    pumpHoseTiles: TilesSchema.default(4),
    /** Wyciek z baku przy hp 0 (l/s); 0 = bez wycieku. */
    tankLeakLps: z.number().min(0).max(10).default(0.02),
  })
  .prefault({});
