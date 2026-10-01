import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from './content-index.js';
import { leisureActionVMs } from './leisure-actions.js';
import { leisureSpots, sleepSurfaceAt, tvNearby } from './leisure-spots.js';
import { DEFAULT_SLEEP_SETTINGS } from './sleep-settings.js';

const def = (id: string, extra: object) => ({
  id,
  kind: 'placeable',
  maxStack: 1,
  weightKg: 1,
  ...extra,
});
const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  items: new Map([
    ['base:bed', def('base:bed', { sleepSurface: 'bed' })],
    ['base:sofa', def('base:sofa', { sleepSurface: 'sofa' })],
    ['base:tv', def('base:tv', { tv: true })],
    ['base:fridge', def('base:fridge', {})],
  ]),
};
const spots = leisureSpots(
  [
    { contentId: 'base:sofa', tx: 10, ty: 10, z: 0 },
    { contentId: 'base:bed', tx: 20, ty: 10, z: 0 },
    { contentId: 'base:tv', tx: 11, ty: 10, z: 0 },
    { contentId: 'base:fridge', tx: 12, ty: 10, z: 0 },
  ],
  content,
);
const keys = { sleep: 'N', tv: 'T' };
const state = (s: Partial<GameState> = {}, fatigue = 50): GameState => ({
  ...INITIAL_GAME_STATE,
  player: { ...INITIAL_GAME_STATE.player, stats: { fatigue } },
  ...s,
});

describe('leisure spots', () => {
  it('keeps beds, sofas and TVs only', () => {
    expect(spots.map((s) => s.kind)).toEqual(['sofa', 'bed', 'tv']);
  });

  it('sleep surface: bed beats sofa within 1.5 tiles, else floor', () => {
    expect(sleepSurfaceAt(spots, 10.5, 11.5)).toBe('sofa');
    expect(sleepSurfaceAt(spots, 20.5, 11)).toBe('bed');
    expect(sleepSurfaceAt(spots, 40, 40)).toBe('floor');
    expect(sleepSurfaceAt([...spots, { kind: 'bed', tx: 10, ty: 11, z: 0 }], 10.5, 11)).toBe('bed');
  });

  it('TV within reach', () => {
    expect(tvNearby(spots, 11.5, 11.5)).toBe(true);
    expect(tvNearby(spots, 15, 15)).toBe(false);
  });
});

describe('leisure buttons', () => {
  const vms = (s: GameState, px = 10.5, py = 11.2) =>
    leisureActionVMs(s, spots, px, py, keys, DEFAULT_SLEEP_SETTINGS);

  it('sleep on the sofa and TV next to them', () => {
    expect(vms(state()).map((v) => [v.id, v.label, v.enabled])).toEqual([
      ['watchTv', 'Oglądaj TV', true],
      ['sleep', 'Śpij · kanapa', true],
    ]);
  });

  it('no sleep button when not tired; disabled under threat or while busy', () => {
    expect(vms(state({}, 10)).map((v) => v.id)).toEqual(['watchTv']);
    expect(vms(state({ threat: 40 }), 40, 40)).toMatchObject([
      { id: 'sleep', label: 'Śpij na podłodze', enabled: false },
    ]);
    const busy = state({ action: { kind: 'read', startTick: 0, endTick: 10, queued: 0 } });
    expect(vms(busy).every((v) => !v.enabled)).toBe(true);
  });

  it('nothing while asleep or with a container open', () => {
    const asleep = state();
    expect(vms({ ...asleep, player: { ...asleep.player, sleeping: true } })).toEqual([]);
    expect(
      vms(state({ container: { id: 1, kind: 'world', capacityKg: 10, weightKg: 0, items: [] } })),
    ).toEqual([]);
  });

  it('watching: progress button that stops it', () => {
    const s = state({ tick: 50, action: { kind: 'watch', startTick: 0, endTick: 100, queued: 0 } });
    expect(vms(s)).toMatchObject([
      { id: 'watchTv', label: 'Oglądanie', progress: 0.5, enabled: true },
    ]);
  });
});
