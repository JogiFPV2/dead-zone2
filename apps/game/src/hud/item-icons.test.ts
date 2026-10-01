import { describe, expect, it } from 'vitest';
import { parseIconIndex } from './item-icons.js';

describe('item icons', () => {
  it('maps item ids to URLs under the base, ignoring junk', () => {
    const m = parseIconIndex(
      { 'base:hammer': 'hammer.png', 'base:x': '../evil.js', 'base:y': 3 },
      '/play/icons/',
    );
    expect([...m]).toEqual([['base:hammer', '/play/icons/hammer.png']]);
    expect(parseIconIndex(null, '/').size).toBe(0);
  });
});
