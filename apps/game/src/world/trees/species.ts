/**
 * Tree species of the realistic style (`?style=real`). Local schema until Designer's vegetation
 * spec / Modules' content species land (then this table moves to packages/content). Sizes in m.
 */
export const TREE_SPECIES = ['oak', 'birch', 'maple', 'linden'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export interface SpeciesLook {
  /** Polish name (debug / docs). */
  name: string;
  /** Total height range (m). */
  height: readonly [number, number];
  /** Crown radius / total height (horizontal) and crown height / total height. */
  crownWidth: number;
  crownHeight: number;
  /** Trunk radius at the base (m at height 1, scaled with the tree). */
  trunkRadius: number;
  /** Leaf tint (multiplies the leaf texture) and bark colour (sRGB hex). */
  leaf: string;
  bark: string;
  /** Share of each species in a mixed Polish street / park stand (sums to 1). */
  share: number;
}

export const SPECIES_LOOK: Readonly<Record<TreeSpecies, SpeciesLook>> = {
  oak: {
    name: 'dąb',
    height: [7, 10],
    crownWidth: 0.42,
    crownHeight: 0.62,
    trunkRadius: 0.035,
    leaf: '#5c7a32',
    bark: '#4a3b2c',
    share: 0.25,
  },
  birch: {
    name: 'brzoza',
    height: [8, 11],
    crownWidth: 0.24,
    crownHeight: 0.68,
    trunkRadius: 0.022,
    leaf: '#8aa83e',
    bark: '#d9d4c8',
    share: 0.2,
  },
  maple: {
    name: 'klon',
    height: [7, 9.5],
    crownWidth: 0.38,
    crownHeight: 0.6,
    trunkRadius: 0.03,
    leaf: '#6f8f2c',
    bark: '#5a4a3a',
    share: 0.25,
  },
  linden: {
    name: 'lipa',
    height: [8, 11],
    crownWidth: 0.32,
    crownHeight: 0.7,
    trunkRadius: 0.03,
    leaf: '#4f7a34',
    bark: '#3f362d',
    share: 0.3,
  },
};

/** Deterministic 0..1 hash of a spot (same tree every load / client). */
export function spotHash(x: number, z: number, salt = 0): number {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663);
  h = Math.imul(h ^ salt ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Species of a tree standing at (x, z), by the shares. */
export function speciesAt(x: number, z: number): TreeSpecies {
  let u = spotHash(x, z, 1);
  for (const s of TREE_SPECIES) {
    u -= SPECIES_LOOK[s].share;
    if (u < 0) return s;
  }
  return 'linden';
}

/** Height (m) of a tree of `s` at (x, z), within the species range. */
export function heightAt(s: TreeSpecies, x: number, z: number): number {
  const [a, b] = SPECIES_LOOK[s].height;
  return a + (b - a) * spotHash(x, z, 2);
}
