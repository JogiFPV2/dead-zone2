// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, readCss, v } from '../../test/css.js';
import {
  createStatRow,
  createStatRows,
  durabilityRow,
  formatDecimal,
  formatRange,
} from './index.js';

const css = readCss('components/stat-row/stat-row.css');

describe('StatRow model', () => {
  it('formats decimals with a comma and ranges with an en dash (mockup)', () => {
    expect(formatDecimal(0.8)).toBe('0,8');
    expect(formatDecimal(1, 2)).toBe('1,00');
    expect(formatRange(0.6, 1.2)).toBe('0,6–1,2');
  });
  it('durability row: current/max with a clamped bar', () => {
    expect(durabilityRow(8, 10)).toEqual({ label: 'Trwałość', value: '8/10', bar: 0.8 });
    expect(durabilityRow(12, 10).bar).toBe(1);
    expect(durabilityRow(3, 0).bar).toBe(0);
  });
});

describe('StatRow element', () => {
  it('label, value, optional unit, tone and bar', () => {
    const row = createStatRow({ label: 'Zasięg', value: '0,8', unit: 'm' }, document);
    const q = (s: string) => row.el.querySelector<HTMLElement>(s);
    expect(q('.dz-statrow__label')?.textContent).toBe('Zasięg');
    expect(q('.dz-statrow__num')?.textContent).toBe('0,8');
    expect(q('.dz-statrow__unit')?.textContent).toBe('m');
    expect(q('.dz-statrow__unit')?.hidden).toBe(false);
    expect(q('.dz-statrow__bar')?.hidden).toBe(true);
    expect(row.el.dataset.tone).toBe('default');
    row.update({ label: 'Krwawienie', value: '+25%', tone: 'danger' });
    expect(row.el.dataset.tone).toBe('danger');
    expect(q('.dz-statrow__unit')?.hidden).toBe(true);
    row.update(durabilityRow(8, 10));
    expect(q('.dz-statrow__bar')?.hidden).toBe(false);
    expect(q('.dz-statrow__fill')?.style.transform).toBe('scaleX(0.8)');
    row.update({ label: 'x', value: '1', bar: 7 });
    expect(q('.dz-statrow__fill')?.style.transform).toBe('scaleX(1)');
  });

  it('list reuses rows when the count stays and rebuilds when it changes', () => {
    const list = createStatRows([{ label: 'A', value: '1' }], document);
    const first = list.el.firstElementChild;
    list.update([{ label: 'B', value: '2' }]);
    expect(list.el.firstElementChild).toBe(first);
    expect(list.el.textContent).toBe('B2');
    list.update([
      { label: 'A', value: '1' },
      { label: 'B', value: '2' },
    ]);
    expect(list.el.children).toHaveLength(2);
    list.update([]);
    expect(list.el.hidden).toBe(true);
  });
});

describe('StatRow CSS (gen_craft.py .srow)', () => {
  it('row: 26 px min, padding 3 px, gap 10, divider between rows only', () => {
    expect(declsFor(css, '.dz-statrow')).toMatchObject({
      '--_value': v('color.accent.hi'),
      gap: v('space.2-5'),
      'min-height': v('size.statRow.height'),
      padding: `${v('size.statRow.padY')} 0`,
      'border-top': `${v('border.1')} solid ${v('color.border.row')}`,
    });
    expect(declsFor(css, '.dz-statrow:first-child')['border-top']).toBe('0');
    expect(declsFor(css, ".dz-statrow[data-tone='danger']")['--_value']).toBe(
      v('color.danger.text'),
    );
  });
  it('label muted left; value accent.hi semi-bold tabular right; unit smaller muted', () => {
    expect(declsFor(css, '.dz-statrow__label')).toEqual({
      flex: '1',
      color: v('color.text.muted'),
      font: v('font.stat.label'),
    });
    expect(declsFor(css, '.dz-statrow__value')).toMatchObject({
      color: 'var(--_value)',
      font: v('font.stat.value'),
      'font-variant-numeric': 'tabular-nums',
      'text-align': 'right',
    });
    expect(declsFor(css, '.dz-statrow__unit')).toEqual({
      'margin-left': v('size.statRow.unitGap'),
      color: v('color.text.muted'),
      font: v('font.stat.unit'),
    });
  });
  it('durability bar 56×4 on the track, success fill', () => {
    expect(declsFor(css, '.dz-statrow__bar')).toMatchObject({
      width: v('size.statRow.bar.width'),
      height: v('size.statRow.bar.height'),
      background: v('color.bg.track'),
      'border-radius': v('radius.pill'),
    });
    expect(declsFor(css, '.dz-statrow__fill')).toMatchObject({
      background: v('color.success.base'),
      transition: `transform ${v('motion.slow')} ${v('motion.ease.out')}`,
    });
  });
});
