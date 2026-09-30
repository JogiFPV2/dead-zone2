import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';

/**
 * `light` = on glass panels; `inverse` = on the primary (amber) button (spec §3 KeyBadge);
 * `hint` = compact muted chip in key-hint footers (ItemTooltip redesign).
 */
export type KeyBadgeVariant = 'light' | 'inverse' | 'hint';

export interface KeyBadgeProps {
  /** Key label as stored in bindings (`e`, `J`, `Esc`); shown uppercase via CSS. */
  keyLabel: string;
  variant?: KeyBadgeVariant;
}

export function createKeyBadge(
  props: KeyBadgeProps,
  doc: Doc = defaultDoc(),
): Mounted<KeyBadgeProps> {
  const root = el(doc, 'span', 'dz-key');
  const update = (p: KeyBadgeProps): void => {
    root.textContent = p.keyLabel;
    root.dataset.variant = p.variant ?? 'light';
  };
  update(props);
  return { el: root, update, destroy: () => root.remove() };
}
