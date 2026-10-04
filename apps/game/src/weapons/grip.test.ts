import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gripOfItem, gripOfKind, type GripSource } from './grip.js';

const ITEMS = join(__dirname, '../../../../packages/content/data/base/items');
const items = (): GripSource[] =>
  readdirSync(ITEMS)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const raw: unknown = JSON.parse(readFileSync(join(ITEMS, f), 'utf8'));
      return (Array.isArray(raw) ? raw : []) as GripSource[];
    });
const byId = new Map(items().map((i) => [i.id, i]));
const grip = (id: string) => gripOfItem(byId.get(id) ?? {});

describe('gripOfItem', () => {
  it('content grip wins over the fallback', () => {
    expect(gripOfItem({ kind: 'weapon_melee', grip: 'spear', melee: { category: 'blunt' } })).toBe(
      'spear',
    );
  });

  it('maps the base weapons to their grips', () => {
    expect(grip('base:crowbar')).toBe('two_hand');
    expect(grip('base:baseball-bat')).toBe('two_hand');
    expect(grip('base:fire-axe')).toBe('two_hand');
    expect(grip('base:hammer')).toBe('one_hand');
    expect(grip('base:machete')).toBe('one_hand');
    expect(grip('base:kitchen-knife')).toBe('knife');
    expect(grip('base:spear')).toBe('spear');
    expect(grip('base:pistol')).toBe('pistol');
    expect(grip('base:revolver')).toBe('pistol');
    expect(grip('base:hunting-rifle')).toBe('rifle');
    expect(grip('base:pump-shotgun')).toBe('rifle');
    expect(gripOfItem({ id: 'mod:chainsaw', kind: 'weapon_melee' })).toBe('chainsaw');
  });

  it('every base weapon has a grip, non-weapons none', () => {
    for (const it of items()) {
      const isWeapon = it.kind === 'weapon_melee' || it.kind === 'weapon_ranged';
      expect(gripOfItem(it) !== undefined, String(it.id)).toBe(isWeapon);
    }
  });
});

describe('gripOfKind', () => {
  it('maps the sim weapon kinds', () => {
    expect(gripOfKind('firearm-long', true)).toBe('rifle');
    expect(gripOfKind('firearm-short', false)).toBe('pistol');
    expect(gripOfKind('blade', false)).toBe('knife');
    expect(gripOfKind('unarmed', false)).toBeUndefined();
  });
});
