import { BoxGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { NO_CUTAWAY } from '../../world/cutaway.js';
import type { ModelPlacement } from './map-models.js';
import { RealMapLayer, placementMatrix } from './real-map-layer.js';

const at = (id: string, x: number, z: number): ModelPlacement => ({
  id,
  x,
  z,
  rotY: 0,
  sx: 1,
  sy: 1,
  sz: 1,
});
const models = new Map([
  ['blok-p4', new BoxGeometry(57.6, 18, 12).translate(28.8, 9, 6)],
  ['krzak', new BoxGeometry(1, 1, 1)],
]);

function layer(): RealMapLayer {
  return new RealMapLayer(models, new MeshStandardMaterial(), true);
}

describe('RealMapLayer', () => {
  it('one instance per building over the chunks listing it, one mesh per model', () => {
    const l = layer();
    const b = new Map([[5, [at('blok-p4', 40, 10)]]]);
    l.loadChunk(0, 0, { buildings: b, props: [at('krzak', 1, 1), at('krzak', 2, 2)] });
    l.loadChunk(1, 0, { buildings: b, props: [] });
    l.update();
    expect(l.counts()).toEqual({ 'blok-p4': 1, krzak: 2 });
    expect(l.root.children).toHaveLength(2);
    // The building stays while one chunk listing it is loaded.
    l.unloadChunk(0, 0);
    l.update();
    expect(l.counts()).toEqual({ 'blok-p4': 1 });
    l.unloadChunk(1, 0);
    l.update();
    expect(l.counts()).toEqual({});
  });

  it('the cutaway (player building, occluders) hides that building model only', () => {
    const l = layer();
    l.loadChunk(0, 0, {
      buildings: new Map([
        [5, [at('blok-p4', 40, 10)]],
        [6, [at('blok-p4', 40, 60)]],
        [7, [at('blok-p4', 40, 90)]],
      ]),
      props: [],
    });
    l.setCutaway({ ...NO_CUTAWAY, building: 5, occluders: new Set([6]) });
    l.update();
    expect(l.counts()).toEqual({ 'blok-p4': 1 });
    l.setCutaway(NO_CUTAWAY);
    l.update();
    expect(l.counts()).toEqual({ 'blok-p4': 3 });
  });

  it('places the model body centre on the placement point, scaled and turned', () => {
    const m = placementMatrix({ ...at('blok-p4', 100, 50), sx: 0.5, rotY: Math.PI / 2 });
    // Body centre (28.8, 6) → placement point; model +x end (57.6) → 14.4 m along −z.
    expect(
      new Vector3(28.8, 0, 6).applyMatrix4(m).distanceTo(new Vector3(100, 0, 50)),
    ).toBeLessThan(1e-6);
    const end = new Vector3(57.6, 0, 6).applyMatrix4(m);
    expect(end.x).toBeCloseTo(100);
    expect(end.z).toBeCloseTo(50 - 14.4);
  });
});
