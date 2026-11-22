// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { INITIAL_GAME_STATE, reduceGameState } from '../../state/game-state.js';
import { createStealthEye, STEALTH_LABEL } from './stealth-eye.js';

describe('HUD visibility eye (docs 9.45)', () => {
  it('hidden until the sim sends stealth; level → data-level, label and bar', () => {
    const eye = createStealthEye();
    eye.update({ level: undefined, visibility: 1 });
    expect(eye.el.hidden).toBe(true);
    eye.update({ level: 'dim', visibility: 0.4 });
    expect(eye.el.hidden).toBe(false);
    expect(eye.el.dataset.level).toBe('dim');
    expect(eye.el.getAttribute('aria-label')).toBe(STEALTH_LABEL.dim);
    const fill = eye.el.querySelector<HTMLElement>('.dz-eye3__fill')!;
    expect(fill.style.transform).toBe('scaleX(0.4)');
    eye.update({ level: 'hidden', visibility: 0.05 });
    expect(eye.el.title).toBe('Ukryty');
  });

  it('game state keeps the last stealth / visibility / light from view patches', () => {
    let s = reduceGameState(INITIAL_GAME_STATE, {
      type: 'view',
      tick: 1,
      view: { stealth: 'hidden', visibility: 0.05, lightLevel: 0.05 },
    });
    expect(s.stealth).toEqual({ level: 'hidden', visibility: 0.05, light: 0.05 });
    s = reduceGameState(s, { type: 'view', tick: 2, view: { visibility: 0.3 } });
    expect(s.stealth).toEqual({ level: 'hidden', visibility: 0.3, light: 0.05 });
    s = reduceGameState(s, { type: 'view', tick: 3, view: { threat: 5 } });
    expect(s.stealth?.visibility).toBe(0.3);
  });
});
