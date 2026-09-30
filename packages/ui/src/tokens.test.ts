import { expect, it } from 'vitest';
import { colors } from './tokens.js';

it('uses hex colors for every token', () => {
  for (const value of Object.values(colors)) {
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  }
});
