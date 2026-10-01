import type { CraftingView, RecipeStatusView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from './content-index.js';
import {
  HAND,
  craftSkillsVM,
  formatMinutes,
  maxCraftable,
  pickSelected,
  recipeDetailVM,
  recipeGroupsVM,
  stationsVM,
  upgradeVM,
  workshopRecipes,
} from './workshop-model.js';

const recipe = (r: Partial<RecipeStatusView> & { id: string }): RecipeStatusView => ({
  kind: 'craft',
  category: 'tools',
  state: 'available',
  parts: [],
  tools: [],
  skills: [],
  durationMin: 10,
  ...r,
});

const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  stations: new Map([
    [
      'base:workbench',
      {
        id: 'base:workbench',
        levels: [
          {
            level: 1,
            item: 'base:workbench',
            recipe: 'base:build-workbench',
            craftTimeMultiplier: 1,
          },
          {
            level: 2,
            item: 'base:workbench-2',
            recipe: 'base:upgrade-workbench-2',
            craftTimeMultiplier: 0.8,
          },
        ],
      },
    ],
  ]),
  recipes: new Map([
    ['base:plank', { id: 'base:plank', results: [{ item: 'base:plank', count: 2 }] }],
  ]),
};

const view: CraftingView = {
  recipes: [
    recipe({
      id: 'base:plank',
      parts: [{ item: 'base:log', have: 5, need: 2 }],
      tools: [{ tag: 'saw', have: 1, need: 1 }],
      station: { id: 'base:workbench', minLevel: 1, level: 1 },
    }),
    recipe({
      id: 'base:bandage-rag',
      category: 'medical',
      parts: [{ item: 'base:rag', have: 1, need: 1 }],
    }),
    recipe({
      id: 'base:spear',
      category: 'weapons',
      state: 'missingParts',
      parts: [{ item: 'base:stick', have: 0, need: 1 }],
    }),
    recipe({
      id: 'base:molotov',
      category: 'weapons',
      state: 'skillLocked',
      skills: [{ skill: 'base:cooking', need: 3, have: 1 }],
    }),
    recipe({ id: 'base:build-workbench', category: 'building' }),
    recipe({
      id: 'base:upgrade-workbench-2',
      category: 'building',
      state: 'missingParts',
      parts: [{ item: 'base:nails', have: 4, need: 10 }],
      station: { id: 'base:workbench', minLevel: 1, level: 1 },
    }),
    recipe({ id: 'base:mix', kind: 'combine' }),
  ],
  stations: [
    { id: 'base:workbench', level: 1, x: 10, y: 10, upgrade: 'base:upgrade-workbench-2' },
    { id: 'base:workbench', level: 1, x: 40, y: 40, upgrade: 'base:upgrade-workbench-2' },
  ],
};

describe('workshop model', () => {
  it('maxCraftable: limited by the scarcest part, 0 when blocked or a tool is missing', () => {
    expect(maxCraftable(view.recipes[0]!)).toBe(2);
    expect(maxCraftable(view.recipes[2]!)).toBe(0);
    expect(maxCraftable(recipe({ id: 'x' }))).toBe(1);
    expect(maxCraftable(recipe({ id: 'x', tools: [{ tag: 'saw', have: 0, need: 1 }] }))).toBe(0);
  });

  it('workshop list drops combine and station upgrade recipes', () => {
    const ids = workshopRecipes(view, content).map((r) => r.id);
    expect(ids).not.toContain('base:mix');
    expect(ids).not.toContain('base:upgrade-workbench-2');
    expect(ids).toContain('base:build-workbench');
  });

  it('stations: hand first, workbench built with the distance to the nearest one', () => {
    const st = stationsVM(view, content, HAND, 11, 11);
    expect(st[0]).toMatchObject({ key: HAND, built: true, selected: true });
    expect(st[1]).toMatchObject({
      key: 'base:workbench',
      level: 1,
      maxLevel: 2,
      built: true,
      distance: 1,
      recipes: 1,
      available: 1,
    });
  });

  it('groups by category, filters and searches; badges', () => {
    const all = recipeGroupsVM(view, content, HAND, {
      filter: 'all',
      query: '',
      selected: undefined,
    });
    const rows = all.flatMap((g) => g.rows);
    expect(rows.map((r) => r.id).sort()).toEqual(
      ['base:bandage-rag', 'base:build-workbench', 'base:molotov', 'base:spear'].sort(),
    );
    const weapons = all.find((g) => g.category === 'weapons')!;
    expect(weapons.rows.map((r) => r.id)).toEqual(['base:spear', 'base:molotov']);
    expect(weapons.rows[0]).toMatchObject({ badge: 'Brak części', tone: 'warn', subTone: 'warn' });
    expect(weapons.rows[1]).toMatchObject({ locked: true, tone: 'lock', subTone: 'danger' });

    const avail = recipeGroupsVM(view, content, HAND, {
      filter: 'available',
      query: '',
      selected: undefined,
    });
    expect(avail.flatMap((g) => g.rows).every((r) => r.tone === 'ok' || r.tone === 'combo')).toBe(
      true,
    );
    const unlocked = recipeGroupsVM(view, content, HAND, {
      filter: 'hideLocked',
      query: '',
      selected: undefined,
    });
    expect(unlocked.flatMap((g) => g.rows).some((r) => r.locked)).toBe(false);

    const bench = recipeGroupsVM(view, content, 'base:workbench', {
      filter: 'all',
      query: '',
      selected: 'base:plank',
    });
    expect(bench[0]!.rows[0]).toMatchObject({
      badge: 'Można +2',
      tone: 'combo',
      selected: true,
      item: 'base:plank',
    });
    expect(pickSelected(bench, 'gone')).toBe('base:plank');
    expect(
      recipeGroupsVM(view, content, 'base:workbench', {
        filter: 'all',
        query: 'zzz',
        selected: undefined,
      }),
    ).toEqual([]);
  });

  it('detail and upgrade', () => {
    const d = recipeDetailVM(view, content, 'base:plank')!;
    expect(d).toMatchObject({ max: 2, resultCount: 2, minutes: 10, item: 'base:plank' });
    expect(d.parts[0]).toMatchObject({ have: 5, need: 2, ok: true });
    expect(d.station).toMatchObject({ level: 1, minLevel: 1, ok: true });
    expect(upgradeVM(view, content, HAND, 0, 0)).toBeUndefined();
    const up = upgradeVM(view, content, 'base:workbench', 39, 39)!;
    expect(up).toMatchObject({
      toLevel: 2,
      x: 40,
      y: 40,
      ready: false,
      recipe: 'base:upgrade-workbench-2',
    });
  });

  it('skills and time format', () => {
    const s = craftSkillsVM(
      [
        { id: 'base:cooking', level: 1, xp: 25, next: 100 },
        { id: 'base:sprinting', level: 2, xp: 0, next: 100 },
      ],
      view,
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ level: 1, pct: 0.25 });
    expect(formatMinutes(64)).toBe('1:04');
    expect(formatMinutes(5)).toBe('0:05');
  });
});
