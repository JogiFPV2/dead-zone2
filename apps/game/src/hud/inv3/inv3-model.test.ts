import type { ContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex, type HudItemDef } from '../content-index.js';
import {
  clickColumn,
  containerSection,
  dropPreview,
  gridSlots,
  groupRows,
  itemState,
  moveCommands,
  pieceKg,
  playerSections,
  selectionInfo,
  sortRows,
  tooltipV3,
  usesLabel,
  visibleRows,
} from './inv3-model.js';

const defs: HudItemDef[] = [
  {
    id: 'base:crowbar',
    kind: 'weapon_melee',
    maxStack: 1,
    weightKg: 1.6,
    durabilityMax: 300,
    equipSlots: ['hand_primary'],
  },
  { id: 'base:canned-beans', kind: 'food', maxStack: 10, weightKg: 0.45 },
  { id: 'base:water-bottle', kind: 'drink', maxStack: 1, weightKg: 0.55, fillMax: 10 },
  { id: 'base:bandage', kind: 'medical', maxStack: 10, weightKg: 0.03 },
  {
    id: 'base:hiking-bag',
    kind: 'container',
    maxStack: 1,
    weightKg: 1.1,
    bagReductionPct: 55,
    equipSlots: ['back'],
  },
  { id: 'base:apple', kind: 'food', maxStack: 10, weightKg: 0.2 },
] as HudItemDef[];
const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  items: new Map(defs.map((d) => [d.id, d])),
};

const main: ContainerView = {
  id: 1,
  kind: 'inventory',
  capacityKg: null,
  weightKg: 4,
  items: [
    {
      id: 10,
      def: 'base:crowbar',
      count: 1,
      weightKg: 1.6,
      condition: 300,
      equipped: ['hand_primary'],
    },
    { id: 11, def: 'base:canned-beans', count: 2, weightKg: 0.9, freshness: 'fresh' },
    { id: 12, def: 'base:canned-beans', count: 1, weightKg: 0.45, freshness: 'stale' },
    { id: 13, def: 'base:water-bottle', count: 1, weightKg: 0.55, uses: 7 },
    { id: 14, def: 'base:hiking-bag', count: 1, weightKg: 1.1, equipped: ['back'], container: 2 },
    { id: 15, def: 'base:bandage', count: 3, weightKg: 0.09 },
  ],
};
const bag: ContainerView = { id: 2, kind: 'bag', capacityKg: 20, weightKg: 0, items: [] };
const crate: ContainerView = {
  id: 5,
  kind: 'world',
  type: 'base:crate',
  capacityKg: 2,
  weightKg: 1.2,
  items: [{ id: 20, def: 'base:apple', count: 4, weightKg: 0.8, freshness: 'fresh' }],
};
const s: GameState = {
  ...INITIAL_GAME_STATE,
  inventory: {
    container: 1,
    loadKg: 4,
    capacityKg: 12,
    hardLimitKg: 24,
    carryLoad: 30,
    equipped: { hand_primary: 10, back: 14 },
    containers: { 1: main, 2: bag },
  },
  container: crate,
};
const opts = { sort: { by: 'category', desc: false }, group: true } as const;

