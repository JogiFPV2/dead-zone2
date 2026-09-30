import { el, type Doc } from '../../dom/h.js';
import { createKeyBadge } from '../key-badge/key-badge.js';
import type { ItemAction } from './model.js';

/** Footer with key chips (`[LPM] atak`), reusable for other tooltips. */
export function renderKeyFooter(root: HTMLElement, actions: readonly ItemAction[], doc: Doc): void {
  root.replaceChildren(
    ...actions.map((a) => {
      const item = el(doc, 'span', 'dz-keyfoot__item');
      item.append(createKeyBadge({ keyLabel: a.key, variant: 'hint' }, doc).el, a.label);
      return item;
    }),
  );
  root.hidden = actions.length === 0;
}
