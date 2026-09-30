// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, readCss, v } from '../../test/css.js';
import { createClock, dayLabel, formatClock } from './index.js';

const css = readCss('components/clock/clock.css');

describe('Clock (spec §3.8)', () => {
  it('formats game time as 24 h HH:MM and wraps', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(21 * 60 + 47)).toBe('21:47');
    expect(formatClock(1439)).toBe('23:59');
    expect(formatClock(1440 + 5)).toBe('00:05');
    expect(formatClock(-1)).toBe('23:59');
    expect(dayLabel(12)).toBe('Dzień 12');
    expect(dayLabel(0)).toBe('Dzień 1');
  });

  it('renders from the sim clock view and only touches the DOM when the minute changes', () => {
    const view = { day: 3, minuteOfDay: 7 * 60, ticksPerGameMinute: 50, minuteStartTick: 0 };
    const clock = createClock(view, document);
    const time = clock.el.querySelector('.dz-clock__time');
    expect(time?.textContent).toBe('07:00');
    expect(clock.el.querySelector('.dz-clock__day')?.textContent).toBe('Dzień 3');
    expect(clock.el.dataset.mood).toBe('day');
    expect(clock.el.getAttribute('aria-label')).toBe('Dzień 3, 07:00');
    const node = time?.firstChild;
    const sameMinute = { ...view, minuteStartTick: 50 };
    clock.update(sameMinute);
    expect(time?.firstChild).toBe(node);
    clock.update({ day: 3, minuteOfDay: 22 * 60 });
    expect(time?.textContent).toBe('22:00');
    expect(clock.el.dataset.mood).toBe('night');
    clock.update({ day: 3, minuteOfDay: 19 * 60 + 30 });
    expect(clock.el.dataset.mood).toBe('dusk');
  });

  it('uses the spec tokens', () => {
    expect(declsFor(css, '.dz-clock')).toMatchObject({
      width: v('size.clock.width'),
      height: v('size.clock.height'),
      gap: v('space.0-5'),
      'pointer-events': 'none',
    });
    expect(declsFor(css, '.dz-clock__time')).toMatchObject({
      color: v('color.text.primary'),
      font: v('font.display.clock'),
    });
    expect(declsFor(css, '.dz-clock__day')).toMatchObject({
      color: v('color.text.muted'),
      font: v('font.label.sm'),
      'letter-spacing': v('font.tracking.xwide'),
      'margin-top': v('space.1'),
      'text-transform': 'uppercase',
    });
    const clock = createClock({ day: 1, minuteOfDay: 0 }, document);
    expect(clock.el.classList.contains('dz-glass')).toBe(true);
  });
});
