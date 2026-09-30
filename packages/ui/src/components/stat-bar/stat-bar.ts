import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { createIcon } from '../../icons/icon.js';
import type { IconName } from '../../icons/paths.js';
import {
  DEFAULT_THRESHOLDS,
  DrainDetector,
  clampStat,
  statBarState,
  type StatId,
  type StatThresholds,
} from './model.js';

export interface StatBarProps {
  stat: StatId;
  /** 0..100 */
  value: number;
  thresholds?: StatThresholds;
  /** Force a drain ghost from this value (preview / replay). Normally detected automatically. */
  drainFrom?: number;
  /** `hud` = 120×8 bar (HUD); `panel` = 6 px bar (inventory / skills screens). */
  size?: 'hud' | 'panel';
}

export const STAT_ICONS: Record<StatId, IconName> = {
  health: 'heart',
  thirst: 'drop',
  hunger: 'cutlery',
  energy: 'bolt',
};

export interface StatBarOptions {
  /** Clock for drain detection (ms). Defaults to `performance.now`. */
  now?: () => number;
}

/** One stat group: icon, bar, value. State in `data-state` (normal|low|critical), `data-drain`. */
export function createStatBar(
  props: StatBarProps,
  options: StatBarOptions = {},
  doc: Doc = defaultDoc(),
): Mounted<StatBarProps> {
  const now = options.now ?? (() => performance.now());
  const root = el(doc, 'div', 'dz-statbar');
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  const iconSlot = el(doc, 'span', 'dz-statbar__icon');
  const track = el(doc, 'span', 'dz-statbar__track');
  const ghost = el(doc, 'i', 'dz-statbar__ghost');
  const fill = el(doc, 'i', 'dz-statbar__fill');
  // Ghost sits under the fill, so only the lost part (new → old value) shows.
  track.append(ghost, fill);
  const value = el(doc, 'span', 'dz-statbar__value');
  root.append(iconSlot, track, value);
  ghost.addEventListener('animationend', () => setData(root, 'drain', false));

  const drain = new DrainDetector();
  let stat: StatId | undefined;

  const update = (p: StatBarProps): void => {
    const v = clampStat(p.value);
    if (p.stat !== stat) {
      stat = p.stat;
      root.dataset.stat = p.stat;
      iconSlot.replaceChildren(
        ...[createIcon(doc, STAT_ICONS[p.stat], 18)].filter((n) => n !== null),
      );
    }
    root.dataset.state = statBarState(v, p.thresholds ?? DEFAULT_THRESHOLDS);
    root.dataset.size = p.size ?? 'hud';
    root.setAttribute('aria-valuenow', String(Math.round(v)));
    fill.style.setProperty('--_value', String(v / 100));
    value.textContent = String(Math.round(v));

    const from = p.drainFrom ?? drain.push(v, now());
    if (from !== undefined && from > v) {
      ghost.style.setProperty('--_from', String(clampStat(from) / 100));
      ghost.style.setProperty('--_to', String(v / 100));
      // Restart the one-shot animation.
      setData(root, 'drain', false);
      void root.offsetWidth;
      setData(root, 'drain', true);
    }
  };
  update(props);
  return { el: root, update, destroy: () => root.remove() };
}
