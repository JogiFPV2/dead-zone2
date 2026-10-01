// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { declsFor, readCss, v } from '../../test/css.js';
import {
  createInventorySlot,
  slotCount,
  slotState,
  type SlotItem,
  type SlotState,
} from './index.js';

const css = readCss('components/inventory-slot/inventory-slot.css');
const knife: SlotItem = {
  id: 'knife',
  name: 'Nóż kuchenny',
  icon: 'knife',
  stackable: false,
  usable: true,
};
const bottle: SlotItem = {
  id: 'water',
  name: 'Woda',
  icon: 'bottle',
  stackable: true,
  count: 2,
  usable: true,
};

/** Spec §3.5 table. */
const TABLE: Record<SlotState, Record<string, string>> = {
  empty: {
    '--_bg': v('color.bg.slot.empty'),
    '--_border-width': v('border.1'),
    '--_border': v('color.border.default'),
    '--_key': v('color.text.muted'),
    '--_shadow': 'none',
  },
  filled: {
    '--_bg': v('color.bg.slot.filled'),
    '--_border-width': v('border.1'),
    '--_border': v('color.border.default'),
    '--_fg': v('color.text.primary'),
    '--_key': v('color.text.muted'),
    '--_shadow': 'none',
  },
  selected: {
    '--_bg': v('color.bg.slot.selected'),
    '--_border-width': v('border.2'),
    '--_border': v('color.border.accent'),
    '--_fg': v('color.text.primary'),
    '--_key': v('color.text.muted'),
    '--_shadow': v('shadow.selected'),
  },
  disabled: {
    '--_bg': v('color.bg.slot.filled'),
    '--_border-width': v('border.1'),
    '--_border': v('color.border.default'),
    '--_fg': v('color.text.disabled'),
    '--_key': v('color.text.disabled'),
    '--_shadow': 'none',
    opacity: v('opacity.disabled'),
    cursor: 'default',
  },
  hover: {
    '--_bg': v('color.bg.slot.hover'),
    '--_border-width': v('border.1'),
    '--_border': v('color.border.strong'),
    '--_fg': v('color.text.primary'),
    '--_key': v('color.text.muted'),
    '--_shadow': 'none',
  },
};

describe('InventorySlot states (spec §3.5)', () => {
  for (const state of Object.keys(TABLE) as SlotState[]) {
    it(`${state} maps to the spec tokens`, () => {
      expect(declsFor(css, `.dz-slot[data-state='${state}']`)).toEqual(TABLE[state]);
    });
  }

  it('real :hover only applies in inventory screens (data-hoverable)', () => {
    const hover = declsFor(
      css,
      ".dz-slot[data-hoverable]:is([data-state='empty'], [data-state='filled']):hover",
    );
    expect(hover['--_border']).toBe(v('color.border.strong'));
  });

  it('a selected empty slot shows the selected border on the empty background', () => {
    expect(declsFor(css, ".dz-slot[data-state='selected'][data-empty]")).toEqual({
      '--_bg': v('color.bg.slot.empty'),
    });
    const slot = createInventorySlot({ item: null, keybind: '5', selected: true }, document);
    expect(slot.el.dataset.state).toBe('selected');
    expect(slot.el.dataset.empty).toBe('');
    slot.update({ item: knife, keybind: '5', selected: true });
    expect(slot.el.dataset.empty).toBeUndefined();
  });

  it('stays 64×64 with the 2 px border (border-box)', () => {
    expect(declsFor(css, '.dz-slot')).toMatchObject({
      'box-sizing': 'border-box',
      width: v('size.slot'),
      height: v('size.slot'),
    });
  });

  it('derives the state with precedence disabled > selected > hover > filled/empty', () => {
    expect(slotState({ item: null })).toBe('empty');
    expect(slotState({ item: knife })).toBe('filled');
    expect(slotState({ item: knife, selected: true })).toBe('selected');
    expect(slotState({ item: null, selected: true })).toBe('selected');
    expect(slotState({ item: knife, hover: true })).toBe('hover');
    expect(slotState({ item: { ...knife, usable: false }, selected: true })).toBe('disabled');
  });
});

describe('InventorySlot element', () => {
  it('renders keybind, icon and counter (stackable only)', () => {
    const slot = createInventorySlot({ item: bottle, keybind: '3' }, document);
    expect(slot.el.dataset.state).toBe('filled');
    expect(slot.el.querySelector('.dz-slot__key')?.textContent).toBe('3');
    expect(slot.el.querySelector('svg')?.dataset.icon).toBe('bottle');
    expect(slot.el.querySelector('.dz-slot__count')?.textContent).toBe('2');
    slot.update({ item: { ...knife, count: 1 }, keybind: '1', selected: true });
    expect(slot.el.dataset.state).toBe('selected');
    expect(slot.el.querySelector('.dz-slot__count')?.textContent).toBe('');
    expect(slot.el.querySelector('svg')?.dataset.icon).toBe('knife');
    slot.update({ item: null, keybind: '1' });
    expect(slot.el.dataset.state).toBe('empty');
    expect(slot.el.querySelector('svg')).toBeNull();
    expect(slotCount(null)).toBe('');
  });

  it('shows the baked raster icon instead of the vector one when set', () => {
    const slot = createInventorySlot(
      { item: { ...knife, image: 'icons/kitchen-knife.png' } },
      document,
    );
    expect(slot.el.querySelector('svg')).toBeNull();
    expect(slot.el.querySelector('img')?.getAttribute('src')).toBe('icons/kitchen-knife.png');
    slot.update({ item: knife });
    expect(slot.el.querySelector('img')).toBeNull();
    expect(slot.el.querySelector('svg')?.dataset.icon).toBe('knife');
  });

  it('selects on click without leaking the click to the game, unless disabled', () => {
    const onSelect = vi.fn();
    const outer = vi.fn();
    const slot = createInventorySlot({ item: knife, onSelect }, document);
    document.body.addEventListener('click', outer);
    document.body.appendChild(slot.el);
    slot.el.click();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    slot.update({ item: { ...knife, usable: false }, onSelect });
    slot.el.click();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(slot.el.getAttribute('aria-disabled')).toBe('true');
    slot.destroy();
    document.body.removeEventListener('click', outer);
  });

  it('forced hover and hoverable flag', () => {
    const slot = createInventorySlot({ item: knife, hover: true, hoverable: true }, document);
    expect(slot.el.dataset.state).toBe('hover');
    expect(slot.el.dataset.hoverable).toBe('');
  });
});
