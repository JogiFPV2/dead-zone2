import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { HINT_SEPARATOR, type HintsVM } from './model.js';

/**
 * Key-hint row (spec §3.11): `WASD ruch · Shift sprint · …` on a glass panel. Hiding fades out
 * (`data-hidden`), then the row is `hidden`.
 */
export function createKeyHints(vm: HintsVM, doc: Doc = defaultDoc()): Mounted<HintsVM> {
  const root = el(doc, 'div', 'dz-hints dz-glass');
  root.addEventListener('transitionend', () => {
    if (root.dataset.hidden !== undefined) root.hidden = true;
  });
  let key = '';
  const update = (p: HintsVM): void => {
    const next = p.items.map((i) => `${i.key}\u0000${i.label}`).join('\u0001');
    if (next !== key) {
      key = next;
      root.replaceChildren();
      p.items.forEach((item, i) => {
        if (i > 0) root.append(el(doc, 'span', 'dz-hints__sep', HINT_SEPARATOR));
        const hint = el(doc, 'span', 'dz-hints__item');
        hint.append(el(doc, 'span', 'dz-hints__key', item.key), ` ${item.label}`);
        root.append(hint);
      });
    }
    if (p.visible) root.hidden = false;
    setData(root, 'hidden', !p.visible);
    if (!p.visible && !root.isConnected) root.hidden = true;
  };
  update(vm);
  return { el: root, update, destroy: () => root.remove() };
}
