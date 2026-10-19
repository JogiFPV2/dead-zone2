import { describe, expect, it } from 'vitest';
import { FrameSections } from './frame-sections.js';

describe('FrameSections', () => {
  it('sums marks per section and reports percentiles over the window', () => {
    let t = 0;
    const s = new FrameSections(4, () => t);
    for (let f = 0; f < 6; f++) {
      s.start();
      t += 2;
      s.mark('a');
      t += f;
      s.mark('b');
      s.end();
    }
    const r = s.report();
    // Window of 4: frames 2..5 → b = 2, 3, 4, 5.
    expect(r.a!.mean).toBe(2);
    expect(r.b!.max).toBe(5);
    expect(r.b!.p50).toBe(4);
    expect(r.total!.max).toBe(7);
  });
});
