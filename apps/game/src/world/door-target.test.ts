import type { OpeningState } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import {
  DOOR_FIRST_TILES,
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
    const near = { ...north, dist: DOOR_FIRST_TILES - 0.1, state: 'closed' as const };
    const far = { ...north, dist: DOOR_FIRST_TILES + 0.2, state: 'closed' as const };
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
