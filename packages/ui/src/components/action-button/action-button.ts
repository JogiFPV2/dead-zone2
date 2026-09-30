import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { createIcon } from '../../icons/icon.js';
import { createKeyBadge } from '../key-badge/key-badge.js';
import { actionState, type ActionVM, type ForcedActionState } from './model.js';

export interface ActionButtonProps extends Omit<ActionVM, 'id' | 'holdMs'> {
  /** e.g. `pressed` while the bound key is held down. Real :hover/:active work too. */
  forced?: ForcedActionState;
  onActivate?: () => void;
}

/** Contextual action button. `data-variant` (primary|secondary) × `data-state`. */
export function createActionButton(
  props: ActionButtonProps,
  doc: Doc = defaultDoc(),
): Mounted<ActionButtonProps> {
  const root = el(doc, 'button', 'dz-action');
  root.type = 'button';
  const iconSlot = el(doc, 'span', 'dz-action__icon');
  const label = el(doc, 'span', 'dz-action__label');
  const key = createKeyBadge({ keyLabel: props.key }, doc);
  const progress = el(doc, 'i', 'dz-action__progress');
  root.append(iconSlot, label, key.el, progress);
  let onActivate: (() => void) | undefined;
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!root.disabled) onActivate?.();
  });

  let iconName: string | undefined;
  const update = (p: ActionButtonProps): void => {
    onActivate = p.onActivate;
    root.dataset.variant = p.variant;
    root.dataset.state = actionState(p.enabled, p.forced);
    setData(root, 'focus', p.forced === 'focus');
    root.disabled = !p.enabled;
    label.textContent = p.label;
    key.update({ keyLabel: p.key, variant: p.variant === 'primary' ? 'inverse' : 'light' });
    if (p.icon !== iconName) {
      iconName = p.icon;
      const svg = createIcon(doc, p.icon, 18);
      iconSlot.replaceChildren(...(svg ? [svg] : []));
    }
    if (p.progress !== undefined) {
      progress.style.setProperty('--_progress', String(Math.min(1, Math.max(0, p.progress))));
      setData(root, 'holding', true);
    } else setData(root, 'holding', false);
  };
  update(props);
  return { el: root, update, destroy: () => root.remove() };
}
