import { el, setData, type Doc, type Mounted } from '../../dom/h.js';

/** "+N" chip for moodles that do not fit. Neutral (color.chip.overflow.*), no polarity/level. */
export function createOverflowChip(count: number, doc: Doc): Mounted<number> {
  const root = el(doc, 'span', 'dz-moodle');
  setData(root, 'overflow', true);
  const text = el(doc, 'span', 'dz-moodle__label');
  root.append(el(doc, 'i', 'dz-moodle__dot'), text);
  const update = (n: number): void => {
    text.textContent = `+${n}`;
    root.setAttribute('aria-label', `Więcej: ${n}`);
  };
  update(count);
  return { el: root, update, destroy: () => root.remove() };
}
