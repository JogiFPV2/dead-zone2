import type { CraftingView, ItemView, RecipeStatusView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from './content-index.js';
import {
  MAX_COMBINE_PARTS,
  combineCommand,
  combineRowVM,
  combineTipVM,
  pickCombineRecipe,
} from './combine-model.js';

const recipe = (r: Partial<RecipeStatusView> & { id: string }): RecipeStatusView => ({
  kind: 'combine',
  category: 'weapons',
  state: 'available',
  parts: [],
  tools: [],
  skills: [],
  durationMin: 30,
  ...r,
});

const bat = recipe({
  id: 'base:craft-nailed-bat',
  state: 'missingParts',
  parts: [
    { item: 'base:wooden-stick', have: 1, need: 1 },
    { item: 'base:nails', have: 12, need: 5 },
    { item: 'base:duct-tape', have: 0, need: 1 },
  ],
  tools: [{ tag: 'base:hammer', have: 1, need: 1 }],
  skills: [{ skill: 'base:carpentry', need: 1, have: 2 }],
});
const bandage = recipe({
  id: 'base:sterilize-bandage',
  parts: [
    { item: 'base:bandage', have: 2, need: 1 },
    { item: 'base:alcohol', have: 1, need: 1 },
  ],
});
const view: CraftingView = { recipes: [bat, bandage], stations: [] };
const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  items: new Map([
    [
      'base:nailed-bat',
      { id: 'base:nailed-bat', kind: 'weapon_melee', maxStack: 1, weightKg: 1, durabilityMax: 10 },
    ],
  ]),
  recipes: new Map([
    [
      'base:craft-nailed-bat',
      { id: 'base:craft-nailed-bat', results: [{ item: 'base:nailed-bat', count: 1 }] },
    ],
  ]),
};
const item = (combine?: ItemView['combine']): ItemView => ({
  id: 7,
  def: 'base:wooden-stick',
  count: 1,
  weightKg: 0.5,
  ...(combine ? { combine } : {}),
});

describe('combine model', () => {
  it('prefers a ready recipe, else the first known one', () => {
    expect(pickCombineRecipe({ recipes: [bat.id, bandage.id], ready: true }, view)?.id).toBe(
      bandage.id,
    );
    expect(pickCombineRecipe({ recipes: [bat.id], ready: false }, view)?.id).toBe(bat.id);
    expect(pickCombineRecipe({ recipes: ['base:unknown'], ready: false }, view)).toBeUndefined();
    expect(pickCombineRecipe(undefined, view)).toBeUndefined();
  });

  it('row: ready / missing hint and no mark for plain items', () => {
    expect(combineRowVM(item(), view, content)).toBeUndefined();
    const miss = combineRowVM(item({ recipes: [bat.id], ready: false }), view, content);
    expect(miss).toEqual({
      state: 'miss',
      recipe: bat.id,
      hint: 'Połącz: Kij z gwoździami · brakuje 1 części',
    });
    const ready = combineRowVM(item({ recipes: [bandage.id], ready: true }), view, content);
    expect(ready?.state).toBe('ready');
    expect(ready?.hint).toMatch(/· gotowe$/);
  });

  it('row falls back to the sim flag without a crafting view', () => {
    expect(combineRowVM(item({ recipes: [bat.id], ready: true }), undefined, content)?.state).toBe(
      'ready',
    );
  });

  it('tooltip: parts have/need, skill, time, tools, missing list, disabled button', () => {
    const tip = combineTipVM(item({ recipes: [bat.id], ready: false }), view, content)!;
    expect(tip.partCount).toBe(3);
    expect(tip.partsOk).toBe(2);
    expect(tip.parts.map((p) => `${p.name} ${p.have}/${p.need} ${p.ok}`)).toEqual([
      'Kij 1/1 true',
      'Gwoździe 12/5 true',
      'Taśma klejąca 0/1 false',
    ]);
    expect(tip.skill).toMatchObject({ need: 1, have: 2, ok: true });
    expect(tip.time).toBe('0:30');
    expect(tip.tools[0]?.ok).toBe(true);
    expect(tip.result).toMatchObject({ name: 'Kij z gwoździami', category: 'Broń · Biała' });
    expect(tip.stats.map((s) => s.label)).toEqual(['Trwałość', 'Waga']);
    expect(tip.ready).toBe(false);
    expect(tip.missing).toBe('Taśma klejąca ×1');
  });

  it(`tooltip shows at most ${MAX_COMBINE_PARTS} parts`, () => {
    const many = recipe({
      id: 'base:many',
      parts: Array.from({ length: 6 }, (_, i) => ({ item: `base:p${i}`, have: 1, need: 1 })),
    });
    const tip = combineTipVM(
      item({ recipes: ['base:many'], ready: true }),
      { recipes: [many], stations: [] },
      content,
    )!;
    expect(tip.parts).toHaveLength(MAX_COMBINE_PARTS);
    expect(tip.ready).toBe(true);
  });

  it('command only when all parts are present', () => {
    expect(combineCommand(item({ recipes: [bat.id], ready: false }), view)).toBeUndefined();
    expect(combineCommand(item({ recipes: [bandage.id], ready: true }), view)).toEqual({
      type: 'combine',
      items: [7],
      recipe: bandage.id,
    });
    expect(combineCommand(undefined, view)).toBeUndefined();
  });
});
