/**
 * Tree species of generated trees (#386: `packages/content` tree-species, `habitats` weights).
 * The table mirrors the content JSON (tree-species.test.ts keeps them equal): the generator also
 * runs in the browser without the content bundle.
 */
export type TreeHabitat = 'forest' | 'park' | 'street' | 'field' | 'garden';

/** Species id → habitat weights (content `habitats`). */
export const TREE_HABITAT_WEIGHTS: Readonly<
  Record<string, Readonly<Partial<Record<TreeHabitat, number>>>>
> = {
  'base:apple': { garden: 5, field: 1 },
  'base:birch': { forest: 2, park: 3, street: 2, field: 1 },
  'base:hazel': { forest: 2, park: 2, garden: 2, field: 2 },
  'base:linden': { park: 2, street: 5, field: 0.5 },
  'base:maple': { park: 3, street: 4, garden: 1 },
  'base:oak': { forest: 2, park: 3, street: 2, field: 2 },
  'base:pine': { forest: 5, park: 1, field: 0.5 },
  'base:spruce': { forest: 3, park: 1, garden: 0.5 },
};

const IDS = Object.keys(TREE_HABITAT_WEIGHTS).sort();

/** Species of a tree in habitat `h`, weighted by `habitats`, from a [0, 1) position hash `u`. */
export function pickSpecies(h: TreeHabitat, u: number): string {
  let total = 0;
  for (const id of IDS) total += TREE_HABITAT_WEIGHTS[id]![h] ?? 0;
  let t = u * total;
  for (const id of IDS) {
    t -= TREE_HABITAT_WEIGHTS[id]![h] ?? 0;
    if (t < 0) return id;
  }
  return IDS.find((id) => (TREE_HABITAT_WEIGHTS[id]![h] ?? 0) > 0)!;
}
