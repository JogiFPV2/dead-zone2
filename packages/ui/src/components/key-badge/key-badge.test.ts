// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { declsFor, readCss, v } from '../../test/css.js';
import { createKeyBadge } from './index.js';
import { tokens } from '../../tokens/tokens.generated.js';

const css = readCss('components/key-badge/key-badge.css');

it('light and inverse variants follow spec §3 KeyBadge', () => {
  expect(declsFor(css, '.dz-key')).toMatchObject({
    'min-width': v('size.key'),
    height: v('size.key'),
    border: `${v('border.1')} solid ${v('color.border.strong')}`,
    'border-radius': v('radius.sm'),
    background: v('color.bg.key'),
    color: v('color.text.primary'),
    font: v('font.label.sm'),
    'text-transform': 'uppercase',
  });
  expect(declsFor(css, ".dz-key[data-variant='inverse']")).toEqual({
    'border-color': v('color.border.inverse'),
    background: 'transparent',
    color: v('color.text.inverse'),
  });
  // Spec wins over the mockup (0.6): bg.key is 0.9.
  expect(tokens.color.bg.key).toBe('rgba(14, 17, 19, 0.90)');
  const key = createKeyBadge({ keyLabel: 'g' }, document);
  expect(key.el.dataset.variant).toBe('light');
  expect(key.el.textContent).toBe('g');
});
