import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, findConflicts } from './bindings.js';
import { InputMap } from './input-map.js';
import { moveGait } from './player-input.js';
import { SNEAK_PENDING_MS, SNEAK_REVEAL_MS, SneakToggle } from './sneak-toggle.js';

function ev(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, value] of Object.entries(props)) Object.defineProperty(e, k, { value });
  return e;
}

function setup() {
  const win = new EventTarget();
  const input = new InputMap(DEFAULT_BINDINGS, { window: win, element: new EventTarget() });
  const key = (code: string, down = true, extra = {}) =>
    win.dispatchEvent(ev(down ? 'keydown' : 'keyup', { code, ...extra }));
  const sent: boolean[] = [];
  const sneak = new SneakToggle((on) => sent.push(on));
  let now = 0;
  input.on('crouch', () => sneak.toggle(now));
  return { input, key, sent, sneak, at: (t: number) => (now = t) };
}

describe('sneak key (C)', () => {
  it('C is the sneak action and bound to nothing else', () => {
    expect(DEFAULT_BINDINGS.crouch).toEqual(['KeyC']);
    expect(findConflicts(DEFAULT_BINDINGS).filter((c) => c.code === 'KeyC')).toEqual([]);
  });

  it('each press toggles setSneak; key repeat and holding do nothing', () => {
    const { key, sent, sneak, at } = setup();
    key('KeyC');
    expect(sent).toEqual([true]);
    key('KeyC', true, { repeat: true });
    expect(sent).toEqual([true]);
    sneak.setView(true);
    key('KeyC', false);
    at(100);
    key('KeyC');
    expect(sent).toEqual([true, false]);
  });

  it('follows CharacterView.sneaking: a sprint that turned it off makes the next C switch on', () => {
    const { key, sent, sneak, at } = setup();
    key('KeyC');
    sneak.setView(true);
    expect(sneak.sneaking(10)).toBe(true);
    // Sim: run / sprint switched the toggle off.
    sneak.setView(false);
    expect(sneak.sneaking(20)).toBe(false);
    key('KeyC', false);
    at(30);
    key('KeyC');
    expect(sent).toEqual([true, true]);
  });

  it('an unconfirmed press shows at once and expires if the sim never confirms it', () => {
    const s = new SneakToggle(() => {});
    s.toggle(0);
    expect(s.sneaking(1)).toBe(true);
    expect(s.sneaking(SNEAK_PENDING_MS)).toBe(false);
  });

  it('reveals the noise circle for 2 s only after switching sneak on', () => {
    const s = new SneakToggle(() => {});
    s.toggle(1000);
    expect(s.revealing(1000 + SNEAK_REVEAL_MS - 1)).toBe(true);
    expect(s.revealing(1000 + SNEAK_REVEAL_MS)).toBe(false);
    s.setView(true);
    s.toggle(1500);
    expect(s.revealing(1600)).toBe(false);
  });

  it('move gait: sprint while held, otherwise walk (the sim turns walk into sneak)', () => {
    const { input, key } = setup();
    expect(moveGait(input)).toBe('walk');
    key('KeyC');
    expect(moveGait(input)).toBe('walk');
    key('ShiftLeft');
    expect(moveGait(input)).toBe('sprint');
  });
});
