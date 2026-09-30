/**
 * Deterministic math. Only IEEE-754 correctly-rounded ops (+ - * /, sqrt, fround, floor, abs,
 * min, max) are used, so results are bit-identical on V8, SpiderMonkey and JSC.
 *
 * Angles are binary angle measures (BAM, u16): 65536 = 360°, measured from +x towards +y.
 * Decision: we use our own polynomial atan2 instead of `Math.atan2` + `fround`, because
 * `Math.atan2` is not required to be correctly rounded and engines differ in the last ulp;
 * `fround` would hide most, but not all, of those differences (a value near an f32 rounding
 * boundary can still round differently). The series is accurate to < 1e-7 rad, far below the BAM
 * resolution (9.6e-5 rad).
 */
export const BAM_FULL = 65536;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const PI = 3.141592653589793;
const RAD_TO_BAM = BAM_FULL / TWO_PI;
const BAM_TO_RAD = TWO_PI / BAM_FULL;

const QUARTER_PI = 0.7853981633974483;
const TAN_PI_8 = 0.41421356237309503;

/**
 * atan(a) for a in [0, 1]. Range reduction to |t| ≤ tan(π/8) via atan(a) = π/4 + atan((a−1)/(a+1)),
 * then the Taylor series up to t^15 (truncation error < 3e-8 rad).
 */
function atanUnit(a: number): number {
  let offset = 0;
  let t = a;
  if (a > TAN_PI_8) {
    offset = QUARTER_PI;
    t = (a - 1) / (a + 1);
  }
  const s = t * t;
  const p =
    1 +
    s *
      (-1 / 3 +
        s * (1 / 5 + s * (-1 / 7 + s * (1 / 9 + s * (-1 / 11 + s * (1 / 13 + s * (-1 / 15)))))));
  return offset + t * p;
}

/** Deterministic atan2 in radians, range (-π, π]. atan2(0, 0) = 0. */
export function datan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  let r = ay > ax ? HALF_PI - atanUnit(ax / ay) : atanUnit(ay / ax);
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

/** Deterministic atan2 as a BAM angle in [0, 65535]. */
export function atan2Bam(y: number, x: number): number {
  return Math.round(datan2(y, x) * RAD_TO_BAM) & 0xffff;
}

/** BAM → radians in [0, 2π), rounded to f32. */
export function bamToRad(bam: number): number {
  return Math.fround((bam & 0xffff) * BAM_TO_RAD);
}
