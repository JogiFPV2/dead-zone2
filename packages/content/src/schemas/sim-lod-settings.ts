import { z } from 'zod';
import { FractionSchema } from './common/index.js';

/** Domyślna gęstość zombie na chunk (32×32 m) wg typu strefy z generatora świata. */
export const DEFAULT_ZOMBIES_PER_CHUNK = {
  centrum: 4,
  uslugi: 3,
  bloki: 4,
  domy: 2,
  przemysl: 1.5,
  wojsko: 3,
  ruiny: 1,
  wies: 0.8,
  farma: 0.4,
  pola: 0.05,
  las: 0.03,
  woda: 0,
} as const;

/**
 * LOD symulacji na dużej mapie (Symulacja, docs/sim-architecture.md 9.24). Szczegółowo (encje
 * zombie, łup w schowkach) liczy się tylko obszar w promieniu `activeRadiusChunks` chunków wokół
 * każdego gracza; dalej zombie są licznikami w komórkach `cellSizeChunks`×`cellSizeChunks` chunków,
 * a łup chunka nie istnieje, dopóki gracz nie podejdzie. Wyłączanie po przekroczeniu
 * `activeRadiusChunks + hysteresisChunks` (histereza, bez migania). Na małej mapie, która cała
 * mieści się w obszarze aktywnym, LOD się nie włącza.
 */
export const SimLodSettingsSchema = z
  .strictObject({
    /** Włącza LOD na mapach większych niż okno aktywne (mała mapa demo: bez zmian). */
    enabled: z.boolean().default(true),
    /** Promień obszaru szczegółowego wokół gracza w chunkach (Chebyshev, chunk gracza = 0). */
    activeRadiusChunks: z.number().int().min(1).max(32).default(3),
    /** Dodatkowe chunki, zanim obszar zostanie zwinięty z powrotem (histereza). */
    hysteresisChunks: z.number().int().min(0).max(8).default(1),
    /** Bok komórki zgrubnej w chunkach (1 = komórka = chunk). */
    cellSizeChunks: z.number().int().min(1).max(16).default(1),
    /** Co ile ticków każda komórka dostaje krok zgrubny (dryf, hałas); praca rozłożona na ticki. */
    coarseTickEvery: z.number().int().min(1).max(12000).default(100),
    /** Limit aktywnych zombie (nadwyżka czeka w liczniku komórki). */
    maxActiveZombies: z.number().int().min(0).max(4000).default(300),
    /** Najwięcej rozwinięć zombie na tick (wygładza koszt wejścia w nowy obszar). */
    maxSpawnPerTick: z.number().int().min(1).max(1000).default(16),
    /** Rozwinięte zombie nie pojawiają się bliżej gracza niż tyle kafli. */
    minSpawnDistTiles: z.number().min(0).max(256).default(24),
    /** Ile rannych zombie na komórkę pamięta swoje HP po zwinięciu. */
    keepDamagedPerCell: z.number().int().min(0).max(1024).default(32),
    /** Wolny dryf hordy: szansa na krok zgrubny i część populacji komórki idąca do sąsiada. */
    drift: z
      .strictObject({
        chance: FractionSchema.default(0.05),
        fraction: FractionSchema.default(0.25),
      })
      .prefault({}),
    /** Reakcja zgrubna na głośny hałas (strzał, alarm) w dużym promieniu. */
    noise: z
      .strictObject({
        /** Hałas o promieniu co najmniej tyle kafli działa na komórki zgrubne. */
        minRadiusTiles: z.number().min(0).max(1000).default(40),
        /** Zasięg zgrubny = promień hałasu × ten mnożnik. */
        radiusMul: z.number().min(0).max(100).default(4),
        /** Jak długo (s gry przy ×1) hałas przyciąga komórki. */
        memorySec: z.number().min(0).max(3600).default(60),
        /** Część populacji komórki, która na krok zgrubny idzie o komórkę w stronę hałasu. */
        pullFraction: FractionSchema.default(0.5),
      })
      .prefault({}),
    /** Zombie na chunk wg `WorldSource.chunkKind` (start świata, rozkład typów wg `spawnWeight`). */
    zombiesPerChunk: z
      .record(z.string(), z.number().min(0).max(1000))
      .default({ ...DEFAULT_ZOMBIES_PER_CHUNK }),
    /** Gęstość dla chunków bez typu strefy. */
    defaultZombiesPerChunk: z.number().min(0).max(1000).default(0.1),
  })
  .prefault({});

export type SimLodSettings = z.infer<typeof SimLodSettingsSchema>;
