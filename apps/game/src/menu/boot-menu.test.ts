import { describe, expect, it } from 'vitest';
import { shouldShowMenu } from './boot-menu.js';

describe('shouldShowMenu', () => {
  it('shows the menu on a plain URL and skips it for dev/test params', () => {
    expect(shouldShowMenu('')).toBe(true);
    expect(shouldShowMenu('?map=test-town')).toBe(false);
    expect(shouldShowMenu('?menu=1&map=test')).toBe(true);
    expect(shouldShowMenu('?menu=0')).toBe(false);
    expect(shouldShowMenu('?menuTime=10')).toBe(true);
    expect(shouldShowMenu('?menu=0&menuTime=10')).toBe(false);
  });
});
