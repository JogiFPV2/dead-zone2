import type { WaterTankView } from '@deadzone/protocol';

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
