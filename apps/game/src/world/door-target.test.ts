import type { OpeningState } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import {
  DOOR_FIRST_TILES,
  OpeningFeedback,
  openingMenu,
  OPENING_ACTION_TITLES,
  openingPrimary,
  type DoorTarget,
  doorCentre,
  doorVerb,
  doorWins,
  lockedDoorToast,
  nearestDoor,
  type DoorEdge,
} from './door-target.js';

const north: DoorEdge = { tx: 4, ty: 6, z: 0, side: 'n' };
const west: DoorEdge = { tx: 8, ty: 6, z: 0, side: 'w' };
const upstairs: DoorEdge = { tx: 4, ty: 6, z: 1, side: 'n' };
const key = (e: DoorEdge) => `${e.tx},${e.ty},${e.z},${e.side}`;
const states =
  (s: Record<string, OpeningState> = {}) =>
  (e: DoorEdge): OpeningState =>
    s[key(e)] ?? 'closed';

describe('door targeting (F tap)', () => {
  it('edge centres follow the sim (north: x + 0.5, west: y + 0.5)', () => {
    expect(doorCentre(north)).toEqual({ x: 4.5, y: 6 });
    expect(doorCentre(west)).toEqual({ x: 8, y: 6.5 });
  });

  it('picks the nearest door in reach on the player level', () => {
    const edges = [north, west, upstairs];
    expect(nearestDoor(edges, states(), 4.5, 6.6, 0)).toMatchObject({
      tx: 4,
      side: 'n',
      state: 'closed',
    });
    expect(nearestDoor(edges, states(), 7.6, 6.5, 0)).toMatchObject({ tx: 8, side: 'w' });
    expect(nearestDoor(edges, states(), 4.5, 6.6, 1)).toMatchObject({ z: 1 });
    // Out of reach (> 1.4 tiles from every centre).
    expect(nearestDoor(edges, states(), 6.2, 9, 0)).toBeUndefined();
  });

  it('skips broken doors, keeps locked and open ones with their state', () => {
    const s = states({ [key(north)]: 'broken', [key(west)]: 'locked' });
    expect(nearestDoor([north], s, 4.5, 6.4, 0)).toBeUndefined();
    expect(nearestDoor([north, west], s, 7.8, 6.5, 0)).toMatchObject({ state: 'locked' });
    expect(nearestDoor([west], states({ [key(west)]: 'open' }), 7.8, 6.5, 0)?.state).toBe('open');
  });

  it('a door wins over a container only when nothing else is in reach or it is very close', () => {
    const base = { ...north, kind: 'door' as const, barricade: 0, glass: false };
    const near = { ...base, dist: DOOR_FIRST_TILES - 0.1, state: 'closed' as const };
    const far = { ...base, dist: DOOR_FIRST_TILES + 0.2, state: 'closed' as const };
    expect(doorWins(undefined, false)).toBe(false);
    expect(doorWins(far, false)).toBe(true);
    expect(doorWins(far, true)).toBe(false);
    expect(doorWins(near, true)).toBe(true);
  });

  it('prompt verbs and the locked toast', () => {
    expect(doorVerb('closed')).toBe('Otwórz');
    expect(doorVerb('open')).toBe('Zamknij');
    expect(doorVerb('locked')).toBe('Zamknięte');
    const rej = { type: 'commandRejected', playerId: 0, seq: 3, tick: 1, reason: 'locked' };
    expect(lockedDoorToast(rej, 0)).toBe('Zamknięte');
    expect(lockedDoorToast(rej, 1)).toBeUndefined();
    expect(lockedDoorToast({ ...rej, reason: 'out-of-range' }, 0)).toBeUndefined();
    expect(lockedDoorToast({ type: 'openingChanged' }, 0)).toBeUndefined();
  });
});

const target = (o: Partial<DoorTarget>): DoorTarget => ({
  tx: 1,
  ty: 2,
  z: 0,
  side: 'n',
  kind: 'door',
  dist: 0.5,
  state: 'closed',
  barricade: 0,
  glass: false,
  ...o,
});
const cmds = (t: DoorTarget) => openingMenu(t).map((o) => o.cmd);

