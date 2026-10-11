// Rozmiar mebli w kaflach (`footprint`) i zajmowane kafle. Czysty TS, bez DOM, Three.js i API Node:
// `@deadzone/content/footprint` (lekkie wejście) i główne wejście. Konwencja: README, „Footprint mebli”.
export {
  FootprintSchema,
  FOOTPRINT_MAX_TILES,
  type Footprint,
} from '../schemas/common/footprint.js';
export * from './footprint-of.js';
export * from './rotated-footprint.js';
export * from './occupied-tiles.js';
export * from './footprint-center.js';
export * from './footprint-for-id.js';
