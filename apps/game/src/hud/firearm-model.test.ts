import type { CombatView, ContainerView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex, type HudItemDef } from './content-index.js';
import {
  dockSide,
  firearmVM,
  lowThreshold,
  noiseRingRadius,
  pipStyle,
  reloadProgressAt,
  reticleRadius,
} from './firearm-model.js';

const item = (d: Partial<HudItemDef> & { id: string }): HudItemDef => ({
  kind: 'misc',
  maxStack: 1,
  weightKg: 0,
  ...d,
});
const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  items: new Map(
    [
      item({
        id: 'base:pistol',
        kind: 'weapon_ranged',
        ranged: {
          ammo: 'base:ammo-9mm',
          feed: 'magazine',
          magazine: 'base:pistol-magazine',
          rangeTiles: 22,
          noiseRadius: 45,
          reloadSec: 2.2,
        },
      }),
      item({
        id: 'base:pump-shotgun',
        kind: 'weapon_ranged',
        ranged: {
          ammo: 'base:shotgun-shell',
          feed: 'internal',
          capacity: 5,
          rangeTiles: 12,
          noiseRadius: 70,
          reloadSec: 5.5,
          loadSecPerRound: 0.8,
        },
      }),
      item({
        id: 'base:pistol-magazine',
        kind: 'magazine',
        magazine: { ammo: 'base:ammo-9mm', capacity: 13 },
      }),
      item({ id: 'base:kitchen-knife', kind: 'weapon_melee' }),
    ].map((d) => [d.id, d]),
  ),
};
const keys = { reload: 'R', attack: 'LPM', inventory: 'I' };

function state(combat: Partial<CombatView>, items: ContainerView['items'] = []): GameState {
  return {
    ...INITIAL_GAME_STATE,
    combat: {
      zombiesKilled: 0,
      weapon: null,
      condition: null,
      maxCondition: null,
      readyTick: 0,
      ...combat,
    },
    inventory: {
      container: 1,
      loadKg: 0,
      capacityKg: 12,
      hardLimitKg: 30,
      carryLoad: 0,
      equipped: {},
      containers: { 1: { id: 1, kind: 'inventory', capacityKg: null, weightKg: 0, items } },
    },
  };
}
const vm = (s: GameState, tick = 0) => firearmVM(s, content, tick, 50, keys);

describe('firearm model', () => {
  it('only for a firearm in hand', () => {
    expect(vm(state({}))).toBeUndefined();
    expect(vm(state({ weapon: 'base:kitchen-knife' }))).toBeUndefined();
  });

  it('normal / low / empty with reserve, mags and hints', () => {
    const rounds = [{ id: 5, def: 'base:ammo-9mm', count: 34, weightKg: 0.3 }];
    const fullMag = { id: 6, def: 'base:pistol-magazine', count: 1, weightKg: 0.1, uses: 13 };
    const n = vm(state({ weapon: 'base:pistol', ammo: 12, capacity: 15 }, rounds))!;
    expect(n).toMatchObject({
      state: 'normal',
      loaded: 12,
      capacity: 15,
      reserve: 34,
      pips: 'bars',
      noiseRadius: 45,
    });
    expect(n.hint).toBeUndefined();
    // low: no loaded magazine → no reload hint; with one → glass [R]
    expect(vm(state({ weapon: 'base:pistol', ammo: 3, capacity: 15 }, rounds))).toMatchObject({
      state: 'low',
    });
    expect(
      vm(state({ weapon: 'base:pistol', ammo: 3, capacity: 15 }, rounds))!.hint,
    ).toBeUndefined();
    expect(
      vm(state({ weapon: 'base:pistol', ammo: 3, capacity: 15 }, [...rounds, fullMag]))!.hint,
    ).toEqual({
      variant: 'glass',
      key: 'R',
      label: 'Przeładuj',
    });
    // empty: primary [R] with a loaded mag, [I] load a magazine with loose rounds, else none
    expect(
      vm(state({ weapon: 'base:pistol', ammo: 0, capacity: 13 }, [fullMag]))!.hint,
    ).toMatchObject({
      variant: 'primary',
      key: 'R',
    });
    expect(vm(state({ weapon: 'base:pistol', ammo: 0, capacity: 13 }, rounds))!.hint).toMatchObject(
      {
        key: 'I',
        label: 'Załaduj magazynek',
      },
    );
    expect(vm(state({ weapon: 'base:pistol', ammo: 0, capacity: 0 }))!.hint).toMatchObject({
      label: 'Brak amunicji',
      disabled: true,
    });
  });

  it('jammed beats empty / low; reloading beats jammed', () => {
    const j = vm(state({ weapon: 'base:pistol', ammo: 12, capacity: 15, jammed: true }))!;
    expect(j.state).toBe('jammed');
    expect(j.hint).toMatchObject({ variant: 'primary', key: 'R', label: 'Usuń zacięcie · 2.2 s' });
    const r = vm(
      state({
        weapon: 'base:pistol',
        ammo: 12,
        capacity: 15,
        jammed: true,
        reloadKind: 'unjam',
        reloadStartTick: 100,
        reloadUntil: 144,
      }),
      122,
    )!;
    expect(r).toMatchObject({ state: 'reloading', title: 'Usuwanie zacięcia', progress: 0.5 });
    expect(r.secLeft).toBeCloseTo(1.1);
  });

  it('single-round loading: shell state, shells pips, interrupt hint', () => {
    const s = vm(
      state(
        {
          weapon: 'base:pump-shotgun',
          ammo: 2,
          capacity: 5,
          reloadKind: 'single',
          reloadStartTick: 0,
          reloadUntil: 16,
        },
        [{ id: 7, def: 'base:shotgun-shell', count: 5, weightKg: 0.2 }],
      ),
      4,
    )!;
    expect(s).toMatchObject({
      state: 'shell',
      title: 'Ładowanie naboi',
      pips: 'shells',
      reserve: 5,
      progress: 0.25,
    });
    expect(s.hint).toMatchObject({ variant: 'glass', key: 'LPM', label: 'Przerwij ładowanie' });
    // capacity from content when the view has none
    expect(vm(state({ weapon: 'base:pump-shotgun', ammo: 5 }))!.capacity).toBe(5);
  });

  it('helpers', () => {
    expect([15, 6, 2].map(lowThreshold)).toEqual([4, 2, 1]);
    expect([0, 5, 13, 30, 40].map(pipStyle)).toEqual(['none', 'shells', 'bars', 'bars', 'pill']);
    expect([0, 2, 3, 4].map(dockSide)).toEqual(['left', 'left', 'right', 'right']);
    expect(reticleRadius(0.03, 14, 40)).toBeCloseTo(16.8, 1);
    expect(reticleRadius(0.001, 1, 40)).toBe(8);
    expect(reticleRadius(0.5, 30, 40)).toBe(48);
    expect(noiseRingRadius(10)).toBe(25);
    expect(noiseRingRadius(45)).toBe(94);
    const c: CombatView = {
      zombiesKilled: 0,
      weapon: 'x',
      condition: null,
      maxCondition: null,
      readyTick: 0,
    };
    expect(reloadProgressAt(c, 5)).toBeUndefined();
    expect(
      reloadProgressAt({ ...c, reloadKind: 'magazine', reloadUntil: 10, reloadProgress: 0.3 }, 5),
    ).toBe(0.3);
  });
});
