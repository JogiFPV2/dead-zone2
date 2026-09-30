import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';
import { clampBar, type StatRowVM } from './model.js';

/** One stat row (`.dz-statrow`). */
export function createStatRow(vm: StatRowVM, doc: Doc = defaultDoc()): Mounted<StatRowVM> {
  const root = el(doc, 'div', 'dz-statrow');
  const label = el(doc, 'span', 'dz-statrow__label');
  const track = el(doc, 'span', 'dz-statrow__bar');
  const fill = el(doc, 'span', 'dz-statrow__fill');
  track.append(fill);
  const value = el(doc, 'span', 'dz-statrow__value');
  const num = el(doc, 'span', 'dz-statrow__num');
  const unit = el(doc, 'span', 'dz-statrow__unit');
  value.append(num, unit);
  root.append(label, track, value);
  const update = (p: StatRowVM): void => {
    label.textContent = p.label;
    num.textContent = p.value;
    unit.textContent = p.unit ?? '';
    unit.hidden = !p.unit;
    root.dataset.tone = p.tone ?? 'default';
    track.hidden = p.bar === undefined;
    fill.style.transform = `scaleX(${clampBar(p.bar ?? 0)})`;
  };
  update(vm);
  return { el: root, update, destroy: () => root.remove() };
}

/** A list of stat rows (`.dz-statrows`), dividers between rows. Rebuilt when the count changes. */
export function createStatRows(
  rows: readonly StatRowVM[],
  doc: Doc = defaultDoc(),
): Mounted<readonly StatRowVM[]> {
  const root = el(doc, 'div', 'dz-statrows');
  let items: Mounted<StatRowVM>[] = [];
  const update = (list: readonly StatRowVM[]): void => {
    if (list.length !== items.length) {
      items = list.map((r) => createStatRow(r, doc));
      root.replaceChildren(...items.map((i) => i.el));
    } else list.forEach((r, i) => items[i]?.update(r));
    root.hidden = list.length === 0;
  };
  update(rows);
  return { el: root, update, destroy: () => root.remove() };
}
