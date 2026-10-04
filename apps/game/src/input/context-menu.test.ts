// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { allowsNativeContextMenu } from './context-menu.js';

describe('native context menu', () => {
  it('only in text fields', () => {
    expect(allowsNativeContextMenu(document.createElement('input'))).toBe(true);
    expect(allowsNativeContextMenu(document.createElement('textarea'))).toBe(true);
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    document.body.append(ed);
    expect(allowsNativeContextMenu(ed)).toBe(true);
    expect(allowsNativeContextMenu(document.createElement('canvas'))).toBe(false);
    expect(allowsNativeContextMenu(document.createElement('div'))).toBe(false);
    expect(allowsNativeContextMenu(null)).toBe(false);
  });
});
