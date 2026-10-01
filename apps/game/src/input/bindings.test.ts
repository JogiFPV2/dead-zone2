import { describe, expect, it } from 'vitest';
import { ACTIONS, isInputCode, mouseCode, wheelCode } from './actions.js';
import {
  DEFAULT_BINDINGS,
  findConflicts,
  indexBindings,
  rebind,
  resetAction,
  sanitizeBindings,
  unbind,
} from './bindings.js';

describe('default bindings', () => {
  it('cover every action without conflicts, keeping WASD / Q-E / wheel', () => {
    for (const a of ACTIONS) expect(DEFAULT_BINDINGS[a].length).toBeGreaterThan(0);
    expect(findConflicts(DEFAULT_BINDINGS)).toEqual([]);
    expect(DEFAULT_BINDINGS.moveUp).toEqual(['KeyW']);
    expect(DEFAULT_BINDINGS.rotateCameraLeft).toEqual(['KeyQ']);
    expect(DEFAULT_BINDINGS.zoomIn).toEqual(['WheelUp', 'KeyX']);
    expect(DEFAULT_BINDINGS.zoomOut).toEqual(['WheelDown', 'KeyZ']);
    expect(indexBindings(DEFAULT_BINDINGS).get('Digit3')).toEqual(['quickslot3']);
  });
});

describe('input codes', () => {
  it('encodes mouse and wheel, validates codes', () => {
    expect(mouseCode(2)).toBe('Mouse2');
    expect(wheelCode(-3)).toBe('WheelUp');
    expect(wheelCode(5)).toBe('WheelDown');
    for (const ok of ['KeyW', 'Digit1', 'ShiftLeft', 'Mouse0', 'WheelUp', 'F5']) {
      expect(isInputCode(ok)).toBe(true);
    }
    for (const bad of ['', 'w', 'Mouse9', 'Key W', 42, null]) expect(isInputCode(bad)).toBe(false);
  });
});

describe('rebind', () => {
  it('binds a free input into a slot', () => {
    const r = rebind(DEFAULT_BINDINGS, 'moveUp', 'ArrowUp', { slot: 1 });
    expect(r.ok && r.bindings.moveUp).toEqual(['KeyW', 'ArrowUp']);
    const s = rebind(DEFAULT_BINDINGS, 'moveUp', 'KeyY');
    expect(s.ok && s.bindings.moveUp).toEqual(['KeyY']);
  });

  it('rejects conflicts by default and reports them', () => {
    expect(rebind(DEFAULT_BINDINGS, 'interact', 'KeyE')).toEqual({
      ok: false,
      conflicts: ['rotateCameraRight'],
    });
  });

  it('steal removes the input from the other action', () => {
    const r = rebind(DEFAULT_BINDINGS, 'interact', 'KeyE', { policy: 'steal' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.displaced).toEqual(['rotateCameraRight']);
    expect(r.bindings.interact).toEqual(['KeyE']);
    expect(r.bindings.rotateCameraRight).toEqual([]);
    expect(findConflicts(r.bindings)).toEqual([]);
  });

  it('swap gives the other action the previous input', () => {
    const r = rebind(DEFAULT_BINDINGS, 'interact', 'KeyE', { policy: 'swap' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.bindings.interact).toEqual(['KeyE']);
    expect(r.bindings.rotateCameraRight).toEqual(['KeyF']);
  });

  it('rebinding to the same input is a no-op and does not duplicate', () => {
    const r = rebind(DEFAULT_BINDINGS, 'moveUp', 'KeyW', { slot: 1 });
    expect(r.ok && r.bindings.moveUp).toEqual(['KeyW']);
  });

  it('validates code and slot', () => {
    expect(() => rebind(DEFAULT_BINDINGS, 'moveUp', 'w')).toThrow(/kod/);
    expect(() => rebind(DEFAULT_BINDINGS, 'moveUp', 'KeyZ', { slot: 2 })).toThrow(/slot/);
  });

  it('unbind and reset', () => {
    const b = unbind(DEFAULT_BINDINGS, 'moveUp');
    expect(b.moveUp).toEqual([]);
    expect(resetAction(b, 'moveUp').moveUp).toEqual(['KeyW']);
    expect(DEFAULT_BINDINGS.moveUp).toEqual(['KeyW']); // pure
  });
});

describe('sanitizeBindings', () => {
  it('keeps valid data, drops junk, fills missing actions with defaults', () => {
    const b = sanitizeBindings({
      moveUp: ['ArrowUp', 'ArrowUp', 'bad', 7, 'KeyW', 'KeyZ'],
      fly: ['KeyX'],
      pause: 'Escape',
    });
    expect(b.moveUp).toEqual(['ArrowUp', 'KeyW']);
    expect('fly' in b).toBe(false);
    expect(b.pause).toEqual(['Escape']);
    expect(b.inventory).toEqual(['KeyI']);
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS);
  });

  it('defaults of newly added actions do not steal inputs the stored data already uses', () => {
    // Older save: no `skills` action yet, K rebound to sprint by the player.
    const b = sanitizeBindings({ ...DEFAULT_BINDINGS, skills: undefined, sprint: ['KeyK'] });
    expect(b.sprint).toEqual(['KeyK']);
    expect(b.skills).toEqual([]);
  });
});
