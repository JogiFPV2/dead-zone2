/** Numeric values of dimension / duration tokens (for JS timers and SVG sizes). */

/** `'16px'` → 16. */
export function px(value: string): number {
  const m = /^(-?[\d.]+)px$/.exec(value.trim());
  if (!m) throw new Error(`not a px value: ${value}`);
  return Number(m[1]);
}

/** `'250ms'` → 250, `'1.5s'` → 1500. */
export function ms(value: string): number {
  const m = /^([\d.]+)(ms|s)$/.exec(value.trim());
  if (!m) throw new Error(`not a duration: ${value}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}
