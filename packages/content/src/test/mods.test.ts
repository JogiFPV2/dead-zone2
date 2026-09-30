import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { material, memPack, miniBase, skill } from './helpers.js';

const codes = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => e.code);

describe('mody i nadpisania', () => {
  const mod = (overrides: unknown, extra: Record<string, unknown> = {}) =>
    memPack(
      'my-mod',
      { 'overrides/o.json': overrides, ...extra },
      { dependencies: [{ id: 'base' }] },
    );

  it('merge zmienia wartość i zachowuje resztę', () => {
    const r = validatePacks([
      mod({
        op: 'merge',
        type: 'item',
        target: 'base:knife',
        data: { weightKg: 0.2, melee: { rangeTiles: 1 } },
      }),
      miniBase(),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.loadOrder.map((m) => m.id)).toEqual(['base', 'my-mod']);
    const k = r.content.get('item', 'base:knife')?.data;
    expect(k?.weightKg).toBe(0.2);
    if (k?.kind === 'weapon_melee') {
      expect(k.melee.rangeTiles).toBe(1);
      expect(k.melee.attacksPerSec).toBe(1.5);
    }
  });

  it('nadpisanie nieistniejącego celu to bad_override', () => {
    const r = validatePacks([
      miniBase(),
      mod({ op: 'remove', type: 'item', target: 'base:unicorn' }),
    ]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'bad_override', file: 'overrides/o.json', path: '$.target' }),
    ]);
  });

  it('merge dający niepoprawną definicję jest odrzucony ze ścieżką do data', () => {
    const r = validatePacks([
      miniBase(),
      mod({ op: 'merge', type: 'item', target: 'base:knife', data: { weightKg: 'heavy' } }),
    ]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'schema', path: '$.data.weightKg' }),
    ]);
  });

  it('replace nie może zmieniać id', () => {
    const r = validatePacks([
      miniBase(),
      mod({ op: 'replace', type: 'item', target: 'base:plank', data: material('base:other') }),
    ]);
    expect(codes(r)).toEqual(['bad_override']);
  });

  it('remove usuwa definicję, a referencje do niej stają się błędem', () => {
    const r = validatePacks([
      miniBase(),
      mod({ op: 'remove', type: 'skill', target: 'base:blade-short' }),
    ]);
    expect(r.content.has('skill', 'base:blade-short')).toBe(false);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'missing_ref', path: '$[0].melee.skill' }),
    ]);
  });

  it('mod może dodać własne definicje odwołujące się do bazy', () => {
    const r = validatePacks([miniBase(), mod([], { 'skills/s.json': skill('my-mod:archery') })]);
    expect(r.errors).toEqual([]);
    expect(r.content.has('skill', 'my-mod:archery')).toBe(true);
  });

  it('brak wymaganej zależności i cykl kolejności', () => {
    expect(codes(validatePacks([mod([])]))).toEqual(['dependency']);
    const a = memPack('a', {}, { loadAfter: ['b'] });
    const b = memPack('b', {}, { loadAfter: ['a'] });
    expect(codes(validatePacks([a, b]))).toEqual(['dependency', 'dependency']);
  });

  it('kolejność: zależności, potem priority, potem id', () => {
    const r = validatePacks([
      memPack('zeta', {}),
      memPack('alpha', {}, { priority: 5 }),
      memPack('beta', {}, { loadBefore: ['zeta'], priority: 10 }),
    ]);
    expect(r.loadOrder.map((m) => m.id)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('world-settings: mody nadpisują pojedyncze pola', () => {
    const base = miniBase({});
    base.files.push({ path: 'world-settings.json', json: { dayLengthMinutes: 60 } });
    const m = mod([]);
    m.files.push({
      path: 'world-settings.json',
      json: { dayLengthMinutes: 90, carry: { baseCapacityKg: 15 } },
    });
    const r = validatePacks([base, m]);
    expect(r.errors).toEqual([]);
    expect(r.worldSettings.dayLengthMinutes).toBe(90);
    expect(r.worldSettings.carry).toEqual({
      baseCapacityKg: 15,
      overloadFatigueMul: 1.5,
      hardLimitMultiplier: 2,
    });
  });
});
