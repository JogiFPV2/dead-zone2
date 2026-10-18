import type { TargetView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { formatDistance, nextTargetId, targetCardVM, targetName } from './target-card-model.js';

const zombie = (over: Partial<TargetView> = {}): TargetView => ({
  id: 12,
  kind: 'zombie',
  typeId: 'base:walker',
  name: 'Zombie',
  hpPct: 64,
  distanceM: 12.4,
  state: 'chasing',
  hitChancePct: 78,
  source: 'aim',
  ...over,
});

describe('target card model', () => {
  it('no target → hidden', () => {
    expect(targetCardVM(undefined)).toBeUndefined();
  });

  it('aim: name, distance, hp band, state and the hit chance', () => {
    expect(targetCardVM(zombie())).toEqual({
      id: 12,
      kind: 'zombie',
      name: 'Zombie',
      distance: '12,4 m',
      hpPct: 64,
      band: 'ok',
      state: { label: 'ŚCIGA', tone: 'warn' },
      source: 'aim',
      sourceLabel: 'CEL',
      hitChancePct: 78,
    });
  });

  it('hit chance only for source aim (Designer)', () => {
    expect(targetCardVM(zombie({ source: 'lock' }))?.hitChancePct).toBeUndefined();
    expect(targetCardVM(zombie({ source: 'hit' }))?.hitChancePct).toBeUndefined();
    expect(targetCardVM(zombie({ source: 'lock' }))?.sourceLabel).toBe('NAMIERZONY');
  });

  it('dead body from the last hit: 0 %, low band, MARTWY, no hit chance', () => {
    const vm = targetCardVM(zombie({ hpPct: 0, state: 'dead', source: 'hit' }));
    expect(vm).toMatchObject({ hpPct: 0, band: 'low', state: { label: 'MARTWY', tone: 'dead' } });
    expect(vm?.hitChancePct).toBeUndefined();
  });

  it('attacking is danger, a car has no state', () => {
    expect(targetCardVM(zombie({ state: 'attacking', hpPct: 40 }))).toMatchObject({
      band: 'warn',
      state: { label: 'ATAKUJE', tone: 'danger' },
    });
    const car = targetCardVM({
      id: 3,
      kind: 'vehicle',
      typeId: 'base:sedan',
      name: 'Sedan',
      hpPct: 91,
      distanceM: 3,
      source: 'aim',
    });
    expect(car?.state).toBeUndefined();
    expect(car?.name).toBe('Sedan');
    expect(car?.hitChancePct).toBeUndefined();
  });

  it('Polish names via entityNamePl, players keep the sim name', () => {
    expect(targetName({ kind: 'animal', typeId: 'base:deer', name: '' })).toBe('Sarna');
    expect(targetName({ kind: 'player', typeId: '', name: 'Jan Kowalski' })).toBe('Jan Kowalski');
  });

  it('distance with a decimal comma', () => {
    expect(formatDistance(3)).toBe('3,0 m');
    expect(formatDistance(0.04)).toBe('0,0 m');
  });

  it('Tab cycles nearest first and wraps', () => {
    expect(nextTargetId([], undefined)).toBeUndefined();
    expect(nextTargetId([5, 9, 2], undefined)).toBe(5);
    expect(nextTargetId([5, 9, 2], 5)).toBe(9);
    expect(nextTargetId([5, 9, 2], 2)).toBe(5);
    expect(nextTargetId([5, 9, 2], 77)).toBe(5);
  });
});
