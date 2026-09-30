// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { declsFor, parseRules, readCss, v } from '../../test/css.js';
import { actionState, createActionButton, type ActionButtonProps } from './index.js';

const css = readCss('components/action-button/action-button.css');
const s = (variant: string, state: string) =>
  `.dz-action[data-variant='${variant}'][data-state='${state}']`;
const base: ActionButtonProps = {
  label: 'Przeszukaj',
  icon: 'target',
  key: 'e',
  variant: 'primary',
  enabled: true,
};

describe('ActionButton states (spec §3.10 table)', () => {
  it('primary default', () => {
    expect(declsFor(css, ".dz-action[data-variant='primary']")).toEqual({
      '--_bg': v('color.accent.base'),
      '--_border': 'transparent',
      '--_fg': v('color.text.inverse'),
      '--_key-border': v('color.border.inverse'),
      '--_key-fg': v('color.text.inverse'),
      '--_progress-color': v('color.text.inverse'),
      '--_progress-opacity': '0.35',
    });
  });
  it('primary hover / pressed / disabled', () => {
    expect(declsFor(css, s('primary', 'hover'))).toEqual({ '--_bg': v('color.accent.hi') });
    expect(declsFor(css, s('primary', 'pressed'))).toEqual({ '--_bg': v('color.accent.lo') });
    expect(declsFor(css, s('primary', 'disabled'))).toEqual({
      '--_bg': v('color.bg.button.disabled'),
      '--_fg': v('color.text.disabled'),
      '--_key-border': v('color.border.strong'),
      '--_key-fg': v('color.text.disabled'),
    });
  });
  it('secondary default (glass blur)', () => {
    expect(declsFor(css, ".dz-action[data-variant='secondary']")).toEqual({
      '--_bg': v('color.bg.button.secondary.default'),
      '--_border': v('color.border.default'),
      '--_fg': v('color.text.primary'),
      '--_key-border': v('color.border.strong'),
      '--_key-fg': v('color.text.primary'),
      '--_progress-color': v('color.accent.base'),
      '--_progress-opacity': '1',
      'backdrop-filter': `blur(${v('blur.glass')})`,
    });
  });
  it('secondary hover / pressed / disabled', () => {
    expect(declsFor(css, s('secondary', 'hover'))).toEqual({
      '--_bg': v('color.bg.button.secondary.hover'),
      '--_border': v('color.border.strong'),
    });
    expect(declsFor(css, s('secondary', 'pressed'))).toEqual({
      '--_bg': v('color.bg.button.secondary.pressed'),
      '--_border': v('color.border.accent'),
    });
    expect(declsFor(css, s('secondary', 'disabled'))).toEqual({
      '--_bg': v('color.bg.button.secondary.default'),
      '--_border': v('color.border.default'),
      '--_fg': v('color.text.disabled'),
      '--_key-border': v('color.border.default'),
      '--_key-fg': v('color.text.disabled'),
    });
  });
  it('pressed moves 1 px down; focus-visible has a 2 px accent.hi outline', () => {
    expect(declsFor(css, ".dz-action[data-state='pressed']").transform).toBe('translateY(1px)');
    expect(declsFor(css, '.dz-action:focus-visible')).toEqual({
      outline: `2px solid ${v('color.accent.hi')}`,
      'outline-offset': '2px',
    });
    expect(declsFor(css, ".dz-action[data-state='disabled']").cursor).toBe('default');
  });
  it('mirrors forced states with real :hover / :active', () => {
    expect(declsFor(css, ".dz-action[data-variant='primary'][data-state='default']:hover")).toEqual(
      {
        '--_bg': v('color.accent.hi'),
      },
    );
    expect(
      declsFor(css, ".dz-action[data-variant='secondary'][data-state='default']:active"),
    ).toEqual({
      '--_bg': v('color.bg.button.secondary.pressed'),
      '--_border': v('color.border.accent'),
    });
  });
  it('spec wins over the mockup: both variants are 46 px (size.button), no per-variant height', () => {
    expect(declsFor(css, '.dz-action').height).toBe(v('size.button'));
    expect(
      parseRules(css)
        .filter((r) => r.decls.height !== undefined)
        .flatMap((r) => r.selectors)
        .filter((sel) => !sel.includes('__')), // icon / progress children
    ).toEqual(['.dz-action']);
  });

  it('has the spec geometry', () => {
    expect(declsFor(css, '.dz-action')).toMatchObject({
      height: v('size.button'),
      padding: `0 ${v('space.4-5')}`,
      gap: v('space.3'),
      'border-radius': v('radius.md'),
      font: v('font.label.md'),
      'letter-spacing': v('font.tracking.tight'),
      'text-transform': 'uppercase',
    });
  });
});

describe('ActionButton element', () => {
  it('derives the state; disabled wins', () => {
    expect(actionState(true)).toBe('default');
    expect(actionState(true, 'pressed')).toBe('pressed');
    expect(actionState(true, 'focus')).toBe('default');
    expect(actionState(false, 'hover')).toBe('disabled');
  });

  it('renders icon, label and an inverse key badge on primary', () => {
    const btn = createActionButton(base, document);
    expect(btn.el.tagName).toBe('BUTTON');
    expect(btn.el.dataset.variant).toBe('primary');
    expect(btn.el.dataset.state).toBe('default');
    expect(btn.el.querySelector('.dz-action__label')?.textContent).toBe('Przeszukaj');
    const key = btn.el.querySelector<HTMLElement>('.dz-key');
    expect(key?.textContent).toBe('e');
    expect(key?.dataset.variant).toBe('inverse');
    btn.update({ ...base, variant: 'secondary' });
    expect(key?.dataset.variant).toBe('light');
  });

  it('disabled buttons do not fire and are real disabled buttons', () => {
    const onActivate = vi.fn();
    const btn = createActionButton({ ...base, enabled: false, onActivate }, document);
    expect((btn.el as HTMLButtonElement).disabled).toBe(true);
    expect(btn.el.dataset.state).toBe('disabled');
    btn.el.click();
    expect(onActivate).not.toHaveBeenCalled();
    btn.update({ ...base, onActivate });
    btn.el.click();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('shows hold progress and forced focus', () => {
    const btn = createActionButton({ ...base, progress: 0.4, forced: 'focus' }, document);
    expect(btn.el.dataset.holding).toBe('');
    expect(btn.el.dataset.focus).toBe('');
    expect(
      btn.el
        .querySelector<HTMLElement>('.dz-action__progress')
        ?.style.getPropertyValue('--_progress'),
    ).toBe('0.4');
    btn.update(base);
    expect(btn.el.dataset.holding).toBeUndefined();
  });
});
