import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { moodleLabel, type Polarity, type VisibleMoodleLevel } from './model.js';

export interface MoodleProps {
  label: string;
  polarity: Polarity;
  level: VisibleMoodleLevel;
  description?: string;
  /** Renders the chip without the enter animation (e.g. initial HUD state, preview). */
  noEnter?: boolean;
}

/**
 * One moodle chip (StatusChip). Colour comes only from polarity × level
 * (`color.moodle.<polarity>.<level>.*`), never from the moodle type.
 * State lives in `data-polarity` / `data-level`; CSS maps it to tokens.
 */
export function createMoodle(props: MoodleProps, doc: Doc = defaultDoc()): Mounted<MoodleProps> {
  const root = el(doc, 'span', 'dz-moodle');
  const dot = el(doc, 'i', 'dz-moodle__dot');
  const text = el(doc, 'span', 'dz-moodle__label');
  const tip = el(doc, 'span', 'dz-moodle__tip');
  tip.setAttribute('role', 'tooltip');
  root.append(dot, text);
  if (!props.noEnter) setData(root, 'enter', true);
  root.addEventListener('animationend', (e) => {
    if (e.animationName === 'dz-moodle-enter') setData(root, 'enter', false);
    if (e.animationName === 'dz-moodle-flash') setData(root, 'flash', false);
  });

  let prevLevel: VisibleMoodleLevel | undefined;
  const update = (p: MoodleProps): void => {
    root.dataset.polarity = p.polarity;
    root.dataset.level = String(p.level);
    text.textContent = moodleLabel(p.label, p.level);
    if (p.description) {
      tip.textContent = p.description;
      if (!tip.isConnected) root.append(tip);
    } else tip.remove();
    // Level change: one flash (scale 1 → 1.06 → 1 in motion.slow).
    if (prevLevel !== undefined && prevLevel !== p.level) setData(root, 'flash', true);
    prevLevel = p.level;
  };
  update(props);
  return { el: root, update, destroy: () => root.remove() };
}
