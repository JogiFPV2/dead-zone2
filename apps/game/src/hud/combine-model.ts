import type { CraftingView, ItemView, RecipeStatusView } from '@deadzone/protocol';
import { durabilityRow, type StatRowVM } from '@deadzone/ui';
import type { CommandBody } from '../sim/sim-client.js';
import type { HudContentIndex } from './content-index.js';
import { craftItemName, partName, recipeName, skillName } from './crafting-labels.js';
import { itemIcon } from './hud-model.js';
import { itemImage } from './item-icons.js';
import { KIND_LABEL, formatKg } from './item-kinds.js';
import { formatMinutes } from './workshop-model.js';

/**
 * Combinable items in the inventory (approved mockup combine.png): `ItemView.combine` marks
 * carried items that are part of a known `combine` recipe; the sim's crafting view has the parts.
 */

/** A combine recipe takes at most this many parts (tooltip rows). */
export const MAX_COMBINE_PARTS = 4;

export type CombineState = 'ready' | 'miss';

/** Row look: tile tint + left edge, corner badge and the hint line under the name. */
export interface CombineRowVM {
  state: CombineState;
  recipe: string;
  /** `Połącz: Kij z gwoździami · gotowe` / `… · brakuje 1 części`. */
  hint: string;
}

export interface CombinePartVM {
  name: string;
  have: number;
  need: number;
  ok: boolean;
}

export interface CombineTipVM {
  recipe: string;
  /** Header `ŁĄCZENIE · 3 CZĘŚCI (MAKS. 4)`. */
  partCount: number;
  result: { name: string; category: string; icon: string; image?: string; count: number };
  stats: StatRowVM[];
  /** Up to MAX_COMBINE_PARTS rows (have / need). */
  parts: CombinePartVM[];
  partsOk: number;
  skill?: { name: string; need: number; have: number; ok: boolean };
  tools: { name: string; ok: boolean }[];
  /** `0:30` (game h:mm). */
  time: string;
  /** All parts present: the `Połącz` button is enabled (the sim still checks tools / skills). */
  ready: boolean;
  /** `Taśma klejąca ×1, Gwoździe ×2` (empty when nothing is missing). */
  missing: string;
}

/** The recipe to show / run: the first one that is ready, else the first known one in view. */
export function pickCombineRecipe(
  mark: ItemView['combine'],
  view: CraftingView | undefined,
): RecipeStatusView | undefined {
  if (!mark?.recipes.length || !view) return undefined;
  const known = mark.recipes
    .map((id) => view.recipes.find((r) => r.id === id))
    .filter((r): r is RecipeStatusView => r !== undefined);
  return known.find((r) => r.state === 'available') ?? known[0];
}

const missingParts = (r: RecipeStatusView): number => r.parts.filter((p) => p.have < p.need).length;

const resultOf = (content: HudContentIndex, recipe: string) =>
  content.recipes?.get(recipe)?.results[0];

/** Result label: the produced item's name, else the recipe name (repairs). */
export function combineResultName(content: HudContentIndex, recipe: string): string {
  const res = resultOf(content, recipe);
  return res ? craftItemName(res.item) : recipeName(recipe);
}

export function combineRowVM(
  it: ItemView,
  view: CraftingView | undefined,
  content: HudContentIndex,
): CombineRowVM | undefined {
  const mark = it.combine;
  if (!mark?.recipes.length) return undefined;
  const r = pickCombineRecipe(mark, view);
  const recipe = r?.id ?? mark.recipes[0]!;
  const ready = r ? r.state === 'available' : mark.ready;
  const name = combineResultName(content, recipe);
  const miss = r ? missingParts(r) : 0;
  const tail = ready ? 'gotowe' : miss > 0 ? `brakuje ${miss} części` : 'niedostępne';
  return { state: ready ? 'ready' : 'miss', recipe, hint: `Połącz: ${name} · ${tail}` };
}

export function combineTipVM(
  it: ItemView,
  view: CraftingView | undefined,
  content: HudContentIndex,
): CombineTipVM | undefined {
  const r = pickCombineRecipe(it.combine, view);
  if (!r) return undefined;
  const res = resultOf(content, r.id);
  const def = res ? content.items.get(res.item) : undefined;
  const image = res ? itemImage(res.item) : undefined;
  const stats: StatRowVM[] = [];
  if (def?.durabilityMax) stats.push(durabilityRow(def.durabilityMax, def.durabilityMax));
  if (def) stats.push({ label: 'Waga', value: formatKg(def.weightKg), unit: 'kg' });
  const parts = r.parts.slice(0, MAX_COMBINE_PARTS).map((p) => ({
    name: partName(p),
    have: Math.min(p.have, 999),
    need: p.need,
    ok: p.have >= p.need,
  }));
  const s = r.skills[0];
  const missing = r.parts
    .filter((p) => p.have < p.need)
    .map((p) => `${partName(p)} ×${p.need - p.have}`)
    .join(', ');
  return {
    recipe: r.id,
    partCount: r.parts.length,
    result: {
      name: combineResultName(content, r.id),
      category: def ? (KIND_LABEL[def.kind] ?? 'Przedmiot') : 'Naprawa',
      icon: itemIcon(def),
      ...(image ? { image } : {}),
      count: res?.count ?? 1,
    },
    stats,
    parts,
    partsOk: r.parts.filter((p) => p.have >= p.need).length,
    ...(s
      ? { skill: { name: skillName(s.skill), need: s.need, have: s.have, ok: s.have >= s.need } }
      : {}),
    tools: r.tools.map((t) => ({ name: partName(t), ok: t.have >= t.need })),
    time: formatMinutes(r.durationMin),
    ready: missing === '',
    missing,
  };
}

/** `combine` with the hovered item (the sim takes the other parts from what is at hand). */
export function combineCommand(
  it: ItemView | undefined,
  view: CraftingView | undefined,
): CommandBody | undefined {
  const r = pickCombineRecipe(it?.combine, view);
  if (!it || !r || missingParts(r) > 0) return undefined;
  return { type: 'combine', items: [it.id], recipe: r.id };
}
