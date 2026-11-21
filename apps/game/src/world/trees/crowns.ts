import { SIM_TREE_STRIDE } from '@deadzone/protocol';
import { TreeSpeciesSchema, type TreeSpecies as ContentTreeSpecies } from '@deadzone/content';
import { TREE_HEIGHT_SCALE } from './species.js';

/**
 * Tree crowns for the sim's light model (`SimChunk.trees`, docs 9.45): every content species
 * (`packages/content/data/base/tree-species`) → crown radius, bottom and top in game metres, the
 * same scale as the realistic trees (`TREE_HEIGHT_SCALE`, mid of the species ranges). The sim
 * only needs the shade they cast, so per-tree size variation of the renderer is left out.
 */
const FILES = import.meta.glob<unknown>(
  '../../../../../packages/content/data/base/tree-species/*.json',
  { import: 'default', eager: true },
);

/** Crown height / tree height per leaf type (same as the realistic trees, `species.ts`). */
const CROWN_HEIGHT = { broadleaf: 0.62, conifer: 0.82 } as const;

export interface CrownSize {
  r: number;
  bottom: number;
  top: number;
}

/** Content species → crown size in game metres. */
export function crownOf(s: ContentTreeSpecies): CrownSize {
  const h = ((s.heightM.min + s.heightM.max) / 2) * TREE_HEIGHT_SCALE;
  const r = ((s.crownRadiusM.min + s.crownRadiusM.max) / 2) * TREE_HEIGHT_SCALE;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { r: round(r), bottom: round(h * (1 - CROWN_HEIGHT[s.leafType])), top: round(h) };
}

const CROWNS: ReadonlyMap<string, CrownSize> = new Map(
  Object.values(FILES).map((json) => {
    const s = TreeSpeciesSchema.parse(json);
    return [s.id, crownOf(s)] as const;
  }),
);

/** Fallback for a species the content does not list (a mid-size broadleaf). */
const DEFAULT_CROWN: CrownSize = { r: 1.4, bottom: 2.3, top: 6 };

export const crownOfSpecies = (id: string | undefined): CrownSize =>
  (id && CROWNS.get(id)) || DEFAULT_CROWN;

/**
 * A generator column's trees (`trees` local tile pairs, `treeSpecies`) as `SimChunk.trees`:
 * x, y, radius, bottom, top per tree.
 */
export function simTrees(trees: readonly number[], species: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < trees.length; i += 2) {
    const c = crownOfSpecies(species[i / 2]);
    out.push(trees[i]!, trees[i + 1]!, c.r, c.bottom, c.top);
  }
  if (out.length % SIM_TREE_STRIDE !== 0) throw new Error('simTrees: stride');
  return out;
}
