import { describe, expect, it } from 'vitest';
import { ItemSchema } from './item.js';
import { DEFAULT_WINDOW_COVER_SETUP_SEC } from './window-cover.js';
import materials from '../../../data/base/items/materials.json' with { type: 'json' };
import clothing from '../../../data/base/items/clothing-basic.json' with { type: 'json' };

const sheet = {
  id: 'base:test-sheet',
  name: 'item.base.test-sheet.name',
  weightKg: 0.6,
  tags: [],
  kind: 'material',
};

describe('windowCover', () => {
  it('stała domyślna', () => {
    expect(DEFAULT_WINDOW_COVER_SETUP_SEC).toBe(10);
  });

  it('opcjonalne i bez wstawiania domyślnych', () => {
    expect(ItemSchema.parse(sheet).windowCover).toBeUndefined();
    expect(ItemSchema.parse({ ...sheet, windowCover: {} }).windowCover).toEqual({});
    expect(ItemSchema.parse({ ...sheet, windowCover: { setupSec: 15 } }).windowCover).toEqual({
      setupSec: 15,
    });
  });

  it('odrzuca setupSec <= 0 i nieznane pola', () => {
    expect(() => ItemSchema.parse({ ...sheet, windowCover: { setupSec: 0 } })).toThrow();
    expect(() => ItemSchema.parse({ ...sheet, windowCover: { setupSec: -1 } })).toThrow();
    expect(() => ItemSchema.parse({ ...sheet, windowCover: { foo: 1 } })).toThrow();
  });

  it('prześcieradło i bluza zasłaniają okno', () => {
    const all = [...materials, ...clothing].map((i) => ItemSchema.parse(i));
    const byId = new Map(all.map((i) => [i.id, i]));
    expect(byId.get('base:sheet')?.windowCover).toEqual({ setupSec: 15 });
    expect(byId.get('base:hoodie')?.windowCover).toEqual({});
  });
});
