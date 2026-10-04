import { describe, expect, it } from 'vitest';
import { polishItemName } from './polish-names.js';

describe('Polish base content names', () => {
  it('uses Kłoda for base:log', () => {
    expect(polishItemName('base:log')).toBe('Kłoda');
  });

  it('has a Polish label for every base item', () => {
    const files = import.meta.glob<unknown>('../../../../packages/content/data/base/items/*.json', {
      eager: true,
      import: 'default',
    });
    for (const value of Object.values(files)) {
      const defs = Array.isArray(value) ? value : [value];
      for (const def of defs) {
        if (!def || typeof def !== 'object' || !('id' in def)) continue;
        const id = (def as { id: unknown }).id;
        if (typeof id === 'string') expect(polishItemName(id), id).toBeTruthy();
      }
    }
  });
});
