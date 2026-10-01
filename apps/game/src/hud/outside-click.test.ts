import { describe, expect, it, vi } from 'vitest';
import { bindOutsideClose, isOutsideClick } from './outside-click.js';

/** Fake element: `closest` matches any of its own / ancestor class tokens or tag. */
function node(path: string[]): { closest(sel: string): unknown } {
  return {
    closest: (sel: string) =>
      sel
        .split(',')
        .map((s) => s.trim())
        .some((s) => path.some((p) => p === s || `.${p}` === s))
        ? {}
        : null,
  };
}

const INSIDE = '.dz-inv__panel, .dz-inv__head';

describe('isOutsideClick', () => {
  it('backdrop and gaps between panels are outside', () => {
    expect(isOutsideClick(node(['dz-inv']), INSIDE)).toBe(true);
    expect(isOutsideClick(node(['dz-inv__cols', 'dz-inv']), INSIDE)).toBe(true);
  });

  it('panels, rows, tooltips, buttons and menus are inside', () => {
    expect(isOutsideClick(node(['dz-inv__row', 'dz-inv__panel', 'dz-inv']), INSIDE)).toBe(false);
    expect(isOutsideClick(node(['dz-tooltip', 'dz-inv']), INSIDE)).toBe(false);
    expect(isOutsideClick(node(['dz-ct', 'dz-inv']), INSIDE)).toBe(false);
    expect(isOutsideClick(node(['button', 'dz-inv']), INSIDE)).toBe(false);
    expect(isOutsideClick(node(['[role="menu"]']), INSIDE)).toBe(false);
  });

  it('non-elements never count as outside', () => {
    expect(isOutsideClick(null, INSIDE)).toBe(false);
    expect(isOutsideClick({}, INSIDE)).toBe(false);
  });
});

describe('bindOutsideClose', () => {
  const setup = (open = true) => {
    const overlay = new EventTarget() as unknown as HTMLElement;
    const close = vi.fn();
    const off = bindOutsideClose(overlay, INSIDE, () => open, close);
    const press = (target: unknown, type = 'pointerdown') => {
      const e = new Event(type, { cancelable: true, bubbles: true });
      Object.defineProperty(e, 'target', { value: target });
      const stop = vi.spyOn(e, 'stopPropagation');
      overlay.dispatchEvent(e);
      return { e, stop };
    };
    return { close, off, press };
  };

  it('closes on a press outside and consumes it', () => {
    const { close, press } = setup();
    const { e, stop } = press(node(['dz-inv']));
    expect(close).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
  });

  it('ignores presses inside, and everything while closed or disposed', () => {
    const a = setup();
    a.press(node(['dz-inv__row', 'dz-inv__panel']));
    expect(a.close).not.toHaveBeenCalled();
    const b = setup(false);
    b.press(node(['dz-inv']));
    expect(b.close).not.toHaveBeenCalled();
    a.off();
    a.press(node(['dz-inv']));
    expect(a.close).not.toHaveBeenCalled();
  });

  it('blocks the native context menu on the backdrop only', () => {
    const { press } = setup();
    expect(press(node(['dz-inv']), 'contextmenu').e.defaultPrevented).toBe(true);
    expect(press(node(['dz-inv__panel']), 'contextmenu').e.defaultPrevented).toBe(false);
  });
});
