// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, keyframes, readCss, v } from '../../test/css.js';
import {
  DrainDetector,
  STAT_IDS,
  createStatBar,
  createStatBars,
  statBarState,
  type StatBarState,
} from './index.js';

const css = readCss('components/stat-bar/stat-bar.css');

/** Spec §3.7 table (fill is always color.stat.<stat>). */
const TABLE: Record<StatBarState, Record<string, string>> = {
  normal: {
    '--_track': v('color.bg.track'),
    '--_icon': 'var(--_stat)',
    '--_value-color': v('color.text.primary'),
  },
  low: {
    '--_track': v('color.bg.track'),
    '--_icon': v('color.warning.base'),
    '--_value-color': v('color.warning.text'),
  },
  critical: {
    '--_track': v('color.danger.tint'),
    '--_icon': v('color.danger.base'),
    '--_value-color': v('color.danger.text'),
  },
};

describe('StatBar states (spec §3.7)', () => {
  it('derives normal / low (≤30) / critical (≤15)', () => {
    expect(statBarState(31)).toBe('normal');
    expect(statBarState(30)).toBe('low');
    expect(statBarState(16)).toBe('low');
    expect(statBarState(15)).toBe('critical');
    expect(statBarState(0)).toBe('critical');
    expect(statBarState(50, { low: 60, critical: 40 })).toBe('low');
  });

  for (const state of Object.keys(TABLE) as StatBarState[]) {
    it(`${state} maps to the spec tokens`, () => {
      expect(declsFor(css, `.dz-statbar[data-state='${state}']`)).toEqual(TABLE[state]);
    });
  }

  it('fills with color.stat.<stat> in every state', () => {
    for (const stat of STAT_IDS) {
      expect(declsFor(css, `.dz-statbar[data-stat='${stat}']`)).toEqual({
        '--_stat': v(`color.stat.${stat}`),
      });
    }
    expect(declsFor(css, '.dz-statbar__fill').background).toBe('var(--_stat)');
  });

  it('critical pulses the fill 1 ↔ motion.pulse.stat over motion.pulse.duration', () => {
    expect(declsFor(css, ".dz-statbar[data-state='critical'] .dz-statbar__fill").animation).toBe(
      'dz-statbar-pulse var(--motion-pulse-duration) ease-in-out infinite alternate',
    );
    expect(css).toMatch(
      /@keyframes dz-statbar-pulse[^}]*\}\s*to \{\s*opacity: var\(--motion-pulse-stat\);/,
    );
    expect(keyframes(css)).toContain('dz-statbar-pulse');
  });

  it('renders value, fill scale and state on the element', () => {
    const bar = createStatBar({ stat: 'thirst', value: 41.4 }, {}, document);
    expect(bar.el.dataset.stat).toBe('thirst');
    expect(bar.el.dataset.state).toBe('normal');
    expect(bar.el.querySelector('.dz-statbar__value')?.textContent).toBe('41');
    const fill = bar.el.querySelector<HTMLElement>('.dz-statbar__fill');
    expect(fill?.style.getPropertyValue('--_value')).toBe('0.414');
    expect(bar.el.querySelector('svg')?.dataset.icon).toBe('drop');
    bar.update({ stat: 'thirst', value: 12 });
    expect(bar.el.dataset.state).toBe('critical');
    bar.update({ stat: 'thirst', value: 140 });
    expect(bar.el.querySelector('.dz-statbar__value')?.textContent).toBe('100');
  });
});

describe('StatBar drain', () => {
  it('detects a drop > 5 within 1 s, once', () => {
    const d = new DrainDetector();
    expect(d.push(80, 0)).toBeUndefined();
    expect(d.push(77, 400)).toBeUndefined();
    expect(d.push(74, 800)).toBe(80);
    expect(d.push(73, 900)).toBeUndefined();
  });

  it('ignores slow drops', () => {
    const d = new DrainDetector();
    d.push(80, 0);
    d.push(76, 900);
    expect(d.push(73, 1800)).toBeUndefined();
  });

  it('shows the ghost from the old value to the new one', () => {
    let now = 0;
    const bar = createStatBar({ stat: 'health', value: 72 }, { now: () => now }, document);
    expect(bar.el.dataset.drain).toBeUndefined();
    now = 300;
    bar.update({ stat: 'health', value: 60 });
    expect(bar.el.dataset.drain).toBe('');
    const ghost = bar.el.querySelector<HTMLElement>('.dz-statbar__ghost');
    expect(ghost?.style.getPropertyValue('--_from')).toBe('0.72');
    expect(ghost?.style.getPropertyValue('--_to')).toBe('0.6');
    expect(declsFor(css, '.dz-statbar__ghost')).toMatchObject({
      background: v('color.text.primary'),
      opacity: v('opacity.ghost'),
    });
    expect(declsFor(css, '.dz-statbar[data-drain] .dz-statbar__ghost').animation).toBe(
      `dz-statbar-drain ${v('motion.drain')} ${v('motion.ease.out')} forwards`,
    );
    // Ghost stays under the fill (Designer, answer 3).
    const track = bar.el.querySelector('.dz-statbar__track');
    expect([...(track?.children ?? [])].map((c) => c.className)).toEqual([
      'dz-statbar__ghost',
      'dz-statbar__fill',
    ]);
  });
});

describe('StatBars container', () => {
  it('renders the four stats in spec order and updates them', () => {
    const bars = createStatBars({ health: 72, thirst: 41, hunger: 58, energy: 84 }, {}, document);
    const stats = [...bars.el.children].map((c) => (c as HTMLElement).dataset.stat);
    expect(stats).toEqual(['health', 'thirst', 'hunger', 'energy']);
    bars.update({ health: 10, thirst: 41, hunger: 25, energy: 84 });
    const states = [...bars.el.children].map((c) => (c as HTMLElement).dataset.state);
    expect(states).toEqual(['critical', 'normal', 'low', 'normal']);
  });
});
