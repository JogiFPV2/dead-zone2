import { z } from 'zod';
import { TagSchema } from './common/tags.js';
import { ItemRefSchema, SkillRefSchema, TilesSchema } from './common/index.js';

/** Czas akcji w sekundach rzeczywistych przy ×1; XP; poziom umiejętności. */
const SecSchema = z.number().min(0).max(600);
const XpSchema = z.number().min(0).max(1000);
const SkillLevel = z.number().int().min(0).max(10);

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
 * stacji losowany przy pierwszym użyciu z `pumpReserveL`.
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
  })
  .prefault({});

/** Jedna grupa napraw: narzędzia (tagi, wszystkie), części (zużywane), skill, wynik. */
export const RepairGroupSchema = z.strictObject({
  sec: SecSchema,
  tools: z.array(TagSchema).max(4).default([]),
  parts: z
    .array(z.strictObject({ item: ItemRefSchema, count: z.number().int().min(1).max(20) }))
    .max(4)
    .default([]),
  minSkill: SkillLevel.default(0),
  /** Hp po naprawie = min(100, obecne + `hpBase` + poziom × `hpPerLevel`); 100 = wymiana. */
  hpBase: z.number().min(0).max(100),
  hpPerLevel: z.number().min(0).max(100).default(0),
  xp: XpSchema.default(0),
});

/**
 * Naprawy (akcje czasowe przez `setPartHp`): grupy części `engine`, `tire`, `window`, `body`.
 * Silnik i karoseria — naprawa częściowa zależna od Mechanics; opona i szyba — wymiana.
 */
export const RepairSettingsSchema = z
  .strictObject({
    skill: SkillRefSchema.default('base:mechanics'),
    reachTiles: TilesSchema.default(1.5),
    engine: RepairGroupSchema.default({
      sec: 20,
      tools: ['base:tool-wrench'],
      parts: [{ item: 'base:engine-parts', count: 1 }],
      minSkill: 2,
      hpBase: 20,
      hpPerLevel: 8,
      xp: 10,
    }),
    tire: RepairGroupSchema.default({
      sec: 10,
      tools: ['base:tool-wrench'],
      parts: [{ item: 'base:car-tire', count: 1 }],
      minSkill: 0,
      hpBase: 100,
      hpPerLevel: 0,
      xp: 4,
    }),
    window: RepairGroupSchema.default({
      sec: 12,
      tools: [],
      parts: [{ item: 'base:car-window', count: 1 }],
      minSkill: 1,
      hpBase: 100,
      hpPerLevel: 0,
      xp: 4,
    }),
    body: RepairGroupSchema.default({
      sec: 15,
      tools: ['base:tool-hammer'],
      parts: [{ item: 'base:scrap-metal', count: 2 }],
      minSkill: 1,
      hpBase: 15,
      hpPerLevel: 6,
      xp: 6,
    }),
  })
  .prefault({});
