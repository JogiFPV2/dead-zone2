/**
 * Deterministic trigonometry for vehicles (only + − × ÷, like `core/dmath.ts`): Taylor series
 * after reduction to |a| ≤ π/4. Accurate to ~1e-9, far below f32 precision.
 */
const HALF_PI = 1.5707963267948966;
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;

function sinSmall(a: number): number {
  const s = a * a;
  return a * (1 + s * (-1 / 6 + s * (1 / 120 + s * (-1 / 5040 + s * (1 / 362880)))));
}
function cosSmall(a: number): number {
  const s = a * a;
  return 1 + s * (-1 / 2 + s * (1 / 24 + s * (-1 / 720 + s * (1 / 40320 - s / 3628800))));
}

/** [sin a, cos a] for any finite a. */
export function dsincos(a: number): [number, number] {
  let x = a - Math.floor(a / TWO_PI) * TWO_PI; // [0, 2π)
  if (x > PI) x -= TWO_PI; // (−π, π]
  const q = Math.round(x / HALF_PI); // −2..2
  const r = x - q * HALF_PI; // |r| ≤ π/4
  const s = sinSmall(r);
  const c = cosSmall(r);
  switch (((q % 4) + 4) % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}

export const dtan = (a: number): number => {
  const [s, c] = dsincos(a);
  return s / c;
};
