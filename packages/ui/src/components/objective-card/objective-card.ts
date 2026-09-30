import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { createKeyBadge } from '../key-badge/key-badge.js';
import {
  clampProgress,
  OBJECTIVE_HEADER,
  OBJECTIVE_HIGHLIGHT_MS,
  stepLabel,
  type ObjectiveVM,
} from './model.js';

export interface ObjectiveCardOptions {
  /** Journal key shown in the header badge (default `J`). */
  journalKey?: string;
}

/**
 * Objective card (spec §3.1). `null` or state `none` hides it (moodles move up: layout is the
 * game's). A change of title, progress or step while active also counts as `updated`.
 * `completed` shows the success header and a full bar, then fades out after 3 s (CSS) and hides.
 */
export function createObjectiveCard(
  vm: ObjectiveVM | null,
  options: ObjectiveCardOptions = {},
  doc: Doc = defaultDoc(),
): Mounted<ObjectiveVM | null> {
  const root = el(doc, 'section', 'dz-objective dz-glass');
  const head = el(doc, 'div', 'dz-objective__head');
  const label = el(doc, 'span', 'dz-objective__label');
  const step = el(doc, 'span', 'dz-objective__step');
  head.append(el(doc, 'span', 'dz-objective__marker'), label, step);
  head.append(createKeyBadge({ keyLabel: options.journalKey ?? 'J' }, doc).el);
  const title = el(doc, 'p', 'dz-objective__title');
  const track = el(doc, 'div', 'dz-objective__track');
  const fill = el(doc, 'div', 'dz-objective__fill');
  track.append(fill);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  root.append(head, title, track);

  let highlight: ReturnType<typeof setTimeout> | undefined;
  root.addEventListener('animationend', (e) => {
    if (e.animationName === 'dz-objective-out' || e.animationName === 'dz-fade-out')
      root.hidden = true;
  });
  const flash = (): void => {
    clearTimeout(highlight);
    setData(root, 'updated', true);
    highlight = setTimeout(() => setData(root, 'updated', false), OBJECTIVE_HIGHLIGHT_MS);
  };

  let prev: ObjectiveVM | null = null;
  const update = (p: ObjectiveVM | null): void => {
    const state = p?.state ?? 'none';
    root.dataset.state = state;
    if (!p || state === 'none') {
      root.hidden = true;
      prev = p;
      return;
    }
    const wasDone = prev?.state === 'completed' && prev.id === p.id;
    if (!(state === 'completed' && wasDone)) root.hidden = false;
    const done = state === 'completed';
    const progress = done ? 1 : clampProgress(p.progress);
    label.textContent = done ? OBJECTIVE_HEADER.completed : OBJECTIVE_HEADER.current;
    step.textContent = stepLabel(p);
    step.hidden = step.textContent === '';
    title.textContent = p.title;
    title.title = p.title;
    fill.style.transform = `scaleX(${progress})`;
    track.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    const changed =
      prev !== null &&
      prev.state !== 'none' &&
      (prev.id !== p.id ||
        prev.title !== p.title ||
        prev.progress !== p.progress ||
        prev.step !== p.step);
    if (state === 'updated' || (state === 'active' && changed)) flash();
    prev = p;
  };
  update(vm);
  return {
    el: root,
    update,
    destroy: () => {
      clearTimeout(highlight);
      root.remove();
    },
  };
}
