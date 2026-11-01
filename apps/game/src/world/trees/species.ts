import { TreeSpeciesSchema, type TreeSpecies as ContentTreeSpecies } from '@deadzone/content';

/**
 * Tree species of the realistic style (`?style=real`), read from the content pack
 * (`packages/content/data/base/tree-species`, schema `TreeSpeciesSchema`). Content sizes are
 * real-world metres; the iso town is compressed, so heights go through `TREE_HEIGHT_SCALE`.
 */
const FILES = import.meta.glob<unknown>(
  '../../../../../packages/content/data/base/tree-species/*.json',
  { import: 'default', eager: true },
);

/** Real height (m) → game height (oak 15–28 m → 6–11 m, matching the kit's street scale). */
export const TREE_HEIGHT_SCALE = 0.4;
/** Crown height / tree height per leaf type (broadleaf: rounded crown on a bare stem). */
const CROWN_HEIGHT = { broadleaf: 0.62, conifer: 0.82 } as const;

export type LeafType = ContentTreeSpecies['leafType'];
export type TreeSpecies = string;

export interface SpeciesLook {
  id: string;
  leafType: LeafType;
  /** Game height range (m). */
  height: readonly [number, number];
  /** Crown radius / total height (horizontal) and crown height / total height. */
  crownWidth: number;
  crownHeight: number;
  /** Trunk radius / total height. */
  trunkRadius: number;
  /** Leaf tint (multiplies the leaf texture) and bark colour (sRGB hex). */
  leaf: string;
  bark: string;
  /** Planting weight among town (street + park) trees of the same leaf type. */
  weight: number;
}

/** Content species → render look (shrubs and species not planted in town are skipped). */
export function lookOf(s: ContentTreeSpecies): SpeciesLook | undefined {
  const weight = (s.habitats.street ?? 0) + (s.habitats.park ?? 0);
  if (s.shrub || weight <= 0) return undefined;
  const hMid = (s.heightM.min + s.heightM.max) / 2;
  const rMid = (s.crownRadiusM.min + s.crownRadiusM.max) / 2;
  const leaf = [...s.colors.summer].sort((a, b) => b.weight - a.weight)[0]!.hex;
  return {
    id: s.id,
    leafType: s.leafType,
    height: [s.heightM.min * TREE_HEIGHT_SCALE, s.heightM.max * TREE_HEIGHT_SCALE],
    // Conifer cones read thin from above: 1.4× wider than the content radius.
    crownWidth: (rMid / hMid) * (s.leafType === 'conifer' ? 1.4 : 1),
    crownHeight: CROWN_HEIGHT[s.leafType],
    // Content trunks are thin for the iso read: 1.5× the real radius / height ratio.
    trunkRadius: (s.trunk.radiusM / hMid) * 1.5,
    leaf,
    bark: s.trunk.color,
    weight,
  };
}

function loadLooks(): ReadonlyMap<string, SpeciesLook> {
  const out = new Map<string, SpeciesLook>();
  for (const json of Object.values(FILES)) {
    const look = lookOf(TreeSpeciesSchema.parse(json));
    if (look) out.set(look.id, look);
  }
  return out;
}

export const SPECIES_LOOK: ReadonlyMap<string, SpeciesLook> = loadLooks();
export const TREE_SPECIES: readonly string[] = [...SPECIES_LOOK.keys()].sort();
const byType = (t: LeafType) => TREE_SPECIES.filter((id) => SPECIES_LOOK.get(id)!.leafType === t);
export const SPECIES_BY_TYPE: Readonly<Record<LeafType, readonly string[]>> = {
  broadleaf: byType('broadleaf'),
  conifer: byType('conifer'),
};

export function look(id: TreeSpecies): SpeciesLook {
  const l = SPECIES_LOOK.get(id);
  if (!l) throw new Error(`unknown tree species ${id}`);
  return l;
}

/** Deterministic 0..1 hash of a spot (same tree every load / client). */
export function spotHash(x: number, z: number, salt = 0): number {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663);
  h = Math.imul(h ^ salt ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Species of a tree of `leafType` standing at (x, z), by the planting weights. */
export function speciesAt(x: number, z: number, leafType: LeafType = 'broadleaf'): TreeSpecies {
  const ids = SPECIES_BY_TYPE[leafType];
  const total = ids.reduce((a, id) => a + look(id).weight, 0);
  let u = spotHash(x, z, 1) * total;
  for (const id of ids) {
    u -= look(id).weight;
    if (u < 0) return id;
  }
  return ids[ids.length - 1]!;
}

/** Height (m) of a tree of `s` at (x, z), within the species range. */
export function heightAt(s: TreeSpecies, x: number, z: number): number {
  const [a, b] = look(s).height;
  return a + (b - a) * spotHash(x, z, 2);
}