describe('inventory v3 model', () => {
  it('player panel: hands, pockets without the hand item or the worn bag, the bag section', () => {
    const [hands, pockets, bagSec] = playerSections(s, content, opts);
    expect(hands?.rows.map((r) => [r.name, r.hand])).toEqual([['Łom', 'P']]);
    expect(hands?.freeHands).toEqual(['L']);
    expect(pockets?.rows.map((r) => r.def)).toEqual([
      'base:bandage',
      'base:canned-beans',
      'base:water-bottle',
    ]);
    expect(bagSec).toMatchObject({ kind: 'bag', containerId: 2, capacityKg: 20, reductionPct: 55 });
  });

  it('„Stan”: durability, freshness, drink fill, uses', () => {
    expect(itemState(main.items[0]!, defs[0])).toEqual({ kind: 'condition', value: 300, max: 300 });
    expect(itemState(main.items[1]!, defs[1])).toEqual({ kind: 'freshness', value: 'fresh' });
    expect(itemState(main.items[3]!, defs[2])).toEqual({ kind: 'fill', value: 7, max: 10 });
    expect(itemState({ id: 1, def: 'x', count: 1, weightKg: 0, uses: 12 }, undefined)).toEqual({
      kind: 'uses',
      value: 12,
    });
    expect([1, 3, 5, 12, 22].map(usesLabel)).toEqual([
      '1 użycie',
      '3 użycia',
      '5 użyć',
      '12 użyć',
      '22 użycia',
    ]);
  });

  it('grouping: same def in different states is one group row with children', () => {
    const pockets = playerSections(s, content, opts)[1]!;
    const beans = pockets.rows.find((r) => r.def === 'base:canned-beans')!;
    expect(beans).toMatchObject({ key: 'gbase:canned-beans', count: 3, itemIds: [11, 12] });
    expect(beans.state).toBeUndefined();
    expect(beans.children?.length).toBe(2);
    expect(visibleRows(pockets.rows, new Set()).length).toBe(3);
    expect(visibleRows(pockets.rows, new Set([beans.key])).length).toBe(5);
    const flat = playerSections(s, content, { ...opts, group: false })[1]!;
    expect(flat.rows.length).toBe(4);
    expect(groupRows([], true)).toEqual([]);
  });

  it('sorting is client-side and stable; a column click reverses or switches', () => {
    const rows = playerSections(s, content, { ...opts, group: false })[1]!.rows;
    const by = (b: 'name' | 'weight' | 'count' | 'condition', desc = false): string[] =>
      sortRows(rows, { by: b, desc }).map((r) => r.key);
    expect(by('weight')).toEqual(['i11', 'i13', 'i12', 'i15']);
    expect(by('weight', true)).toEqual(['i15', 'i12', 'i13', 'i11']);
    expect(by('count')[0]).toBe('i15');
    expect(by('name')[0]).toBe('i15');
    expect(by('condition')).toEqual(['i12', 'i13', 'i11', 'i15']);
    expect(clickColumn({ by: 'name', desc: false }, 'name')).toEqual({ by: 'name', desc: true });
    expect(clickColumn({ by: 'name', desc: true }, 'weight')).toEqual({
      by: 'weight',
      desc: false,
    });
  });

  it('grid fills whole rows plus one empty row', () => {
    expect(gridSlots(0)).toBe(9);
    expect(gridSlots(3)).toBe(18);
    expect(gridSlots(9)).toBe(18);
    expect(gridSlots(10)).toBe(27);
  });

  it('drop preview: capacity after the drop, or BRAK MIEJSCA', () => {
    const box = containerSection(s, content, opts)!;
    expect(dropPreview(box, 0.5)).toEqual({
      label: 'UPUŚĆ: SKRZYNKA · +0,5 kg = 1,7 / 2,0',
      fits: true,
    });
    expect(dropPreview(box, 1)).toMatchObject({ fits: false });
    expect(dropPreview(box, 1).label.startsWith('BRAK MIEJSCA')).toBe(true);
    const pockets = playerSections(s, content, opts)[1]!;
    expect(dropPreview(pockets, 1)).toEqual({ label: 'UPUŚĆ: KIESZENIE · +1,0 kg', fits: true });
  });

  it('move commands: one piece without Ctrl, whole stack with it; pick up, move, drop, equip', () => {
    const [hands, pockets, bagSec] = playerSections(s, content, opts);
    const box = containerSection(s, content, opts)!;
    expect(moveCommands(s, content, [20], pockets!, false)).toEqual([
      { type: 'pickUp', item: 20, count: 1 },
    ]);
    expect(moveCommands(s, content, [20], bagSec!, true)).toEqual([
      { type: 'moveItem', item: 20, to: 2 },
    ]);
    expect(moveCommands(s, content, [11, 10], box, true)).toEqual([
      { type: 'moveItem', item: 11, to: 5 },
    ]);
    expect(moveCommands(s, content, [15, 20, 10], 'ground', false)).toEqual([
      { type: 'drop', item: 15, count: 1 },
    ]);
    expect(moveCommands(s, content, [11], pockets!, true)).toEqual([]);
    expect(moveCommands(s, content, [20], hands!, true)).toEqual([]);
    expect(pieceKg(main.items[5]!, false)).toBeCloseTo(0.03);
    expect(selectionInfo(s, new Set([11, 20, 99]))).toEqual({
      count: 2,
      weightKg: 1.7000000000000002,
    });
  });

  it('firearm tooltip: damage, magazine with capacity, shot noise; no duplicated „Pozostało”', () => {
    const t = tooltipV3(
      { id: 1, def: 'base:pistol', count: 1, weightKg: 0.9, uses: 5 },
      {
        id: 'base:pistol',
        kind: 'weapon_ranged',
        maxStack: 1,
        weightKg: 0.9,
        ranged: {
          ammo: 'base:ammo-9mm',
          feed: 'magazine',
          magazine: 'base:pistol-magazine',
          rangeTiles: 22,
          noiseRadius: 45,
          damage: { min: 18, max: 28 },
          reloadSec: 2.2,
        },
      },
      13,
    );
    expect(t.stats.slice(0, 3).map((x) => [x.label, x.value])).toEqual([
      ['Obrażenia', '18–28'],
      ['Magazynek', '5/13'],
      ['Hałas strzału', '45'],
    ]);
    expect(t.stats.some((x) => x.label === 'Pozostało')).toBe(false);
  });
});