describe('gates and windows (F targeting, #106)', () => {
  it('gates and windows are targets; broken windows stay, broken doors / gates do not', () => {
    const gate: DoorEdge = { tx: 4, ty: 6, z: 0, side: 'n', kind: 'gate' };
    const win: DoorEdge = { tx: 8, ty: 6, z: 0, side: 'w', kind: 'window' };
    const info =
      (s: OpeningState, barricade = 0, glass = true) =>
      () => ({ state: s, barricade, glass });
    expect(nearestDoor([gate], info('closed'), 4.5, 6.5, 0)).toMatchObject({ kind: 'gate' });
    expect(nearestDoor([gate], info('broken'), 4.5, 6.5, 0)).toBeUndefined();
    expect(nearestDoor([win], info('broken', 2, false), 7.6, 6.5, 0)).toMatchObject({
      kind: 'window',
      state: 'broken',
      barricade: 2,
      glass: false,
    });
  });

  it('tap: doors / gates toggle (locked too: the sim answers), windows climb when open / broken', () => {
    expect(openingPrimary(target({ kind: 'gate', state: 'open' }))?.cmd).toBe('toggleDoor');
    expect(openingPrimary(target({ state: 'locked' }))?.cmd).toBe('toggleDoor');
    expect(openingPrimary(target({ kind: 'window', state: 'broken' }))?.cmd).toBe('climbThrough');
    expect(openingPrimary(target({ kind: 'window', state: 'open' }))?.label).toBe('Przejdź');
    expect(openingPrimary(target({ kind: 'window', state: 'closed' }))).toBeUndefined();
    expect(openingPrimary(target({ barricade: 1 }))).toBeUndefined();
  });

  it('menu: the timed actions that fit the state', () => {
    expect(cmds(target({ state: 'closed' }))).toEqual(['barricade']);
    expect(cmds(target({ state: 'open' }))).toEqual([]);
    expect(cmds(target({ kind: 'gate', state: 'locked' }))).toEqual(['forceDoor', 'barricade']);
    expect(cmds(target({ kind: 'window', state: 'closed', glass: true }))).toEqual([
      'toggleDoor',
      'smashWindow',
      'barricade',
      'coverWindow',
    ]);
    expect(cmds(target({ kind: 'window', state: 'broken', glass: true }))).toEqual([
      'removeGlass',
      'barricade',
      'coverWindow',
    ]);
    expect(cmds(target({ kind: 'window', state: 'broken', glass: false }))).toEqual([
      'barricade',
      'coverWindow',
    ]);
    expect(cmds(target({ barricade: 2 }))).toEqual(['removeBarricade', 'barricade']);
    expect(cmds(target({ kind: 'window', barricade: 4 }))).toEqual([
      'removeBarricade',
      'coverWindow',
    ]);
  });

  it('prompt verbs', () => {
    expect(doorVerb(target({ barricade: 3 }))).toBe('Zabarykadowane');
    expect(doorVerb(target({ state: 'locked' }))).toBe('Zamknięte');
    expect(doorVerb(target({ kind: 'window', state: 'closed' }))).toBe('Okno');
    expect(doorVerb(target({ kind: 'gate', state: 'open' }))).toBe('Zamknij');
  });

  it('feedback toasts in Polish for the local player', () => {
    const fb = new OpeningFeedback(0);
    const rej = (seq: number, reason: string, playerId = 0) =>
      ({ type: 'commandRejected', tick: 1, playerId, seq, reason }) as never;
    fb.sent(1, target({}));
    expect(fb.toast(rej(1, 'missing-tool'))).toBe('Brak narzędzia');
    fb.sent(2, target({}));
    expect(fb.toast(rej(2, 'missing-parts'))).toBe('Brak materiałów');
    fb.sent(3, target({ barricade: 2 }));
    expect(fb.toast(rej(3, 'invalid-state'))).toBe('Zabarykadowane');
    expect(fb.toast(rej(9, 'missing-tool'))).toBeUndefined();
    expect(fb.toast(rej(9, 'locked'))).toBe('Zamknięte');
    expect(fb.toast(rej(9, 'locked', 1))).toBeUndefined();
    const forced = { type: 'doorForced', tick: 1, playerId: 0, tx: 1, ty: 2, z: 0, side: 'n' };
    expect(fb.toast({ ...forced, method: 'kick', success: false } as never)).toBe('Nie puściło');
    expect(fb.toast({ ...forced, method: 'pry', success: true } as never)).toBe('Wyważone');
  });
});

describe('window covers (protocol 47)', () => {
  const cover = { item: 'base:blanket', lightPass: 0.1, blocksSight: true };
  it('uncovered window: „Zasłoń…” last; covered: „Zdejmij” (planks or not); doors never', () => {
    expect(openingMenu(target({ kind: 'window', state: 'closed', glass: true })).at(-1)).toEqual({
      cmd: 'coverWindow',
      label: 'Zasłoń…',
    });
    expect(cmds(target({ kind: 'window', state: 'closed', glass: true, cover }))).toEqual([
      'toggleDoor',
      'smashWindow',
      'barricade',
      'uncoverWindow',
    ]);
    expect(cmds(target({ kind: 'window', barricade: 2, cover }))).toEqual([
      'removeBarricade',
      'barricade',
      'uncoverWindow',
    ]);
    expect(cmds(target({ state: 'closed' }))).toEqual(['barricade']);
  });
  it('nearestDoor carries the cover of windows only', () => {
    const win: DoorEdge = { tx: 8, ty: 6, z: 0, side: 'w', kind: 'window' };
    const door: DoorEdge = { tx: 8, ty: 6, z: 0, side: 'w' };
    const info = () => ({ state: 'closed' as const, cover });
    expect(nearestDoor([win], info, 7.6, 6.5, 0)?.cover).toEqual(cover);
    expect(nearestDoor([door], info, 7.6, 6.5, 0)?.cover).toBeUndefined();
  });
  it('ring titles of the cover actions', () => {
    expect(OPENING_ACTION_TITLES.coverWindow).toBe('Zasłanianie');
    expect(OPENING_ACTION_TITLES.uncoverWindow).toBe('Zdejmowanie');
  });
});
