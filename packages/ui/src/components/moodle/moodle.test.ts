// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, keyframes, readCss, v } from '../../test/css.js';
import type { TokenPath } from '../../tokens/tokens.generated.js';
import {
  POLARITIES,
  VISIBLE_LEVELS,
  createMoodle,
  createMoodleList,
  moodleLabel,
  planOverflow,
  sortMoodles,
  toPolarity,
  type MoodleVM,
} from './index.js';

const css = readCss('components/moodle/moodle.css');
const sel = (p: string, l: number) => `.dz-moodle[data-polarity='${p}'][data-level='${l}']`;

describe('Moodle states (spec §3.2 table: polarity × level)', () => {
  for (const polarity of POLARITIES) {
    for (const level of VISIBLE_LEVELS) {
      it(`${polarity} ${level} uses color.moodle.${polarity}.${level}.*`, () => {
        const chip = createMoodle({ label: 'Ból', polarity, level }, document);
        expect(chip.el.dataset.polarity).toBe(polarity);
        expect(chip.el.dataset.level).toBe(String(level));
        const t = (k: string) => v(`color.moodle.${polarity}.${level}.${k}` as TokenPath);
        expect(declsFor(css, sel(polarity, level))).toEqual({
          '--_border': t('border'),
          '--_bg': t('bg'),
          '--_text': t('text'),
          '--_dot': t('dot'),
        });
      });
    }
  }

  it('only neg 4 pulses (background opacity 1 ↔ motion.pulse.moodle, infinite)', () => {
    expect(declsFor(css, `${sel('neg', 4)}::before`).animation).toBe(
      'dz-moodle-pulse var(--motion-pulse-duration) ease-in-out infinite alternate',
    );
    expect(css).toMatch(
      /@keyframes dz-moodle-pulse[^}]*\}\s*to \{\s*opacity: var\(--motion-pulse-moodle\);/,
    );
    expect(declsFor(css, `${sel('pos', 4)}::before`)).toEqual({});
    expect(keyframes(css)).toContain('dz-moodle-pulse');
  });

  it('is coloured by polarity, not by type: same polarity/level → same classes', () => {
    const a = createMoodle({ label: 'Infekcja', polarity: 'neg', level: 1 }, document);
    const b = createMoodle({ label: 'Gorączka', polarity: 'neg', level: 1 }, document);
    expect({ ...a.el.dataset, enter: undefined }).toEqual({ ...b.el.dataset, enter: undefined });
  });
});

describe('Moodle chip', () => {
  it('shows the level number from level 2 on', () => {
    expect(moodleLabel('Infekcja', 1)).toBe('Infekcja');
    expect(moodleLabel('Ból', 2)).toBe('Ból 2');
    const chip = createMoodle({ label: 'Ból', polarity: 'neg', level: 2 }, document);
    expect(chip.el.querySelector('.dz-moodle__label')?.textContent).toBe('Ból 2');
  });

  it('enters with an animation and flashes once on level change', () => {
    const chip = createMoodle({ label: 'Ból', polarity: 'neg', level: 2 }, document);
    expect(chip.el.dataset.enter).toBe('');
    expect(chip.el.dataset.flash).toBeUndefined();
    chip.update({ label: 'Ból', polarity: 'neg', level: 3 });
    expect(chip.el.dataset.flash).toBe('');
  });

  it('renders the description tooltip only when there is one', () => {
    const chip = createMoodle(
      { label: 'Ból', polarity: 'neg', level: 1, description: 'Boli.' },
      document,
    );
    expect(chip.el.querySelector('.dz-moodle__tip')?.textContent).toBe('Boli.');
    chip.update({ label: 'Ból', polarity: 'neg', level: 1 });
    expect(chip.el.querySelector('.dz-moodle__tip')).toBeNull();
  });

  it('maps content polarity names', () => {
    expect(toPolarity('negative')).toBe('neg');
    expect(toPolarity('positive')).toBe('pos');
  });
});

