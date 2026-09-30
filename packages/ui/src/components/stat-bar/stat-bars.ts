import { defaultDoc, el, type Doc, type Mounted } from '../../dom/h.js';
import { STAT_IDS, type StatThresholds } from './model.js';
import { createStatBar, type StatBarOptions, type StatBarProps } from './stat-bar.js';

/** Spec §5 StatsVM. */
export interface StatsVM {
  health: number;
  thirst: number;
  hunger: number;
  energy: number;
  thresholds?: StatThresholds;
}

/** The 842×40 glass pill with the four stat groups (health, thirst, hunger, energy). */
export function createStatBars(
  stats: StatsVM,
  options: StatBarOptions = {},
  doc: Doc = defaultDoc(),
): Mounted<StatsVM> {
  const root = el(doc, 'div', 'dz-statbars dz-glass');
  const bars = STAT_IDS.map((stat) => {
    const bar = createStatBar(toProps(stats, stat), options, doc);
    root.appendChild(bar.el);
    return { stat, bar };
  });
  return {
    el: root,
    update: (s) => {
      for (const { stat, bar } of bars) bar.update(toProps(s, stat));
    },
    destroy: () => root.remove(),
  };
}

function toProps(s: StatsVM, stat: StatBarProps['stat']): StatBarProps {
  const p: StatBarProps = { stat, value: s[stat] };
  if (s.thresholds) p.thresholds = s.thresholds;
  return p;
}
