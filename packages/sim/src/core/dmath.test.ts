/* eslint-disable no-restricted-properties -- Math.atan2/sin/cos are the reference values here. */
import { describe, expect, it } from 'vitest';
import { BAM_FULL, atan2Bam, bamToRad, datan2 } from './dmath.js';

describe('dmath', () => {
  it('datan2 is within 1e-6 rad of Math.atan2', () => {
    let worst = 0;
    for (let i = 0; i < 3600; i++) {
      const t = (i / 3600) * 2 * Math.PI;
      for (const r of [0.01, 1, 250]) {
        const x = Math.fround(r * Math.cos(t));
        const y = Math.fround(r * Math.sin(t));
        worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)) % (2 * Math.PI));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('maps axes to BAM quadrants (+y is south)', () => {
    expect(atan2Bam(0, 1)).toBe(0);
    expect(atan2Bam(1, 0)).toBe(BAM_FULL / 4);
    expect(atan2Bam(0, -1)).toBe(BAM_FULL / 2);
    expect(atan2Bam(-1, 0)).toBe((BAM_FULL * 3) / 4);
    expect(atan2Bam(1, 1)).toBe(BAM_FULL / 8);
    expect(atan2Bam(0, 0)).toBe(0);
  });

  it('bamToRad is f32 in [0, 2π)', () => {
    expect(bamToRad(0)).toBe(0);
    expect(bamToRad(BAM_FULL / 2)).toBe(Math.fround(Math.PI));
    const r = bamToRad(BAM_FULL - 1);
    expect(r).toBeLessThan(2 * Math.PI);
    expect(Math.fround(r)).toBe(r);
  });
});
