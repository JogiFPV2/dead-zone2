import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from '../content-index.js';
import type { FurnitureView } from './furniture-api.js';
import { furnitureMenuVM } from './furniture-model.js';

const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  recipes: new Map([
    ['base:cook-stew', { id: 'base:cook-stew', results: [{ item: 'base:stew', count: 1 }] }],
  ]),
};
const state: GameState = {
  ...INITIAL_GAME_STATE,
  crafting: {
    recipes: [
      {
        id: 'base:cook-stew',
        kind: 'craft',
        category: 'cooking',
        state: 'available',
        parts: [],
        tools: [],
        skills: [],
        burnChance: 0.3,
        durationMin: 20,
      },
    ],
    stations: [],
  },
};
const view = (typeId: string, actions: FurnitureView['actions']): FurnitureView => ({
  furnitureId: 1,
  typeId,
  contentId: `base:${typeId}`,
  x: 0.5,
  y: 0.5,
  z: 0,
  actions,
});

describe('furniture menu, protocols 29–33', () => {
  it('groups stove recipes into „Gotuj” with dish names and burn chance', () => {
    const vm = furnitureMenuVM(
      view('stove', [
        {
          id: 'cook:base:cook-stew',
          labelPl: 'Gulasz',
          recipe: 'base:cook-stew',
          enabled: true,
          durationMin: 20,
        },
      ]),
      { state, content },
    );
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0]).toMatchObject({ id: 'cook', label: 'Gotuj', enabled: true, submenu: true });
    expect(vm.rows[0]!.children![0]).toMatchObject({
      actionId: 'cook:base:cook-stew',
      label: 'Gulasz',
    });
    expect(vm.rows[0]!.children![0]!.detail).toMatch(/^przypalenie 30% · 20 min$/);
  });

  it('folds sleep-until rows into the sleep window', () => {
    const vm = furnitureMenuVM(
      view('bed', [
        { id: 'sleep', labelPl: 'Śpij', enabled: true },
        { id: 'sleep-until:morning', labelPl: 'Śpij do rana', enabled: true },
        { id: 'rest', labelPl: 'Odpocznij', enabled: true },
      ]),
      { state, content },
    );
    expect(vm.rows.map((r) => r.id)).toEqual(['sleep', 'rest']);
  });
});
