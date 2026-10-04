import type { NearbyContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, rebind } from '../input/bindings.js';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { buildHudContentIndex } from './content-index.js';
import {
  actionProgress,
  actionVMs,
  hintItems,
  hotbarCommand,
  hotbarHeldIndex,
  hotbarItems,
  interactIntent,
  moodleVMs,
  nearestContainer,
  statsVM,
} from './hud-model.js';
import { keyLabel, moveKeysLabel } from './key-label.js';
import { containerName, itemCountLabel, moodleName } from './labels.js';

const near = (id: number, x: number, y: number, searched = false): NearbyContainerView => ({
  id,
  kind: 'world',
  type: 'base:crate',
  x,
  y,
  z: 0,
  searched,
});
const content = buildHudContentIndex([
  { path: 'moodles/pain.json', json: { id: 'base:pain', polarity: 'negative' } },
  { path: 'moodles/well-fed.json', json: { id: 'base:well-fed', polarity: 'positive' } },
  {
    path: 'items/a.json',
    json: [
      { id: 'base:kitchen-knife', kind: 'weapon_melee', melee: { category: 'blade_short' } },
      { id: 'base:canned-beans', kind: 'food', maxStack: 5 },
    ],
  },
  { path: 'items/b.txt', text: 'ignored' },
]);
const withState = (patch: Partial<GameState>): GameState => ({ ...INITIAL_GAME_STATE, ...patch });

