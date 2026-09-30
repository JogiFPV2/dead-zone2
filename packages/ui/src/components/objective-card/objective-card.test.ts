// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declsFor, keyframes, readCss, v } from '../../test/css.js';
import { createObjectiveCard, OBJECTIVE_HOLD_MS, type ObjectiveVM } from './index.js';

const css = readCss('components/objective-card/objective-card.css');
const rescue: ObjectiveVM = {
  id: 'reach-villa',
  title: 'Dotrzyj do willi i znajdź ocalałego lekarza',
  progress: 0.4,
  state: 'active',
  step: 1,
  steps: 3,
};
const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel);

describe('ObjectiveCard states (spec §3.1)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('active: header, J badge, step counter, title and progress bar', () => {
    const card = createObjectiveCard(rescue, {}, document);
    expect(card.el.dataset.state).toBe('active');
    expect(q(card.el, '.dz-objective__label')?.textContent).toBe('Cel bieżący');
    expect(q(card.el, '.dz-objective__step')?.textContent).toBe('1/3');
    expect(q(card.el, '.dz-key')?.textContent).toBe('J');
    expect(q(card.el, '.dz-objective__title')?.textContent).toBe(rescue.title);
    expect(q(card.el, '.dz-objective__fill')?.style.transform).toBe('scaleX(0.4)');
    expect(q(card.el, '.dz-objective__track')?.getAttribute('aria-valuenow')).toBe('40');
    expect(card.el.dataset.updated).toBeUndefined();
    card.update({ id: rescue.id, title: rescue.title, state: 'active', progress: 7 });
    expect(q(card.el, '.dz-objective__step')?.hidden).toBe(true);
    expect(q(card.el, '.dz-objective__fill')?.style.transform).toBe('scaleX(1)');
  });

  it('updated: accent border for 600 ms (explicit state or any change while active)', () => {
    const card = createObjectiveCard(rescue, {}, document);
    card.update({ ...rescue, progress: 0.6 });
    expect(card.el.dataset.updated).toBe('');
    vi.advanceTimersByTime(599);
    expect(card.el.dataset.updated).toBe('');
    vi.advanceTimersByTime(1);
    expect(card.el.dataset.updated).toBeUndefined();
    card.update({ ...rescue, id: 'free-survivor', step: 2, state: 'updated', progress: 0 });
    expect(card.el.dataset.updated).toBe('');
    expect(card.el.dataset.state).toBe('updated');
  });

  it('completed: success header, full bar, fades out after 3 s and hides', () => {
    const card = createObjectiveCard({ ...rescue, state: 'completed' }, {}, document);
    expect(q(card.el, '.dz-objective__label')?.textContent).toBe('Cel ukończony');
    expect(q(card.el, '.dz-objective__fill')?.style.transform).toBe('scaleX(1)');
    expect(OBJECTIVE_HOLD_MS).toBe(3000);
    const end = new Event('animationend') as Event & { animationName: string };
    Object.defineProperty(end, 'animationName', { value: 'dz-objective-out' });
    card.el.dispatchEvent(end);
    expect(card.el.hidden).toBe(true);
    // The same completed objective again does not bring it back.
    card.update({ ...rescue, state: 'completed' });
    expect(card.el.hidden).toBe(true);
    card.update({ ...rescue, id: 'next', state: 'active' });
    expect(card.el.hidden).toBe(false);
  });

  it('none / null: hidden', () => {
    const card = createObjectiveCard(null, {}, document);
    expect(card.el.hidden).toBe(true);
    expect(card.el.dataset.state).toBe('none');
    card.update({ ...rescue, state: 'none' });
    expect(card.el.hidden).toBe(true);
    card.update(rescue);
    expect(card.el.hidden).toBe(false);
    expect(card.el.dataset.updated).toBeUndefined(); // appearing is not an update
  });
});

describe('ObjectiveCard CSS', () => {
  it('uses the spec geometry and tokens', () => {
    expect(declsFor(css, '.dz-objective')).toMatchObject({
      width: v('size.objective.width'),
      'min-height': v('size.objective.height'),
      padding: `${v('space.3')} ${v('space.4')}`,
      'pointer-events': 'none',
    });
    expect(declsFor(css, '.dz-objective__head')).toMatchObject({
      height: v('size.objective.row'),
      gap: v('space.2'),
    });
    expect(declsFor(css, '.dz-objective__marker')).toMatchObject({
      width: v('size.objective.marker.width'),
      height: v('size.objective.marker.height'),
    });
    expect(declsFor(css, '.dz-objective__label')).toMatchObject({
      font: v('font.label.sm'),
      'letter-spacing': v('font.tracking.wide'),
      color: `var(--_accent, ${v('color.accent.base')})`,
    });
    expect(declsFor(css, '.dz-objective__title')).toMatchObject({
      font: v('font.body.md'),
      color: v('color.text.primary'),
      margin: `${v('space.1-5')} 0 0`,
      '-webkit-line-clamp': '2',
    });
    expect(declsFor(css, '.dz-objective__track')).toMatchObject({
      height: v('size.objective.progress'),
      'margin-top': v('size.objective.progressGap'),
      'border-radius': v('radius.pill'),
      background: v('color.bg.track'),
    });
    expect(declsFor(css, '.dz-objective__fill').transition).toBe(
      `transform ${v('motion.slow')} ${v('motion.ease.out')}`,
    );
  });

  it('updated and completed states', () => {
    expect(declsFor(css, '.dz-objective[data-updated]')).toEqual({
      'border-color': v('color.border.accent'),
    });
    expect(declsFor(css, ".dz-objective[data-state='completed']")).toEqual({
      '--_accent': v('color.success.text'),
      '--_fill': v('color.success.base'),
      animation: `dz-objective-out ${v('motion.slow')} linear ${v('motion.objective.hold')} forwards`,
    });
    expect(keyframes(css)).toEqual(['dz-objective-out']);
  });
});
