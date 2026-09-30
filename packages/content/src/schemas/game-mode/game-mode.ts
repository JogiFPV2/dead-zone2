import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  ProfessionRefSchema,
  TagListSchema,
} from '../common/index.js';
import { StartingItemSchema } from '../profession.js';
import { LocalNameSchema, ObjectiveSchema, conditionNames } from './objective.js';
import { WorldPresetSchema } from './world-preset.js';

/** Strefa nazwana w trybie; mapa wskazuje jej położenie znacznikiem o tej nazwie. */
export const ModeZoneSchema = z.strictObject({
  id: LocalNameSchema,
  role: z.enum(['player-spawn', 'npc-hold', 'extraction', 'horde', 'other']),
  name: I18nKeySchema.optional(),
});

/** NPC trybu (np. osoba zamknięta w willi). */
export const ModeNpcSchema = z.strictObject({
  id: LocalNameSchema,
  name: I18nKeySchema,
  zone: LocalNameSchema,
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
  spawnZone: LocalNameSchema.optional(),
});

export const GameModeSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: I18nKeySchema,
    description: I18nKeySchema.optional(),
    tags: TagListSchema,
    /** Tryby trzymane jako dane; `singleplayer` na start, sieć później. */
    players: z.enum(['singleplayer']).default('singleplayer'),
    objective: ObjectiveSchema,
    world: WorldPresetSchema,
    zones: z.array(ModeZoneSchema).default([]),
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
    const zones = new Set(m.zones.map((z) => z.id));
    const npcs = new Set(m.npcs.map((n) => n.id));
    const used = [m.objective.win, ...m.objective.lose].filter((c) => c !== undefined);
    const names = used.map(conditionNames);
    const needZones = [
      ...names.flatMap((n) => n.zones),
      ...m.npcs.map((n) => n.zone),
      ...m.world.zombies.hordes.map((h) => h.zone),
      ...(m.player.spawnZone ? [m.player.spawnZone] : []),
    ];
    for (const z of needZones.filter((z) => !zones.has(z)))
      ctx.addIssue({ code: 'custom', message: `nieznana strefa „${z}”`, path: ['zones'] });
    for (const n of names.flatMap((x) => x.npcs).filter((n) => !npcs.has(n)))
      ctx.addIssue({ code: 'custom', message: `nieznany NPC „${n}”`, path: ['npcs'] });
  });

export type GameMode = z.infer<typeof GameModeSchema>;
