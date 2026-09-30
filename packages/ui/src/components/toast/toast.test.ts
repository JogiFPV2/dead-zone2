// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declsFor, keyframes, readCss, v } from '../../test/css.js';
import {
  createToastStack,
  isExpired,
  MAX_VISIBLE_TOASTS,
  pushToast,
  TOAST_KINDS,
  TOAST_LIFETIME_MS,
  toastText,
  type ToastVM,
} from './index.js';

const css = readCss('components/toast/toast.css');

describe('toast queue rules (spec §3.4)', () => {
  it('lifetimes per kind come from motion.toast.life.*', () => {
    expect(TOAST_LIFETIME_MS).toEqual({ damage: 3000, gain: 2500, info: 4000, warning: 3500 });
  });

  it('adds new toasts on top and keeps at most 4; the 5th evicts the oldest', () => {
    let list: ToastVM[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = pushToast(list, { kind: 'info', text: `t${i}` }, i * 2000, `id${i}`);
      list = r.list;
      if (i < 5) expect(r.evicted).toEqual([]);
      else expect(r.evicted.map((t) => t.text)).toEqual(['t1']);
    }
    expect(MAX_VISIBLE_TOASTS).toBe(4);
    expect(list.map((t) => t.text)).toEqual(['t5', 't4', 't3', 't2']);
  });

  it('merges identical toasts within 1 s and resets their lifetime', () => {
    const a = pushToast([], { kind: 'gain', value: '+3', text: 'Brodawka' }, 0, 'a');
    const b = pushToast(a.list, { kind: 'gain', value: '+3', text: 'Brodawka' }, 900, 'b');
    expect(b.merged).toBe(true);
    expect(b.list).toHaveLength(1);
    expect(b.toast).toMatchObject({ id: 'a', count: 2, createdAt: 900 });
    expect(toastText(b.toast)).toBe('Brodawka ×2');
    // Different value or later than 1 s: a new toast.
    expect(
      pushToast(b.list, { kind: 'gain', value: '+4', text: 'Brodawka' }, 1000, 'c').merged,
    ).toBe(false);
    expect(
      pushToast(b.list, { kind: 'gain', value: '+3', text: 'Brodawka' }, 1901, 'd').merged,
    ).toBe(false);
    expect(isExpired(b.toast, 900 + 2499)).toBe(false);
    expect(isExpired(b.toast, 900 + 2500)).toBe(true);
  });
});

describe('ToastStack element', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('renders icon, value and text per kind', () => {
    const stack = createToastStack({}, document);
    stack.push({ kind: 'damage', value: '−12 HP', text: 'Ugryzienie' });
    const t = stack.el.querySelector('.dz-toast');
    expect(t?.getAttribute('data-kind')).toBe('damage');
    expect(t?.querySelector('svg')?.getAttribute('data-icon')).toBe('warning');
    expect(t?.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(t?.querySelector('.dz-toast__value')?.textContent).toBe('−12 HP');
    expect(t?.querySelector('.dz-toast__text')?.textContent).toBe('Ugryzienie');
    expect(t?.hasAttribute('data-enter')).toBe(true);
    stack.push({ kind: 'info', text: 'Dzień 2' });
    const info = stack.el.firstElementChild;
    expect(info?.querySelector('svg')?.getAttribute('data-icon')).toBe('info');
    expect((info?.querySelector('.dz-toast__value') as HTMLElement).hidden).toBe(true);
    expect(stack.el.getAttribute('aria-live')).toBe('polite');
  });

  it('expires after the kind lifetime with an exit animation, then removes the node', () => {
    const stack = createToastStack({}, document);
    stack.push({ kind: 'gain', value: '+3', text: 'Brodawka' });
    vi.advanceTimersByTime(2499);
    expect(stack.el.querySelector('[data-exit]')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(stack.el.querySelector('[data-exit]')).not.toBeNull();
    expect(stack.toasts).toEqual([]);
    vi.advanceTimersByTime(160);
    expect(stack.el.children).toHaveLength(0);
  });

  it('merging resets the lifetime and updates the counter in place', () => {
    const stack = createToastStack({}, document);
    stack.push({ kind: 'gain', value: '+3', text: 'Brodawka' });
    vi.advanceTimersByTime(800);
    stack.push({ kind: 'gain', value: '+3', text: 'Brodawka' });
    expect(stack.el.children).toHaveLength(1);
    expect(stack.el.querySelector('.dz-toast__text')?.textContent).toBe('Brodawka ×2');
    vi.advanceTimersByTime(2000); // 2800 ms after the first push, 2000 after the merge
    expect(stack.el.querySelector('[data-exit]')).toBeNull();
    vi.advanceTimersByTime(500);
    expect(stack.el.querySelector('[data-exit]')).not.toBeNull();
  });

  it('the 5th toast makes the oldest leave immediately', () => {
    const stack = createToastStack({}, document);
    for (let i = 1; i <= 5; i++) stack.push({ kind: 'info', text: `t${i}` });
    expect(stack.toasts.map((t) => t.text)).toEqual(['t5', 't4', 't3', 't2']);
    const exiting = stack.el.querySelectorAll('[data-exit]');
    expect([...exiting].map((n) => n.querySelector('.dz-toast__text')?.textContent)).toEqual([
      't1',
    ]);
    vi.advanceTimersByTime(160);
    expect(stack.el.children).toHaveLength(4);
    stack.clear();
    expect(stack.el.children).toHaveLength(0);
  });
});

describe('Toast CSS', () => {
  it('geometry and type colours follow the spec table', () => {
    expect(declsFor(css, '.dz-toast')).toMatchObject({
      height: v('size.toast'),
      padding: `0 ${v('space.4-5')}`,
      gap: v('space.2-5'),
      'border-radius': v('radius.md'),
      background: v('color.bg.hud'),
      color: v('color.text.primary'),
      font: v('font.mono.md'),
      border: `${v('border.1')} solid var(--_border)`,
    });
    expect(declsFor(css, '.dz-toasts').gap).toBe(v('space.2'));
    const expected = {
      damage: ['color.danger.base', 'color.danger.text'],
      gain: ['color.success.base', 'color.success.text'],
      info: ['color.border.strong', 'color.text.primary'],
      warning: ['color.warning.base', 'color.warning.text'],
    } as const;
    for (const kind of TOAST_KINDS) {
      const [border, accent] = expected[kind];
      expect(declsFor(css, `.dz-toast[data-kind='${kind}']`)).toEqual({
        '--_border': v(border),
        '--_accent': v(accent),
      });
    }
    expect(declsFor(css, '.dz-toast__value').font).toBe(v('font.label.md'));
  });

  it('enters from the right in motion.base and leaves in motion.toast.exit', () => {
    expect(declsFor(css, '.dz-toast[data-enter]').animation).toBe(
      `dz-toast-in ${v('motion.base')} ${v('motion.ease.out')} both`,
    );
    expect(declsFor(css, '.dz-toast[data-exit]').animation).toBe(
      `dz-toast-out ${v('motion.toast.exit')} ${v('motion.ease.in')} forwards`,
    );
    expect(keyframes(css)).toEqual(['dz-toast-in', 'dz-toast-out']);
    expect(css).toContain('translateX(var(--space-6))');
    expect(declsFor(css, '.dz-toast').transition).toBe(
      `transform ${v('motion.base')} ${v('motion.ease.out')}`,
    );
  });
});
