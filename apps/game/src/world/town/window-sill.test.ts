import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute } from 'three';
import { addWindowSills, cellBottom, SILL_DEPTH } from './window-sill.js';

/** A 1 m window module stand-in: a box whose lower half is "glass" from y 0.95 up. */
function module(glassFrom: number) {
  const g = new BoxGeometry(1, 2.8, 0.3).translate(0, 1.4, 0);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const glass = pos.getY(i) > 1;
    uv.set(glass ? [0.5, 0.5] : [0.1, 0.1], i * 2);
    if (glass) pos.setY(i, Math.max(glassFrom, pos.getY(i)));
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

describe('window sills (parapety)', () => {
  const uv = (c: string): [number, number] =>
    c === 'glass' ? [0.5, 0.5] : c === 'glass-lit' ? [0.7, 0.7] : [0.3, 0.3];

  it('a board under the glass of every window module, out of the wall on both sides', () => {
    const geos = new Map([
      ['window-plaster', module(2.8)],
      ['wall-plaster', module(2.8)],
    ]);
    const glassBottom = cellBottom(geos.get('window-plaster')!, [0.5, 0.5]);
    addWindowSills(geos, uv);
    const w = geos.get('window-plaster')!;
    w.computeBoundingBox();
    expect(w.boundingBox!.max.z).toBeCloseTo(SILL_DEPTH, 5);
    expect(w.boundingBox!.min.z).toBeCloseTo(-SILL_DEPTH, 5);
    // The sill top is at the glass bottom (or the fallback height).
    const sillTop = cellBottom(w, [0.3, 0.3]);
    expect(sillTop).toBeLessThan(glassBottom === Infinity ? 1 : glassBottom);
    // Walls are not touched.
    const wall = geos.get('wall-plaster')!;
    wall.computeBoundingBox();
    expect(wall.boundingBox!.max.z).toBeCloseTo(0.15, 5);
  });
});
