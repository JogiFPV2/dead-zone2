import { describe, expect, it } from 'vitest';
import { baseBundle } from './base-bundle.js';

describe('meble ze schowkami: przegrody, prąd, pomieszczenia, klucze', () => {
  it('lodówka z zamrażarką to jeden mebel z dwiema przegrodami', async () => {
    const b = await baseBundle();
    const ff = b.containers['base:fridge-freezer']!;
    expect(ff.compartments).toEqual(['base:freezer']);
    expect(ff.defaultLootTable).toBe('base:kitchen-fridge');
    for (const c of Object.values(b.containers))
      for (const id of c.compartments ?? []) {
        expect(b.containers[id], `${c.id} → ${id}`).toBeDefined();
        expect(b.containers[id]!.compartments ?? [], `${id}: przegroda w przegrodzie`).toEqual([]);
        expect(b.containers[id]!.defaultLootTable, id).toBeDefined();
      }
  });

  it('piekarnik elektryczny wymaga prądu, kuchenka gazowa nie; lodówki chłodzą z prądem', async () => {
    const b = await baseBundle();
    expect(b.containers['base:oven']?.requiresPower).toBe(true);
    expect(b.containers['base:gas-stove']?.requiresPower).toBe(false);
    for (const id of ['fridge', 'freezer', 'fridge-freezer']) {
      const c = b.containers[`base:${id}`]!;
      expect(c.requiresPower, id).toBe(true);
      expect(c.spoilageMultiplier, id).toBeLessThan(1);
    }
  });

  it('każde pomieszczenie z placeIn i z tabel ma roomAccepts', async () => {
    const b = await baseBundle();
    const known = new Set(Object.keys(b.worldSettings.loot.roomAccepts));
    const used = new Set([
      ...Object.values(b.containers).flatMap((c) => c.placeIn ?? []),
      ...Object.values(b.lootTables).flatMap((t) => t.rooms),
    ]);
    expect([...used].filter((r) => !known.has(r))).toEqual([]);
  });

  it('klucze do budynku: szuflady w domu i zwłoki zombie', async () => {
    const b = await baseBundle();
    for (const id of ['kitchen-drawer', 'bedroom', 'desk', 'zombie-walker'])
      expect(b.lootTables[`base:${id}`]?.buildingKey, id).toBeGreaterThan(0);
    expect(b.lootTables['base:kitchen-fridge']?.buildingKey).toBeUndefined();
  });

  it('zlewy, kuchenka z piekarnikiem, wanna, prysznic, magnetowid i radio (meble stałe)', async () => {
    const b = await baseBundle();
    const range = b.containers['base:range']!;
    expect(range.requiresPower, 'palniki gazowe działają bez prądu').toBe(false);
    expect(range.compartments).toEqual(['base:oven']);
    expect(b.containers['base:oven']!.requiresPower, 'piekarnik elektryczny').toBe(true);
    for (const id of ['kitchen-sink', 'bathroom-sink'])
      expect(b.containers[`base:${id}`]?.defaultLootTable, id).toBe('base:under-sink');
    const placeable = (id: string) => {
      const it = b.items[id];
      if (it?.kind !== 'placeable') throw new Error(`${id}: brak placeable`);
      return it;
    };
    expect(placeable('base:range').placeable).toMatchObject({
      containerType: 'base:range',
      station: { id: 'base:station-fire' },
    });
    for (const id of ['base:bathtub', 'base:shower'])
      expect(placeable(id).placeable.containerType, `${id}: bez schowka`).toBeUndefined();
    for (const [id, tag] of [
      ['base:vcr', 'base:station-vcr'],
      ['base:radio-set', 'base:station-radio'],
      ['base:tv', 'base:station-tv'],
    ] as const) {
      expect(placeable(id).placeable.power?.consumesW, id).toBeGreaterThan(0);
      expect(placeable(id).tags, id).toContain(tag);
    }
    expect(b.items['base:radio']?.kind, 'przenośne radio zostaje przedmiotem').not.toBe(
      'placeable',
    );
    for (const id of ['base:range', 'base:bathtub', 'base:shower', 'base:vcr', 'base:radio-set'])
      expect(b.items[id]!.tags, id).not.toContain('base:outdoor-ok');
  });
});
