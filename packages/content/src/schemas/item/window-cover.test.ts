import { describe, expect, it } from 'vitest';
import { ItemSchema } from './item.js';
import {
  DEFAULT_WINDOW_COVER_BLOCKS_SIGHT,
  DEFAULT_WINDOW_COVER_LIGHT_PASS,
  DEFAULT_WINDOW_COVER_SETUP_SEC,
} from './window-cover.js';
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
    expect(DEFAULT_WINDOW_COVER_LIGHT_PASS).toBe(0);
    expect(DEFAULT_WINDOW_COVER_BLOCKS_SIGHT).toBe(true);
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
    expect(() => ItemSchema.parse({ ...sheet, windowCover: { lightPass: -0.1 } })).toThrow();
    expect(() => ItemSchema.parse({ ...sheet, windowCover: { lightPass: 1.1 } })).toThrow();
    expect(() => ItemSchema.parse({ ...sheet, windowCover: { blocksSight: 'yes' } })).toThrow();
    const ok = { blocksSight: false, lightPass: 0.5, setupSec: 3 };
    expect(ItemSchema.parse({ ...sheet, windowCover: ok }).windowCover).toEqual(ok);
  });

  it('przedmioty zasłaniające okno', () => {
    const all = [...materials, ...clothing].map((i) => ItemSchema.parse(i));
    const byId = new Map(all.map((i) => [i.id, i]));
    const want: Record<string, { lightPass: number; setupSec: number }> = {
      'base:sheet': { lightPass: 0.1, setupSec: 15 },
      'base:hoodie': { lightPass: 0.3, setupSec: 10 },
      'base:curtain': { lightPass: 0.15, setupSec: 5 },
      'base:jacket': { lightPass: 0.3, setupSec: 10 },
      'base:blanket': { lightPass: 0.1, setupSec: 15 },
      'base:tarp': { lightPass: 0, setupSec: 20 },
    };
    for (const [id, wc] of Object.entries(want)) expect(byId.get(id)?.windowCover).toEqual(wc);
  });
});
