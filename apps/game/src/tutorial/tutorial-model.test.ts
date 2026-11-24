import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../input/bindings.js';
import {
  GAP_SEC,
  MAX_SHOW_SEC,
  MIN_SHOW_SEC,
  TUTORIAL_STEPS,
  Tutorial,
  type TutorialInput,
} from './tutorial-model.js';
import { loadTutorialDone, saveTutorialDone } from './tutorial-store.js';

const base: TutorialInput = {
  now: 0,
  walked: 0,
  items: 0,
  nearContainer: false,
  hunger: 0,
  thirst: 0,
  threat: 0,
  night: false,
  firearm: false,
  wounded: false,
  opened: new Set(),
  alive: true,
  sleeping: false,
};
const b = DEFAULT_BINDINGS;

describe('tutorial', () => {
  it('starts with movement, using the current key bindings', () => {
    const t = new Tutorial();
    const h = t.update(base, b);
    expect(h?.id).toBe('move');
    expect(h?.text).toContain('WASD');
    expect(h?.text).toContain('Shift');
  });

  it('keeps a hint at least MIN_SHOW_SEC, ends it when done, waits GAP_SEC for the next', () => {
    const t = new Tutorial();
    t.update(base, b);
    expect(t.update({ ...base, now: 1, walked: 20 }, b)?.id).toBe('move');
    expect(t.update({ ...base, now: MIN_SHOW_SEC, walked: 20 }, b)).toBeUndefined();
    expect(t.doneIds).toContain('move');
    const near = { ...base, walked: 20, nearContainer: true };
    expect(t.update({ ...near, now: MIN_SHOW_SEC + 1 }, b)).toBeUndefined();
    expect(t.update({ ...near, now: MIN_SHOW_SEC + GAP_SEC }, b)?.id).toBe('search');
  });

  it('gives up on an ignored hint after MAX_SHOW_SEC', () => {
    const t = new Tutorial();
    t.update(base, b);
    expect(t.update({ ...base, now: MAX_SHOW_SEC }, b)).toBeUndefined();
    expect(t.doneIds).toEqual(['move']);
  });

  it('shows situational hints only when they apply and skips done steps', () => {
    const t = new Tutorial(['move']);
    expect(t.update(base, b)).toBeUndefined();
    expect(t.update({ ...base, now: 1, threat: 40 }, b)?.id).toBe('zombies');
    const u = new Tutorial(['move', 'search', 'inventory', 'zombies', 'firearm']);
    expect(u.update({ ...base, hunger: 50 }, b)?.id).toBe('hunger');
  });

  it('hides while asleep or dead, and × closes the hint for good', () => {
    const t = new Tutorial();
    expect(t.update({ ...base, sleeping: true }, b)).toBeUndefined();
    expect(t.update({ ...base, alive: false }, b)).toBeUndefined();
    t.update(base, b);
    t.dismiss(1);
    expect(t.doneIds).toEqual(['move']);
  });

  it('finishes after every step', () => {
    const t = new Tutorial(TUTORIAL_STEPS.map((s) => s.id));
    expect(t.finished).toBe(true);
    expect(t.update({ ...base, night: true, threat: 90 }, b)).toBeUndefined();
  });

  it('every hint text names a bound key or is plain prose, never an unbound dash', () => {
    // `–` is what actionKey gives an unbound action (a key range like „1–5” is fine).
    for (const s of TUTORIAL_STEPS) expect(s.text(b), s.id).not.toMatch(/(^|\s)–(\s|$)/);
    const unbound = { ...b, inventory: [] };
    expect(TUTORIAL_STEPS.find((s) => s.id === 'inventory')!.text(unbound)).toMatch(/^– /);
  });

  it('remembers done steps in storage and survives broken storage', () => {
    const mem = new Map<string, string>();
    const st = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    saveTutorialDone(st, ['move', 'search']);
    expect(loadTutorialDone(st)).toEqual(['move', 'search']);
    mem.set('dz-tutorial-done-v1', '{oops');
    expect(loadTutorialDone(st)).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadTutorialDone(broken)).toEqual([]);
    expect(() => saveTutorialDone(broken, ['x'])).not.toThrow();
  });
});
