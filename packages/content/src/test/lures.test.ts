import { describe, expect, it } from 'vitest';
import { LureItemSchema, type LureItem } from '../schemas/item/lure.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { miniBase } from './helpers.js';

const lure = async (id: string) => {
  const item = (await baseBundle()).items[id];
  if (item?.kind !== 'lure') throw new Error(`${id} nie jest wabikiem`);
  return item as LureItem;
};

const minimal = {
  id: 'base:l',
  name: 'item.base.l.name',
  kind: 'lure',
  weightKg: 1,
  lure: {
    noise: { radiusTiles: 10 },
    durationSec: 5,
    trigger: { type: 'timer', delaySec: { min: 1, max: 2 } },
    lingerSec: { min: 1, max: 2 },
  },
};

describe('wabiki', () => {
  it('schemat: zasięgi i czasy jako dane, przedziały min ≤ max', () => {
    expect(LureItemSchema.parse(minimal).lure.consumedOnUse).toBe(false);
    const bad = { ...minimal, lure: { ...minimal.lure, lingerSec: { min: 5, max: 1 } } };
    expect(LureItemSchema.safeParse(bad).success).toBe(false);
    const code = { ...minimal, lure: { ...minimal.lure, trigger: { type: 'script' } } };
    expect(LureItemSchema.safeParse(code).success).toBe(false);
  });

  it('walidator: tag pilota i baterii musi mieć jakiś przedmiot', () => {
    const remote = { type: 'remote', remoteTag: 'base:no-remote', rangeTiles: 5 };
    const power = { batteryTag: 'base:no-battery', activationsPerBattery: 1 };
    const item = { ...minimal, lure: { ...minimal.lure, trigger: remote, power } };
    const r = validatePacks([miniBase({ 'items/l.json': item })]);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([
      ['missing_tag', '$.lure.trigger.remoteTag'],
      ['missing_tag', '$.lure.power.batteryTag'],
    ]);
  });

  it('elektroniczny: pilot do 60 m, 30 s hałasu na 40 m, zombie zostają 20–40 s, baterie', async () => {
    const l = (await lure('base:lure-electronic')).lure;
    expect(l.trigger).toEqual({ type: 'remote', remoteTag: 'base:lure-remote', rangeTiles: 60 });
    expect(l.noise.radiusTiles).toBe(40);
    expect(l.durationSec).toBe(30);
    expect(l.lingerSec).toEqual({ min: 20, max: 40 });
    expect(l.power?.batteryTag).toBe('base:battery');
    expect(l.consumedOnUse).toBe(false);
    expect((await baseBundle()).items['base:lure-remote']?.tags).toContain('base:lure-remote');
  });

  it('biegający: opóźnienie 3–30 s, kierunek gracza, 15 m, 20 s hałasu na 30 m, jednorazowy', async () => {
    const l = (await lure('base:lure-running')).lure;
    expect(l.trigger).toEqual({ type: 'timer', delaySec: { min: 3, max: 30 } });
    expect(l.runner).toMatchObject({ distanceTiles: 15, direction: 'player-set' });
    expect(l.noise.radiusTiles).toBe(30);
    expect(l.durationSec).toBe(20);
    expect(l.consumedOnUse).toBe(true);
  });

  it('receptura biegającego wabika i loot wabików oraz części', async () => {
    const b = await baseBundle();
    const r = b.recipes['base:craft-running-lure']!;
    expect(r.ingredients.map((i) => ('item' in i ? i.item : i.tag)).sort()).toEqual(
      ['base:mechanical-part', 'base:rabbit-carcass', 'base:wire'].sort(),
    );
    expect(r.results).toEqual([{ item: 'base:lure-running', count: 1 }]);
    const level = r.skills.find((s) => ['base:mechanics', 'base:electrical'].includes(s.skill));
    expect(level?.level).toBeGreaterThanOrEqual(1);
    expect(level?.level).toBeLessThanOrEqual(2);
    const looted = new Set(
      Object.values(b.lootTables).flatMap((t) =>
        t.entries.flatMap((e) => ('item' in e ? [e.item] : [])),
      ),
    );
    for (const id of [
      'base:lure-electronic',
      'base:lure-remote',
      'base:mechanical-part',
      'base:wire',
    ])
      expect(looted.has(id), id).toBe(true);
  });
});
