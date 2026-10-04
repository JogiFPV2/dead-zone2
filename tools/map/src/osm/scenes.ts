import type { SceneCut } from './scene.js';

/**
 * OSM scene cuts (content maps). `osm-okulickiego`: 320 × 320 m around the KEN viaduct over the
 * railway by ul. Okulickiego (Stalowa Wola), turned 61° so the tracks run east–west and the
 * viaduct north–south (menu background, spec: „wiadukt przy Okulickiego”).
 */
export const OSM_SCENES: readonly SceneCut[] = [
  { id: 'osm-okulickiego', cx: 6290, cy: 8520, size: 320, rotDeg: 61, seed: 7 },
];
