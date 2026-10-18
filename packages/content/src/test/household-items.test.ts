import { describe, expect, it } from 'vitest';
import { lootCategoryOf } from '../loot/loot-category-of.js';
import { reachableLootItems } from '../loot/reachable-items.js';
import { baseBundle } from './base-bundle.js';

describe('przedmioty codzienne (partia 8): klucz, woda utleniona, jedzenie, łazienka, leki', () => {
  it('klucz do budynku ma tag base:building-key (sim dokłada go przez buildingKey)', async () => {
    const b = await baseBundle();
    const keys = Object.values(b.items).filter((i) => i.tags.includes('base:building-key'));
    expect(keys.map((k) => k.id)).toEqual(['base:building-key']);
  });

  it('woda utleniona odkaża (efekt disinfect) i działa w recepturach jak wódka', async () => {
    const b = await baseBundle();
    const hp = b.items['base:hydrogen-peroxide']!;
    expect(hp.kind).toBe('medical');
    if (hp.kind === 'medical') expect(hp.medical.effects).toContain('disinfect');
    expect(hp.tags).toContain('base:disinfectant-liquid');
  });

  it('kategorie: lodówka świeże, spiżarka suche, łazienka leki i higiena', async () => {
    const b = await baseBundle();
    const cat = (id: string) => lootCategoryOf(b.items[`base:${id}`]!);
    for (const id of ['cheese', 'eggs', 'sausage', 'butter', 'bread', 'frozen-food'])
      expect(cat(id), id).toBe('food-fresh');
    for (const id of ['pasta', 'rice', 'flour', 'sugar', 'salt', 'spices'])
      expect(cat(id), id).toBe('food-canned');
    for (const id of ['milk', 'beer', 'juice', 'soda']) expect(cat(id), id).toBe('drink');
    for (const id of ['can-opener', 'cutlery', 'baking-tray']) expect(cat(id), id).toBe('cookware');
    for (const id of ['hydrogen-peroxide', 'painkillers', 'antibiotics', 'vitamins'])
      expect(cat(id), id).toBe('medical');
    for (const id of ['soap', 'toothpaste', 'cleaning-supplies', 'pen'])
      expect(cat(id), id).toBe('household');
    expect(cat('towel')).toBe('fabric');
  });

  it('trafiają do właściwych schowków', async () => {
    const b = await baseBundle();
    const has = (table: string, id: string) =>
      reachableLootItems(b.lootTables, table).has(`base:${id}`);
    for (const id of ['milk', 'cheese', 'eggs', 'butter', 'sausage'])
      expect(has('base:kitchen-fridge', id), id).toBe(true);
    expect(has('base:freezer', 'frozen-food')).toBe(true);
    for (const id of ['pasta', 'rice', 'flour', 'sugar'])
      expect(has('base:kitchen', id), id).toBe(true);
    for (const id of ['cutlery', 'can-opener'])
      expect(has('base:kitchen-drawer', id), id).toBe(true);
    expect(has('base:oven', 'baking-tray')).toBe(true);
    for (const id of ['hydrogen-peroxide', 'painkillers', 'soap', 'toothpaste'])
      expect(has('base:bathroom', id), id).toBe(true);
    for (const id of ['painkillers', 'antibiotics', 'vitamins'])
      expect(has('base:pharmacy', id), id).toBe(true);
    expect(has('base:under-sink', 'cleaning-supplies')).toBe(true);
    expect(has('base:kitchen-fridge', 'painkillers')).toBe(false);
    expect(has('base:bathroom', 'cheese')).toBe(false);
  });

  it('psucie w skali: kiełbasa szybciej niż ser, chleb najszybciej', async () => {
    const b = await baseBundle();
    const fresh = (id: string) => {
      const it = b.items[`base:${id}`]!;
      return it.kind === 'food' ? it.food.spoilage?.freshMin : undefined;
    };
    expect(fresh('bread')!).toBeLessThan(fresh('sausage')!);
    expect(fresh('sausage')!).toBeLessThan(fresh('cheese')!);
    expect(fresh('pasta')).toBeUndefined();
  });

  it('wytrychy i rękawice pod id z fikstur simu (tagi base:lockpick, base:gloves)', async () => {
    const b = await baseBundle();
    const tagged = (tag: string) =>
      Object.values(b.items)
        .filter((i) => i.tags.includes(tag))
        .map((i) => i.id)
        .sort();
    expect(tagged('base:lockpick')).toEqual(['base:lockpick', 'base:lockpick-fork']);
    expect(tagged('base:gloves')).toEqual(['base:gloves']);
    const gloves = b.items['base:gloves']!;
    expect(gloves.kind).toBe('clothing');
    if (gloves.kind === 'clothing') expect(gloves.clothing.slot).toBe('hands');
    const key = b.items['base:building-key']!;
    expect(key).not.toHaveProperty('buildingId');
  });

  it('rękawice i wytrych w garażu i warsztacie; klucz przez buildingKey w szufladach i na zombie', async () => {
    const b = await baseBundle();
    const has = (table: string, id: string) =>
      reachableLootItems(b.lootTables, table).has(`base:${id}`);
    for (const table of ['base:garage', 'base:toolbox']) {
      expect(has(table, 'gloves'), table).toBe(true);
      expect(has(table, 'lockpick'), table).toBe(true);
    }
    expect(has('base:warehouse', 'gloves')).toBe(true);
    const bk = (id: string) => b.lootTables[id]?.buildingKey ?? 0;
    for (const id of ['base:kitchen-drawer', 'base:desk', 'base:bedroom', 'base:zombie-walker'])
      expect(bk(id), id).toBeGreaterThan(0);
  });

  it('łóżko podwójne: mebel do spania 2×2', async () => {
    const b = await baseBundle();
    const bed = b.items['base:double-bed']!;
    expect(bed.kind).toBe('placeable');
    if (bed.kind === 'placeable') {
      expect(bed.placeable.sleepSurface).toBe('bed');
      expect(bed.placeable.footprint).toEqual({ w: 2, h: 2 });
    }
  });

  it('drzwi zewnętrzne zamknięte na klucz z szansą 0,4 (razem z kluczami i wytrychami)', async () => {
    const b = await baseBundle();
    expect(b.worldSettings.openings.locks.exteriorLockedChance).toBe(0.4);
  });
});
