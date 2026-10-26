import { describe, expect, it, vi } from 'vitest';
import { createInfoDismiss } from './info-dismiss.js';

const setup = () => {
  const listeners: (() => void)[] = [];
  const win = { addEventListener: (_: string, f: () => void) => void listeners.push(f) };
  const history = { pushState: vi.fn(), back: vi.fn(() => listeners.forEach((f) => f())) };
  const hide = vi.fn();
  const d = createInfoDismiss(hide, win as never, history);
  const androidBack = () => listeners.forEach((f) => f());
  return { d, hide, history, androidBack };
};

describe('touch item info window dismiss', () => {
  it('✕ / tap outside closes and removes the history entry', () => {
    const { d, hide, history } = setup();
    d.shown();
    expect(history.pushState).toHaveBeenCalledTimes(1);
    d.dismiss();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(d.open).toBe(false);
  });
  it('another item replaces the content: still one history entry', () => {
    const { d, history } = setup();
    d.shown();
    d.shown();
    expect(history.pushState).toHaveBeenCalledTimes(1);
  });
  it('Back (popstate) closes', () => {
    const { d, hide, history, androidBack } = setup();
    d.shown();
    androidBack();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(d.open).toBe(false);
    expect(history.back).not.toHaveBeenCalled();
  });
  it('Escape closes only when open', () => {
    const { d, hide } = setup();
    expect(d.escape()).toBe(false);
    d.shown();
    expect(d.escape()).toBe(true);
    expect(hide).toHaveBeenCalledTimes(1);
  });
  it('works without history (tests / SSR)', () => {
    const hide = vi.fn();
    const d = createInfoDismiss(hide, undefined, undefined);
    d.shown();
    d.dismiss();
    expect(hide).toHaveBeenCalled();
  });
});
