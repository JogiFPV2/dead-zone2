/** Preview of the redesigned ItemTooltip and the shared StatRow (mockup `tooltip-item.png`). */
import { tokens } from '../src/tokens/tokens.generated.js';
import type { Doc } from '../src/dom/h.js';
import {
  createItemTooltip,
  createStatRows,
  durabilityRow,
  formatRange,
  type TooltipItem,
} from '../src/index.js';
import { minRatio, type PreviewKit } from './preview-new.js';

const c = tokens.color;

/** The mockup item. */
export const KNIFE: TooltipItem = {
  name: 'Nóż kuchenny',
  category: 'Broń · Krótka ostra',
  stats: [
    { label: 'Obrażenia', value: formatRange(0.6, 1.2) },
    { label: 'Zasięg', value: '0,8', unit: 'm' },
    { label: 'Szybkość ataku', value: '1,4', unit: '/s' },
    { label: 'Waga', value: '0,3', unit: 'kg' },
    durabilityRow(8, 10),
  ],
};

const WATER: TooltipItem = {
  name: 'Butelka wody',
  category: 'Jedzenie · Napój',
  stats: [
    { label: 'Pragnienie', value: '−35' },
    { label: 'Objętość', value: '0,5', unit: 'l' },
    { label: 'Waga', value: '0,5', unit: 'kg' },
  ],
  actions: [
    { key: 'LPM', label: 'pij' },
    { key: 'Q', label: 'upuść' },
  ],
};

export function buildTooltipPreview(doc: Doc, scene: string, kit: PreviewKit): HTMLElement {
  const { h, cell } = kit;
  const row = h('div', 'pv-row');
  const bg = c.bg.itemTooltip;
  const ratio = minRatio(scene, [
    [c.text.primary, bg],
    [c.accent.base, bg],
    [c.accent.hi, bg],
    [c.text.muted, bg],
    [c.danger.text, bg],
    [c.text.muted, c.bg.itemTooltip, c.bg.key],
  ]);
  const knife = createItemTooltip(null, doc);
  knife.select(KNIFE);
  const water = createItemTooltip(null, doc);
  water.select(WATER);
  const rows = createStatRows(
    [
      { label: 'Obrażenia', value: '1,2–1,9' },
      { label: 'Krwawienie', value: '+25%', tone: 'danger' },
      durabilityRow(8, 10),
      { label: 'Waga', value: '1,0', unit: 'kg' },
    ],
    doc,
  );
  const combo = h('div', 'pv-statbox');
  combo.append(rows.el);
  row.append(
    cell(knife.el, `ItemTooltip · makieta · ${ratio}`),
    cell(water.el, 'własna lista akcji w stopce'),
    cell(combo, 'StatRow (wspólny z tooltipem łączenia) · ton danger'),
  );
  return row;
}
