import type { FarmPlotView, WaterTankView } from '@deadzone/protocol';

/** Litres for the tank line: whole litres, one decimal below 1 l (Polish comma, „0,4”). */
export function tankLitres(l: number): string {
  const v = Math.max(0, l);
  if (v > 0 && v < 1) {
    const r = Math.round(v * 10) / 10;
    return r >= 1 ? '1' : r.toFixed(1).replace('.', ',');
  }
  return String(Math.round(v));
}

const QUALITY_PL: Readonly<Record<WaterTankView['quality'], string>> = {
  clean: 'czysta',
  tainted: 'brudna',
};

/**
 * Line under the name in the furniture menu for a piece with `FurnitureView.waterTank`
 * (protocol 36), e.g. „Woda: 7/10 l, brudna”.
 */
export const waterTankLine = (t: WaterTankView): string =>
  `Woda: ${tankLitres(t.litres)}/${tankLitres(t.capacityL)} l, ${QUALITY_PL[t.quality] ?? t.quality}`;

const PLOT_WATER_PL: Readonly<Record<FarmPlotView['water'], string>> = {
  wet: 'wilgotna ziemia',
  dry: 'sucha ziemia, podlej',
  wilted: 'więdnie, podlej szybko',
  dead: 'uschła',
};

const PLOT_STAGE_PL = ['przekopana ziemia', 'zasiane', 'kiełkuje', 'rośnie', 'dojrzałe, do zbioru'];

/** Line under the name for a dug plot (`FurnitureView.plot`, farming), e.g. „Rośnie 40%, sucha ziemia”. */
export function plotLine(p: FarmPlotView): string {
  if (!p.crop) return 'Przekopana ziemia, posadź coś';
  if (p.water === 'dead') return 'Roślina uschła, usuń ją';
  const stage = PLOT_STAGE_PL[p.stage] ?? '';
  const pct = p.stage > 0 && p.stage < 4 ? ` ${Math.round(p.growth * 100)}%` : '';
  const head = stage.charAt(0).toUpperCase() + stage.slice(1);
  return `${head}${pct}, ${PLOT_WATER_PL[p.water]}`;
}
