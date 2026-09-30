// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declsFor, readCss, v } from '../../test/css.js';
import { durabilityRow, formatRange } from '../stat-row/index.js';
import {
  createItemTooltip,
  DEFAULT_ITEM_ACTIONS,
  TOOLTIP_WIDTH,
  tooltipPosition,
  type TooltipItem,
} from './index.js';

const css = readCss('components/item-tooltip/item-tooltip.css');
/** The approved mockup (`deadzone-shots/tooltip-item.png`). */
const knife: TooltipItem = {
  name: 'Nóż kuchenny',
  category: 'Broń · Krótka ostra',
  stats: [
    { label: 'Obrażenia', value: formatRange(0.6, 1.2) },
    { label: 'Zasięg', value: '0,8', unit: 'm' },
    { label: 'Szybkość ataku', value: '1,4', unit: '/s' },
    { label: 'Waga', value: '0,3', unit: 'kg' },
    durabilityRow(8, 10),
  ],
};
const all = (root: HTMLElement, sel: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)].map((n) => n.textContent);

describe('ItemTooltip content (approved redesign)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('renders name, category and one row per stat', () => {
    const tip = createItemTooltip({ item: knife, slot: 0 }, document);
    expect(tip.el.querySelector('.dz-tooltip__name')?.textContent).toBe('Nóż kuchenny');
    expect(tip.el.querySelector('.dz-tooltip__category')?.textContent).toBe('Broń · Krótka ostra');
    expect(all(tip.el, '.dz-statrow__label')).toEqual([
      'Obrażenia',
      'Zasięg',
      'Szybkość ataku',
      'Waga',
      'Trwałość',
    ]);
    expect(all(tip.el, '.dz-statrow__num')).toEqual(['0,6–1,2', '0,8', '1,4', '0,3', '8/10']);
    expect(all(tip.el, '.dz-statrow__unit')).toEqual(['', 'm', '/s', 'kg', '']);
    const bars = tip.el.querySelectorAll<HTMLElement>('.dz-statrow__bar');
    expect([...bars].map((b) => b.hidden)).toEqual([true, true, true, true, false]);
    expect(
      tip.el.querySelector<HTMLElement>('.dz-statrow__fill:not([style*="scaleX(0)"])'),
    ).not.toBeNull();
  });

  it('footer: key chips with labels, default LPM atak · PPM celuj · Q upuść, configurable', () => {
    const tip = createItemTooltip(null, document);
    tip.select(knife);
    const keys = () => all(tip.el, '.dz-keyfoot .dz-key');
    expect(DEFAULT_ITEM_ACTIONS.map((a) => `${a.key} ${a.label}`)).toEqual([
      'LPM atak',
      'PPM celuj',
      'Q upuść',
    ]);
    expect(keys()).toEqual(['LPM', 'PPM', 'Q']);
    expect(all(tip.el, '.dz-keyfoot__item')).toEqual(['LPMatak', 'PPMceluj', 'Qupuść']);
    expect(tip.el.querySelector('.dz-keyfoot .dz-key')?.getAttribute('data-variant')).toBe('hint');
    tip.select({ ...knife, actions: [{ key: 'LPM', label: 'pij' }] });
    expect(keys()).toEqual(['LPM']);
    tip.select({ ...knife, actions: [] });
    expect(tip.el.querySelector<HTMLElement>('.dz-keyfoot')?.hidden).toBe(true);
  });

  it('after a selection change: visible for 2.5 s, then hidden', () => {
    const tip = createItemTooltip(null, document);
    expect(tip.el.getAttribute('aria-hidden')).toBe('true');
    tip.select(knife);
    expect(tip.el.dataset.visible).toBe('');
    vi.advanceTimersByTime(2499);
    expect(tip.el.dataset.visible).toBe('');
    vi.advanceTimersByTime(1);
    expect(tip.el.dataset.visible).toBeUndefined();
    tip.update({ item: knife, slot: 2 });
    expect(tip.el.dataset.visible).toBe('');
    tip.update(null);
    expect(tip.el.dataset.visible).toBeUndefined();
  });

  it('hover: visible after 250 ms and stays until the cursor leaves', () => {
    const tip = createItemTooltip(null, document);
    tip.hover(knife);
    vi.advanceTimersByTime(249);
    expect(tip.el.dataset.visible).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(tip.el.dataset.visible).toBe('');
    tip.select(knife);
    vi.advanceTimersByTime(10_000);
    expect(tip.el.dataset.visible).toBe('');
    tip.unhover();
    expect(tip.el.dataset.visible).toBeUndefined();
  });

  it('sits 10 px above the hotbar at the slot offset, clamped to the safe margin', () => {
    const hotbar = { left: 775, top: 834, width: 370, height: 82 };
    const size = { width: TOOLTIP_WIDTH, height: 246 };
    const vp = { width: 1920, height: 1080 };
    expect(TOOLTIP_WIDTH).toBe(300);
    expect(tooltipPosition(hotbar, 0, size, vp)).toEqual({ left: 775, top: 578 });
    expect(tooltipPosition({ ...hotbar, left: 1700 }, 296, size, vp).left).toBe(1920 - 32 - 300);
    expect(tooltipPosition({ ...hotbar, left: 0, top: 100 }, 0, size, vp)).toEqual({
      left: 32,
      top: 32,
    });
    const tip = createItemTooltip(null, document);
    tip.place({ left: 775, top: 578 });
    expect(tip.el.style.transform).toBe('translate(775px, 578px)');
  });
});

describe('ItemTooltip CSS (mockup geometry)', () => {
  it('panel: 300 px, padding 14/16/12, gap 10, bg.itemTooltip, border.strong, shadow.panel', () => {
    expect(declsFor(css, '.dz-tooltip')).toMatchObject({
      width: v('size.tooltip.width'),
      padding: `${v('space.3-5')} ${v('space.4')} ${v('space.3')}`,
      gap: v('space.2-5'),
      border: `${v('border.1')} solid ${v('color.border.strong')}`,
      'border-radius': v('radius.lg'),
      background: v('color.bg.itemTooltip'),
      'box-shadow': v('shadow.panel'),
      'pointer-events': 'none',
      transition: `opacity ${v('motion.fast')} linear`,
    });
    expect(declsFor(css, '.dz-tooltip__head').gap).toBe(v('space.1-5'));
    expect(declsFor(css, '.dz-tooltip__name').font).toBe(v('font.title.md'));
    expect(declsFor(css, '.dz-tooltip__category')).toMatchObject({
      color: v('color.accent.base'),
      font: v('font.label.category'),
      'letter-spacing': v('font.tracking.md'),
      'text-transform': 'uppercase',
    });
  });

  it('footer: divider on top, chips gap 14, label body.xs muted', () => {
    expect(declsFor(css, '.dz-keyfoot')).toMatchObject({
      gap: v('space.3-5'),
      'padding-top': v('space.2-5'),
      'border-top': `${v('border.1')} solid ${v('color.border.default')}`,
    });
    expect(declsFor(css, '.dz-keyfoot__item')).toMatchObject({
      gap: v('space.1-5'),
      color: v('color.text.muted'),
      font: v('font.body.xs'),
    });
  });
});
