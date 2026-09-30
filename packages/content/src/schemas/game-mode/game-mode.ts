import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  ProfessionRefSchema,
  TagListSchema,
} from '../common/index.js';
import { ZoneNameSchema } from '../map/zone.js';
import { StartingItemSchema } from '../profession.js';
import { LocalNameSchema, ObjectiveSchema } from './objective.js';
import { WorldPresetSchema } from './world-preset.js';
import { ZoneRefSchema } from './zone-ref.js';
import { modeZoneRefs } from './mode-zone-refs.js';

/** NPC trybu (np. osoba zamknięta w willi). */
export const ModeNpcSchema = z.strictObject({
  id: LocalNameSchema,
  name: I18nKeySchema,
  zone: ZoneRefSchema,
  /** Zamknięty w strefie, dopóki gracz go nie wyprowadzi. */
  locked: z.boolean().default(false),
  profession: ProfessionRefSchema.optional(),
});

export const ScoreMetricSchema = z.enum([
  'days-survived',
  'zombies-killed',
  'npcs-extracted',
  'minutes-elapsed',
  'items-crafted',
]);

/** Wynik = suma `weight × metryka` (ujemna waga karze, np. za czas). */
export const ScoreSchema = z.strictObject({
  terms: z.array(z.strictObject({ metric: ScoreMetricSchema, weight: z.number() })).min(1),
  /** Metryka pokazywana jako główna na ekranie końca gry. */
  headline: ScoreMetricSchema,
});

export const PlayerRulesSchema = z.strictObject({
  /** Pusta lista = każdy zawód. */
  professions: z.array(ProfessionRefSchema).default([]),
  allowTraits: z.boolean().default(true),
  /** Dodatkowe punkty na cechy w tym trybie. */
  bonusPoints: z.number().int().min(-20).max(20).default(0),
  startingKit: z.array(StartingItemSchema).default([]),
  spawnZone: ZoneRefSchema.optional(),
});

export const GameModeSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: I18nKeySchema,
    description: I18nKeySchema.optional(),
    tags: TagListSchema,
    /** Tryby trzymane jako dane; `singleplayer` na start, sieć później. */
    players: z.enum(['singleplayer']).default('singleplayer'),
    /** Mapa trybu (`<namespace>:<folder>`); brak = mapa wybrana przez grę. */
    map: ContentIdSchema.optional(),
    /** Role stref, które mapa trybu musi mieć (co najmniej jedna strefa na rolę). */
    requiredZones: z.array(ZoneNameSchema).default([]),
    objective: ObjectiveSchema,
    world: WorldPresetSchema,
    npcs: z.array(ModeNpcSchema).default([]),
    player: PlayerRulesSchema.default({
      professions: [],
      allowTraits: true,
      bonusPoints: 0,
      startingKit: [],
    }),
    score: ScoreSchema,
    ext: ExtSchema,
  })
  .superRefine((m, ctx) => {
    const roles = new Set(m.requiredZones);
    const npcs = new Set(m.npcs.map((n) => n.id));
    const refs = modeZoneRefs(m);
    for (const { ref, path } of refs.zones) {
      if ('role' in ref && !roles.has(ref.role))
        ctx.addIssue({
          code: 'custom',
          message: `rola „${ref.role}” nie jest w requiredZones`,
          path,
        });
      if ('zone' in ref && m.map === undefined)
        ctx.addIssue({
          code: 'custom',
          message: `strefa „${ref.zone}” po id wymaga pola map`,
          path,
        });
    }
    for (const { npc, path } of refs.npcs.filter((n) => !npcs.has(n.npc)))
      ctx.addIssue({ code: 'custom', message: `nieznany NPC „${npc}”`, path });
  });

export type GameMode = z.infer<typeof GameModeSchema>;
