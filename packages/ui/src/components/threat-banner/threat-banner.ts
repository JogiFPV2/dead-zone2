import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { createIcon } from '../../icons/icon.js';
import { isRise, threatText, type ThreatLevel } from './model.js';

export interface ThreatBannerProps {
  level: ThreatLevel;
}

/**
 * Threat banner (top centre). `data-level` medium|high|critical; `low` hides it.
 * Critical pulses its background; under reduced motion the pulse is replaced by a "!!" badge
 * (always in the DOM, shown by CSS).
 */
export function createThreatBanner(
  props: ThreatBannerProps,
  doc: Doc = defaultDoc(),
): Mounted<ThreatBannerProps> {
  const root = el(doc, 'div', 'dz-threat');
  root.setAttribute('role', 'status');
  const icon = createIcon(doc, 'warning', 16);
  const alert = el(doc, 'span', 'dz-threat__alert', '!!');
  alert.setAttribute('aria-hidden', 'true');
  const label = el(doc, 'span', 'dz-threat__label');
  if (icon) root.append(icon);
  root.append(alert, label);
  root.addEventListener('animationend', (e) => {
    if (e.animationName === 'dz-threat-enter') setData(root, 'enter', false);
    if (e.animationName === 'dz-threat-flash') setData(root, 'flash', false);
  });

  let prev: ThreatLevel | undefined;
  const update = ({ level }: ThreatBannerProps): void => {
    root.dataset.level = level;
    root.hidden = level === 'low';
    label.textContent = level === 'low' ? '' : threatText(level);
    if (prev === 'low' && level !== 'low') setData(root, 'enter', true);
    // Rising level: one border flash.
    else if (prev !== undefined && isRise(prev, level)) setData(root, 'flash', true);
    prev = level;
  };
  update(props);
  return { el: root, update, destroy: () => root.remove() };
}
