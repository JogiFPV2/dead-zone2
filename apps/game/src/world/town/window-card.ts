import type { ContentId } from '../chunk.js';

/**
 * Interior card behind a window (bld-spec §4 variant A): a picture of the room seen through the
 * glass, one cell of the card atlas (`CARD_GRID`). Rows of categories × 2 variants; the cell is deterministic from
 * the building and the window edge, so a facade never flickers between loads.
 */
export const CARD_CATEGORIES = [
  'salon',
  'kuchnia',
  'sypialnia',
  'lazienka',
  'sklep',
  'magazyn',
  'klatka',
  'pusty',
] as const;
export type CardCategory = (typeof CARD_CATEGORIES)[number];
export const CARD_VARIANTS = 2;
/** Atlas grid (8 × 8): rows 0–1 interior cards, from cell 16 the bld detail cells (`DETAIL_CARD`). */
export const CARD_GRID = 8;
/**
 * bld detail cells (look-spec §D, `?bld-detail=1`) in the same card atlas / material: window
 * states, signs, stripes, roof holes, graffiti, plaster loss. Painted on the canvas, no asset.
 */
export const DETAIL_CARD = {
  broken: 16,
  broken2: 17,
  boarded: 18,
  boarded2: 19,
  dirty: 20,
  signSchool: 21,
  signPolice: 22,
  signHospital: 23,
  signSor: 24,
  cross: 25,
  star: 26,
  stripePolice: 27,
  bandSchool: 28,
  roofHole: 29,
  roofHole2: 30,
  graffiti0: 31,
  graffiti1: 32,
  graffiti2: 33,
  graffiti3: 34,
  plasterLoss: 35,
  streaks: 36,
} as const;
export type DetailCard = keyof typeof DETAIL_CARD;

const BY_ROOM: Readonly<Record<string, CardCategory>> = {
  'room-living-room': 'salon',
  'room-office': 'salon',
  'room-cabinet': 'salon',
  'room-school': 'salon',
  'room-kitchen': 'kuchnia',
  'room-sink': 'kuchnia',
  'room-bedroom': 'sypialnia',
  'room-hospital': 'sypialnia',
  'room-bathroom': 'lazienka',
  'room-shop': 'sklep',
  'room-pharmacy': 'sklep',
  'room-video-store': 'sklep',
  'room-gun-store': 'sklep',
  'room-bookstore': 'sklep',
  'room-gas-station': 'sklep',
  'room-warehouse': 'magazyn',
  'room-garage': 'magazyn',
  'room-gym': 'magazyn',
  'room-hall': 'klatka',
  'room-police': 'salon',
};

/** Card category of a room type content id (`base:room-kitchen`); unknown / none: empty room. */
export function cardCategory(type: ContentId | undefined): CardCategory {
  if (!type) return 'pusty';
  const name = type.slice(type.indexOf(':') + 1);
  return BY_ROOM[name] ?? 'pusty';
}

/** Small integer hash (deterministic, no Math.random). */
export function cardSeed(building: number, tx: number, ty: number, axis: 'N' | 'W'): number {
  let h = Math.imul(building | 0, 0x9e3779b1) ^ Math.imul(tx | 0, 0x85ebca6b);
  h ^= Math.imul(ty | 0, 0xc2b2ae35) ^ (axis === 'N' ? 0x27d4eb2f : 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Atlas cell 0..15 of a category and a seed (interior cards fill the first 16 cells). */
export function cardCell(cat: CardCategory, seed: number): number {
  return CARD_CATEGORIES.indexOf(cat) * CARD_VARIANTS + (seed % CARD_VARIANTS);
}