describe('HUD view models', () => {
  it('inverts sim needs into "what is left" bars', () => {
    const s = withState({
      player: {
        ...INITIAL_GAME_STATE.player,
        stats: { health: 72.4, thirst: 59, hunger: 42, fatigue: 16 },
      },
    });
    expect(statsVM(s)).toEqual({ health: 72, thirst: 41, hunger: 58, energy: 84 });
    expect(statsVM(INITIAL_GAME_STATE)).toEqual({
      health: 100,
      thirst: 100,
      hunger: 100,
      energy: 100,
    });
  });

  it('maps moodles with content polarity, labels and a stable `since`', () => {
    const since = new Map<string, number>();
    const a = moodleVMs({ 'base:pain': 2, 'base:well-fed': 1, 'base:zero': 0 }, content, since, 10);
    expect(a).toEqual([
      { id: 'base:pain', label: 'Ból', polarity: 'neg', level: 2, since: 10 },
      { id: 'base:well-fed', label: 'Najedzony', polarity: 'pos', level: 1, since: 10 },
    ]);
    const b = moodleVMs({ 'base:pain': 3 }, content, since, 20);
    expect(b[0]).toMatchObject({ level: 3, since: 10 });
    expect([...since.keys()]).toEqual(['base:pain']);
    expect(moodleVMs({ 'x:unknown': 9 }, content, since, 30)[0]).toMatchObject({
      label: 'Unknown',
      polarity: 'neg',
      level: 4,
    });
  });

  it('picks the nearest container and the interact intent', () => {
    const nearby = [near(1, 10, 10), near(2, 12, 10)];
    expect(nearestContainer(nearby, 12.4, 10.5)?.id).toBe(2);
    expect(nearestContainer([], 0, 0)).toBeUndefined();
    expect(interactIntent(withState({ nearby }), 10.5, 10.5)).toEqual({
      type: 'open',
      container: 1,
    });
    expect(interactIntent(withState({}), 0, 0)).toEqual({ type: 'none' });
    const open = { id: 1, kind: 'world' as const, capacityKg: 10, weightKg: 0, items: [] };
    expect(interactIntent(withState({ nearby, container: open }), 0, 0)).toEqual({ type: 'close' });
    const action = { kind: 'search' as const, startTick: 100, endTick: 200, queued: 0 };
    expect(interactIntent(withState({ nearby, action }), 0, 0)).toEqual({ type: 'cancel' });
    const eat = { ...action, kind: 'eat' as const };
    expect(interactIntent(withState({ nearby, action: eat }), 0, 0)).toEqual({ type: 'none' });
  });

  it('builds contextual action buttons with search progress', () => {
    expect(actionVMs(withState({}), 0, 0, 'F', 0)).toEqual([]);
    const nearby = [near(1, 0, 0, true)];
    expect(actionVMs(withState({ nearby }), 0.5, 0.5, 'F', 0)).toEqual([
      {
        id: 'interact',
        label: 'Otwórz',
        icon: 'target',
        key: 'F',
        variant: 'primary',
        enabled: true,
      },
    ]);
    const action = { kind: 'search' as const, startTick: 100, endTick: 200, queued: 0 };
    const s = withState({ nearby, action });
    expect(actionProgress(s, 125)).toBe(0.25);
    expect(actionVMs(s, 0.5, 0.5, 'F', 150)[0]).toMatchObject({
      label: 'Przeszukiwanie',
      enabled: true,
      progress: 0.5,
    });
    const open = { id: 1, kind: 'world' as const, capacityKg: 10, weightKg: 0, items: [] };
    expect(actionVMs(withState({ container: open }), 0, 0, 'F', 0)[0]).toMatchObject({
      label: 'Zamknij',
      variant: 'secondary',
    });
  });

  it('fills the hotbar from the main inventory with icons and stack counts', () => {
    const inv = {
      container: 2,
      loadKg: 1,
      capacityKg: 12,
      hardLimitKg: 18,
      carryLoad: 8,
      equipped: {},
      containers: {
        2: {
          id: 2,
          kind: 'inventory' as const,
          capacityKg: null,
          weightKg: 1,
          items: [
            { id: 7, def: 'base:kitchen-knife', count: 1, weightKg: 0.3 },
            { id: 8, def: 'base:canned-beans', count: 3, weightKg: 1.35 },
          ],
        },
      },
    };
    const slots = hotbarItems(withState({ inventory: inv }), content);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toMatchObject({ icon: 'knife', stackable: false, name: 'Nóż kuchenny' });
    expect(slots[1]).toMatchObject({ icon: 'can', stackable: true, count: 3 });
    expect(slots.slice(2)).toEqual([null, null, null]);
  });

  it('hotbar key puts the weapon into the hand and away again (regression: no weapon in hand)', () => {
    const inv = (equipped: Record<string, number>) => ({
      container: 2,
      loadKg: 1,
      capacityKg: 12,
      hardLimitKg: 18,
      carryLoad: 8,
      equipped,
      containers: {
        2: {
          id: 2,
          kind: 'inventory' as const,
          capacityKg: null,
          weightKg: 1,
          items: [
            { id: 8, def: 'base:canned-beans', count: 3, weightKg: 1.35 },
            { id: 7, def: 'base:kitchen-knife', count: 1, weightKg: 0.3 },
          ],
        },
      },
    });
    const empty = withState({ inventory: inv({}) });
    expect(hotbarCommand(empty, content, 1)).toEqual({
      type: 'equip',
      item: 7,
      slot: 'hand_primary',
    });
    expect(hotbarCommand(empty, content, 0)).toBeUndefined();
    expect(hotbarCommand(empty, content, 3)).toBeUndefined();
    expect(hotbarHeldIndex(empty)).toBeUndefined();
    const held = withState({ inventory: inv({ hand_primary: 7 }) });
    expect(hotbarCommand(held, content, 1)).toEqual({ type: 'unequip', slot: 'hand_primary' });
    expect(hotbarHeldIndex(held)).toBe(1);
  });

  it('labels keys from the current bindings', () => {
    expect(keyLabel('KeyF')).toBe('F');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('ControlRight')).toBe('Ctrl');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('Mouse0')).toBe('LPM');
    expect(keyLabel('F1')).toBe('F1');
    expect(moveKeysLabel(DEFAULT_BINDINGS)).toBe('WASD');
    const r = rebind(DEFAULT_BINDINGS, 'moveUp', 'ArrowUp');
    if (!r.ok) throw new Error('rebind failed');
    expect(moveKeysLabel(r.bindings)).toBe('↑/A/S/D');
    const hints = hintItems(DEFAULT_BINDINGS);
    expect(hints[0]).toEqual({ key: 'WASD', label: 'ruch' });
    expect(hints.map((h) => h.label)).toEqual(['ruch', 'sprint', 'ekwipunek', 'mapa']);
    expect(hints).toContainEqual({ key: 'I', label: 'ekwipunek' });
  });

  it('has Polish labels with plural rules and id fallbacks', () => {
    expect(moodleName('base:pain')).toBe('Ból');
    expect(containerName('base:fridge', 'world')).toBe('Lodówka');
    expect(containerName(undefined, 'ground')).toBe('Ziemia');
    expect([0, 1, 2, 5, 12, 22, 25].map(itemCountLabel)).toEqual([
      'pusto',
      '1 przedmiot',
      '2 przedmioty',
      '5 przedmiotów',
      '12 przedmiotów',
      '22 przedmioty',
      '25 przedmiotów',
    ]);
  });
});
