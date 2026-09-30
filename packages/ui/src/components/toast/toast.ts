import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';
import { createIcon } from '../../icons/icon.js';
import { tokens } from '../../tokens/tokens.generated.js';
import { px } from '../../tokens/units.js';
import { TOAST_ICON, toastText, type ToastVM } from './model.js';

/** One toast row (spec §3.4): icon, optional value in the kind colour, text. */
export function createToast(vm: ToastVM, doc: Doc = defaultDoc()): Mounted<ToastVM> {
  const root = el(doc, 'div', 'dz-toast');
  const value = el(doc, 'span', 'dz-toast__value');
  const text = el(doc, 'span', 'dz-toast__text');
  let icon: Element | null = null;
  const update = (p: ToastVM): void => {
    if (root.dataset.kind !== p.kind) {
      root.dataset.kind = p.kind;
      icon?.remove();
      icon = createIcon(doc, TOAST_ICON[p.kind], px(tokens.size.icon.sm));
      if (icon) root.prepend(icon);
    }
    root.dataset.id = p.id;
    value.textContent = p.value ?? '';
    value.hidden = !p.value;
    text.textContent = toastText(p);
  };
  root.append(value, text);
  update(vm);
  return { el: root, update, destroy: () => root.remove() };
}
