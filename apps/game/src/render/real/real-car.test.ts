import { BoxGeometry, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CAR_DRAW_LENGTH, carFit, realSedan } from './real-car.js';

describe('realSedan', () => {
  it('fits the model to the car type: nose on +x, centred, wheels on the ground', () => {
    // Kenney layout: long axis z (2.5 × 4.3 m after the asset scale), base at y = 0.
    const src = new BoxGeometry(2.5, 2.2, 4.3).translate(0, 1.1, 0.2);
    const car = realSedan(src, new MeshStandardMaterial());
    const g = car.geometryFor({ id: 'base:sedan', length: 4.6, width: 1.8 });
    const bb = g.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(4.3);
    expect(bb.max.z - bb.min.z).toBeCloseTo(1.8);
    expect(bb.min.y).toBeCloseTo(0);
    expect(bb.min.x + bb.max.x).toBeCloseTo(0);
    expect(bb.min.z + bb.max.z).toBeCloseTo(0);
    // Cached per type; the source stays untouched.
    expect(car.geometryFor({ id: 'base:sedan', length: 4.6, width: 1.8 })).toBe(g);
    src.computeBoundingBox();
    expect(src.boundingBox!.max.z - src.boundingBox!.min.z).toBeCloseTo(4.3);
  });

  it('full type width, 4.3 m of a 4.6 m type, height follows the width', () => {
    const f = carFit({ length: 2.55, width: 1.5 }, { id: 'base:sedan', length: 4.6, width: 1.8 });
    expect(f.sx * 2.55).toBeCloseTo(4.3);
    expect(f.sz * 1.5).toBeCloseTo(1.8);
    expect(f.sy).toBeCloseTo(f.sz);
    // Kenney sedan is 1.3 m tall → about 1.56 m.
    expect(f.sy * 1.3).toBeLessThan(1.6);
    expect(CAR_DRAW_LENGTH).toBeLessThan(1);
  });
});
