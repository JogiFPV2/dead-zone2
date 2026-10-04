import { z } from 'zod';

/** Kolory znaczników na mapie gracza (enum w protokole: `MARKER_COLORS`). */
export const MAP_MARKER_COLORS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
export type MapMarkerColor = (typeof MAP_MARKER_COLORS)[number];

/**
 * Znaczniki na mapie gracza (Symulacja, docs/sim-architecture.md 9.29): dozwolone ikony (id
 * contentu, np. `base:marker-food`; rysunek po stronie klienta), kolory, limit liczby i długość
 * tekstu (dłuższy jest przycinany).
 */
export const MapMarkersSettingsSchema = z
  .strictObject({
    icons: z
      .array(z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/))
      .min(1)
      .max(64)
      .default([
        'base:marker-food',
        'base:marker-danger',
        'base:marker-zombies',
        'base:marker-loot',
        'base:marker-base',
        'base:marker-car',
        'base:marker-water',
        'base:marker-note',
      ]),
    colors: z
      .array(z.enum(MAP_MARKER_COLORS))
      .min(1)
      .default([...MAP_MARKER_COLORS]),
    maxMarkers: z.number().int().min(1).max(1000).default(200),
    maxTextLength: z.number().int().min(0).max(200).default(40),
  })
  .prefault({});

/**
 * Mapa gracza: odkrywanie chunków (co `discoverEverySec`, w promieniu wzroku gracza — noc go
 * skraca) i ślad drogi (punkt co `trailSpacingM`, najwyżej `trailMaxPoints`, najstarsze wypadają).
 */
export const PlayerMapSettingsSchema = z
  .strictObject({
    discoverEverySec: z.number().min(0.05).max(10).default(1),
    trailSpacingM: z.number().min(1).max(256).default(16),
    trailMaxPoints: z.number().int().min(100).max(100_000).default(20_000),
  })
  .prefault({});

export type MapMarkersSettings = z.infer<typeof MapMarkersSettingsSchema>;
export type PlayerMapSettings = z.infer<typeof PlayerMapSettingsSchema>;
