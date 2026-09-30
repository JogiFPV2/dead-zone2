import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';
import { moodAt } from '../../mood/vignette.js';
import { dayLabel, formatClock, type ClockVM } from './model.js';

/**
 * Clock panel (spec §3.8). Update once per game minute with the sim clock view. `data-mood`
 * (day / dusk / night, same keyframes as the vignette) is exposed for styling and tests only:
 * the spec has no visual day/night indicator.
 */
export function createClock(vm: ClockVM, doc: Doc = defaultDoc()): Mounted<ClockVM> {
  const root = el(doc, 'div', 'dz-clock dz-glass');
  root.setAttribute('role', 'timer');
  const time = el(doc, 'time', 'dz-clock__time');
  const day = el(doc, 'span', 'dz-clock__day');
  root.append(time, day);
  let key = '';
  const update = (p: ClockVM): void => {
    const next = `${formatClock(p.minuteOfDay)}|${p.day}`;
    if (next === key) return;
    key = next;
    time.textContent = formatClock(p.minuteOfDay);
    day.textContent = dayLabel(p.day);
    root.dataset.mood = moodAt(p.minuteOfDay);
    root.setAttribute('aria-label', `${dayLabel(p.day)}, ${formatClock(p.minuteOfDay)}`);
  };
  update(vm);
  return { el: root, update, destroy: () => root.remove() };
}
