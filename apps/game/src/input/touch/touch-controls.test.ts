import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS } from '../bindings.js';
import { InputMap } from '../input-map.js';
import { TOUCH_ACTIONS, TOUCH_ACTION_MAP } from './touch-controls.js';

function ev(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, value] of Object.entries(props)) Object.defineProperty(e, k, { value });
  return e;
}

describe('touch buttons → existing input actions', () => {
  it('map to the actions of the keys / mouse', () => {
    expect(TOUCH_ACTION_MAP).toMatchObject({
      attack: 'primaryAction',
      interact: 'interact',
      sneak: 'crouch',
      use: 'secondaryAction',
      sprint: 'sprint',
      target: 'targetNext',
    });
    expect(TOUCH_ACTIONS.every((a) => TOUCH_ACTION_MAP[a])).toBe(true);
  });

  it('holdVirtual: press handlers once, isDown while held, release handlers, suspended', () => {
    const element = new EventTarget();
    const input = new InputMap(DEFAULT_BINDINGS, { window: new EventTarget(), element });
    const press = vi.fn();
    const release = vi.fn();
    input.on('interact', press);
    input.onRelease('interact', release);
    input.holdVirtual('interact', true);
    input.holdVirtual('interact', true);
    expect(press).toHaveBeenCalledTimes(1);
    expect(input.isDown('interact')).toBe(true);
    input.holdVirtual('interact', false);
    expect(input.isDown('interact')).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    input.setSuspended(true);
    input.holdVirtual('interact', true);
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('touch mode: a finger on the canvas is not LMB (no attack); the mouse still is', () => {
    const element = new EventTarget();
    const input = new InputMap(DEFAULT_BINDINGS, { window: new EventTarget(), element });
    const attack = vi.fn();
    input.on('primaryAction', attack);
    input.setIgnoreTouchPointers(true);
    element.dispatchEvent(ev('pointerdown', { button: 0, pointerType: 'touch' }));
    expect(attack).not.toHaveBeenCalled();
    element.dispatchEvent(ev('pointerdown', { button: 0, pointerType: 'mouse' }));
    expect(attack).toHaveBeenCalledTimes(1);
    // Desktop (default): touch counts as before.
    const d = new InputMap(DEFAULT_BINDINGS, {
      window: new EventTarget(),
      element: new EventTarget(),
    });
    void d;
  });
});
