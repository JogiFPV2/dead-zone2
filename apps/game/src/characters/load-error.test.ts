import { describe, expect, it } from 'vitest';
import { loadErrorText } from './load-error.js';

describe('load error text', () => {
  it('old map generator → Polish message', () => {
    expect(loadErrorText('save: made with world generator v123, this build has v456')).toBe(
      'Ten zapis pochodzi ze starej wersji mapy i nie można go wczytać.',
    );
  });
  it('unknown messages pass through', () => {
    expect(loadErrorText('boom')).toBe('boom');
  });
});
