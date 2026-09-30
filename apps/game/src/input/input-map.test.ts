import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS, rebind } from './bindings.js';
import { InputMap } from './input-map.js';
import { moveKeys } from './player-input.js';

/** Node has no KeyboardEvent/PointerEvent: a plain Event with the fields the map reads. */
function ev(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, value] of Object.entries(props)) Object.defineProperty(e, k, { value });
  return e;
}

function setup() {
  const win = new EventTarget();
  const element = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const input = new InputMap(DEFAULT_BINDINGS, { window: win, element, document: doc });
  const key = (code: string, down = true, extra = {}) =>
    win.dispatchEvent(ev(down ? 'keydown' : 'keyup', { code, ...extra }));
  return { win, element, doc, input, key };
}

describe('InputMap', () => {
  it('tracks held actions by physical code', () => {
    const { input, key } = setup();
    key('KeyW');
    key('KeyD');
    expect(moveKeys(input)).toEqual({ up: true, down: false, left: false, right: true });
    key('KeyW', false);
    expect(input.isDown('moveUp')).toBe(false);
  });

  it('fires press handlers once per press, ignoring repeats', () => {
    const { input, key } = setup();
    const h = vi.fn();
    const off = input.on('rotateCameraLeft', h);
    key('KeyQ');
    key('KeyQ', true, { repeat: true });
    key('KeyQ', true); // no keyup in between (e.g. OS repeat without flag)
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith({ action: 'rotateCameraLeft', code: 'KeyQ', amount: 1 });
    key('KeyQ', false);
    key('KeyQ');
    expect(h).toHaveBeenCalledTimes(2);
    off();
    key('KeyQ', false);
    key('KeyQ');
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('releases everything on blur and hidden tab (no stuck keys)', () => {
    const { input, key, win, doc, element } = setup();
    key('KeyW');
    element.dispatchEvent(ev('pointerdown', { button: 0 }));
    expect(input.isDown('primaryAction')).toBe(true);
    win.dispatchEvent(ev('blur'));
    expect(input.isDown('moveUp')).toBe(false);
    expect(input.isDown('primaryAction')).toBe(false);
    key('KeyS');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(ev('visibilitychange'));
    expect(input.isDown('moveDown')).toBe(false);
  });

  it('mouse buttons: pressed on the canvas, released anywhere', () => {
    const { input, win, element } = setup();
    const h = vi.fn();
    input.on('secondaryAction', h);
    element.dispatchEvent(ev('pointerdown', { button: 2 }));
    expect(h).toHaveBeenCalledTimes(1);
    expect(input.isDown('secondaryAction')).toBe(true);
    win.dispatchEvent(ev('pointerup', { button: 2 }));
    expect(input.isDown('secondaryAction')).toBe(false);
  });

  it('wheel fires zoom actions with the delta and prevents page scroll', () => {
    const { input, element } = setup();
    const zin = vi.fn();
    const zout = vi.fn();
    input.on('zoomIn', zin);
    input.on('zoomOut', zout);
    const up = ev('wheel', { deltaY: -120 });
    element.dispatchEvent(up);
    element.dispatchEvent(ev('wheel', { deltaY: 40 }));
    expect(zin).toHaveBeenCalledWith({ action: 'zoomIn', code: 'WheelUp', amount: 120 });
    expect(zout).toHaveBeenCalledWith({ action: 'zoomOut', code: 'WheelDown', amount: 40 });
    expect(up.defaultPrevented).toBe(true);
  });

  it('follows new bindings and ignores typing in text fields', () => {
    const { input, key } = setup();
    const r = rebind(DEFAULT_BINDINGS, 'moveUp', 'ArrowUp');
    if (!r.ok) throw new Error('expected ok');
    input.setBindings(r.bindings);
    key('KeyW');
    expect(input.isDown('moveUp')).toBe(false);
    key('ArrowUp');
    expect(input.isDown('moveUp')).toBe(true);
    const h = vi.fn();
    input.on('inventory', h);
    key('KeyI', true, { target: { tagName: 'INPUT' } });
    expect(h).not.toHaveBeenCalled();
  });

  it('dispose removes listeners', () => {
    const { input, key } = setup();
    input.dispose();
    key('KeyW');
    expect(input.isDown('moveUp')).toBe(false);
  });
});
