import { Box3, BoxGeometry, Group, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { isRealScale } from '../world/furniture-footprint.js';
import { CONTAINER_MODELS, fitted } from './model-kit.js';

describe('CONTAINER_MODELS', () => {
  it('marks every Designer model (deadzone-furniture/) real-scale, so it is never fit by height', () => {
    // `fitted` scales to the content height and drops box.min.y to 0: a wall cabinet authored at
    // 1.15–1.85 m would land on the floor. Real-scale ids skip it (game.ts, map-objects.ts).
    const designer = Object.entries(CONTAINER_MODELS).filter(([, m]) =>
      m.startsWith('deadzone-furniture/'),
    );
    expect(designer.length).toBeGreaterThan(0);
    expect(designer.filter(([id]) => !isRealScale(id)).map(([id]) => id)).toEqual([]);
  });

  it('keeps legacy (Kenney) models on the height fit', () => {
    const legacy = Object.keys(CONTAINER_MODELS).filter(
      (id) => !CONTAINER_MODELS[id]!.startsWith('deadzone-furniture/'),
    );
    expect(legacy.filter(isRealScale)).toEqual([]);
  });
});

describe('fitted', () => {
  it('puts the base at y = 0 (why real-scale models bypass it)', () => {
    // Like a loaded glTF scene: identity root, the mesh offset inside it.
    const m = new Mesh(new BoxGeometry(0.6, 0.7, 0.21));
    m.position.y = 1.5;
    const scene = new Group().add(m);
    const w = fitted(scene, 0.7);
    w.updateMatrixWorld(true);
    expect(new Box3().setFromObject(w).min.y).toBeCloseTo(0, 6);
  });
});
