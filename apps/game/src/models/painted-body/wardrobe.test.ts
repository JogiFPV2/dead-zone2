import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRIEFS, GARMENTS, UNDERSHIRT, dressedBody, hairStyleOf, wornKey } from './wardrobe.js';

const ITEMS_DIR = new URL('../../../../../packages/content/data/base/items/', import.meta.url);
const clothing = readdirSync(ITEMS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap(
    (f) =>
      JSON.parse(readFileSync(new URL(f, ITEMS_DIR), 'utf8')) as {
        id: string;
        kind: string;
        clothing?: { slot: string };
      }[],
  )
  .filter((i) => i.kind === 'clothing');

const KIND_OF_SLOT: Record<string, string> = {
  head: 'head',
  face: 'face',
  torso_inner: 'inner',
  torso_outer: 'outer',
  hands: 'hands',
  legs: 'legs',
  feet: 'feet',
};

const base = { skin: '#d6a27c', hair: '#3a281c', hairStyle: 'short' as const };

describe('wardrobe: worn clothes → painted body', () => {
  it('every base clothing item has a garment look of its slot', () => {
    expect(clothing.length).toBeGreaterThanOrEqual(26);
    for (const c of clothing)
      expect(GARMENTS[c.id]?.kind, c.id).toBe(KIND_OF_SLOT[c.clothing!.slot]);
  });

  it('nothing worn: undershirt, briefs, bare feet and hands', () => {
    const s = dressedBody(base, {});
    expect(s).toMatchObject({ top: UNDERSHIRT, topCut: 'tank', trousers: BRIEFS, barefoot: true });
    expect(s.legLength).toBeLessThan(0.2);
    expect(s.gloves).toBeUndefined();
    expect(s.hat).toBeUndefined();
  });

  it('jacket over a t-shirt, creator colours, boots, cap, glasses', () => {
    const s = dressedBody(base, {
      torso_inner: { def: 'base:t-shirt' },
      torso_outer: { def: 'base:jacket', tint: ['#7b2b2e', '#e6e1d4'] },
      legs: { def: 'base:jeans', tint: ['#2c3047'] },
      feet: { def: 'base:rubber-boots' },
      head: { def: 'base:baseball-cap' },
      face: { def: 'base:glasses' },
    });
    expect(s).toMatchObject({
      top: '#7b2b2e',
      topTrim: '#e6e1d4',
      jacket: { under: '#d6d1c4' },
      trousers: '#2c3047',
      legLength: 1,
      barefoot: false,
      hat: { kind: 'cap' },
      glasses: '#1f1b19',
    });
    expect(s.boot).toBeGreaterThan(0.2);
  });

  it('hoodie is a closed pullover with a hood; a vest keeps the shirt sleeves', () => {
    expect(dressedBody(base, { torso_outer: { def: 'base:hoodie' } })).toMatchObject({
      topCut: 'pullover',
      hood: true,
      sleeve: 1,
    });
    const vest = dressedBody(base, {
      torso_inner: { def: 'base:flannel-shirt' },
      torso_outer: { def: 'base:vest' },
    });
    expect(vest.jacket).toEqual({ under: '#8a4b32', sleeveless: true });
    expect(vest.sleeve).toBe(1);
  });

  it('hair cut from the creator head, stable worn key', () => {
    expect(hairStyleOf('base:head-ponytail')).toBe('long');
    expect(hairStyleOf('base:head-bald')).toBe('bald');
    expect(hairStyleOf('base:head-short')).toBe('short');
    expect(wornKey({ legs: { def: 'a' }, feet: { def: 'b', tint: ['#1'] } })).toBe(
      wornKey({ feet: { def: 'b', tint: ['#1'] }, legs: { def: 'a' } }),
    );
  });
});