const m = (id: string, polarity: 'neg' | 'pos', level: 0 | 1 | 2 | 3 | 4, since = 0): MoodleVM => ({
  id,
  label: id,
  polarity,
  level,
  since,
});

describe('Moodle list', () => {
  it('orders negatives first, then level desc, then by appearance; drops level 0', () => {
    const sorted = sortMoodles([
      m('happy', 'pos', 3),
      m('pain', 'neg', 1, 5),
      m('gone', 'neg', 0),
      m('infection', 'neg', 1, 2),
      m('fever', 'neg', 4),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['fever', 'infection', 'pain', 'happy']);
  });

  it('level 0 removes the element instead of hiding it', () => {
    const list = createMoodleList([m('pain', 'neg', 2), m('fed', 'pos', 1)], {}, document);
    expect(list.el.children).toHaveLength(2);
    list.update([m('pain', 'neg', 0), m('fed', 'pos', 1)]);
    expect(list.el.children).toHaveLength(1);
    expect(list.el.querySelector("[data-id='pain']")).toBeNull();
  });

  it('keeps chip elements across updates (keyed by id) and reorders them', () => {
    const list = createMoodleList([m('a', 'neg', 1), m('b', 'neg', 2)], {}, document);
    const a = list.el.querySelector("[data-id='a']");
    list.update([m('a', 'neg', 3), m('b', 'neg', 2)]);
    expect(list.el.querySelector("[data-id='a']")).toBe(a);
    expect([...list.el.children].map((c) => (c as HTMLElement).dataset.id)).toEqual(['a', 'b']);
  });

  it('folds the rest into a neutral "+N" chip (color.chip.overflow.*, no polarity)', () => {
    expect(planOverflow([1, 2, 3, 4, 5], 3)).toEqual({ visible: [1, 2], overflow: 3 });
    expect(planOverflow([1, 2], 3)).toEqual({ visible: [1, 2], overflow: 0 });
    const list = createMoodleList(
      [m('a', 'neg', 4), m('b', 'neg', 3), m('c', 'pos', 2), m('d', 'pos', 1)],
      { maxVisible: 3 },
      document,
    );
    const more = list.el.lastElementChild as HTMLElement;
    expect(more.dataset.overflow).toBe('');
    expect(more.textContent).toBe('+2');
    expect(more.dataset.polarity).toBeUndefined();
    expect(more.dataset.level).toBeUndefined();
    expect(declsFor(css, '.dz-moodle[data-overflow]')).toEqual({
      '--_border': v('color.chip.overflow.border'),
      '--_bg': v('color.chip.overflow.bg'),
      '--_text': v('color.chip.overflow.text'),
      '--_dot': v('color.chip.overflow.dot'),
    });
    list.update([m('a', 'pos', 4), m('b', 'pos', 3), m('c', 'pos', 2), m('d', 'pos', 1)]);
    expect((list.el.lastElementChild as HTMLElement).dataset.polarity).toBeUndefined();
  });

  it('does not animate chips present on the first render', () => {
    const list = createMoodleList([m('a', 'neg', 1)], {}, document);
    expect((list.el.firstElementChild as HTMLElement).dataset.enter).toBeUndefined();
    list.update([m('a', 'neg', 1), m('b', 'neg', 1, 1)]);
    expect((list.el.lastElementChild as HTMLElement).dataset.enter).toBe('');
  });
});

describe('day chips (Designer, final fix 1)', () => {
  const day = (p: string, l: number) => `[data-hud-chips='day'] ${sel(p, l)}`;
  it('swap only the background to bg.day and add the dark hairline border', () => {
    for (const polarity of POLARITIES)
      for (const level of VISIBLE_LEVELS)
        expect(declsFor(css, day(polarity, level))).toEqual({
          '--_bg': v(`color.moodle.${polarity}.${level}.bg.day` as TokenPath),
        });
    expect(declsFor(css, "[data-hud-chips='day'] .dz-moodle")).toEqual({
      outline: v('border.chip.day'),
    });
  });
});
