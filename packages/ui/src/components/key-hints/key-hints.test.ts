// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, readCss, v } from '../../test/css.js';
import {
  createKeyHints,
  DEFAULT_HINTS,
  HINTS_VISIBLE_MS,
  hintsVisible,
  toggleHints,
} from './index.js';

const css = readCss('components/key-hints/key-hints.css');
const MIN = 60_000;

describe('Key-hint row (spec §3.11)', () => {
  it('renders the spec row with the " · " separator, keys from the binding', () => {
    const row = createKeyHints({ items: DEFAULT_HINTS, visible: true }, document);
    expect(row.el.textContent).toBe(
      'WASD ruch · Shift sprint · Ctrl skradanie · Tab ekwipunek · C postać · M mapa · Esc menu',
    );
    expect(row.el.querySelectorAll('.dz-hints__key')).toHaveLength(7);
    row.update({ items: [{ key: 'Z', label: 'ruch' }], visible: true });
    expect(row.el.textContent).toBe('Z ruch');
    expect(row.el.classList.contains('dz-glass')).toBe(true);
  });

  it('shows for the first 10 minutes on auto, F1 toggles to a fixed setting', () => {
    expect(HINTS_VISIBLE_MS).toBe(10 * MIN);
    expect(hintsVisible('auto', 9 * MIN)).toBe(true);
    expect(hintsVisible('auto', 10 * MIN)).toBe(false);
    expect(hintsVisible('on', 60 * MIN)).toBe(true);
    expect(hintsVisible('off', 0)).toBe(false);
    expect(toggleHints('auto', 0)).toBe('off');
    expect(toggleHints('auto', 11 * MIN)).toBe('on');
    expect(toggleHints('on', 0)).toBe('off');
  });

  it('hiding fades out (data-hidden) and then sets hidden', () => {
    const row = createKeyHints({ items: DEFAULT_HINTS, visible: true }, document);
    document.body.append(row.el);
    row.update({ items: DEFAULT_HINTS, visible: false });
    expect(row.el.dataset.hidden).toBe('');
    expect(row.el.hidden).toBe(false);
    row.el.dispatchEvent(new Event('transitionend'));
    expect(row.el.hidden).toBe(true);
    row.update({ items: DEFAULT_HINTS, visible: true });
    expect(row.el.hidden).toBe(false);
    expect(row.el.dataset.hidden).toBeUndefined();
    row.destroy();
  });

  it('uses the spec tokens', () => {
    expect(declsFor(css, '.dz-hints')).toMatchObject({
      height: v('size.hints'),
      padding: `0 ${v('space.3-5')}`,
      'border-radius': v('radius.md'),
      color: v('color.text.muted'),
      font: v('font.mono.sm'),
      'pointer-events': 'none',
    });
  });
});
