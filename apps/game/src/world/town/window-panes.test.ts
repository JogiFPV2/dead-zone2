import { Box3, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CARD_DEPTH, NEAR_TILES, WindowPanes, cardLocal } from './window-panes.js';

const BOX = new Box3(new Vector3(-0.4, 0.9, -0.05), new Vector3(0.4, 2.1, 0.05));
const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);

describe('WindowPanes', () => {
  it('puts the card CARD_DEPTH behind the glass on the inside', () => {
    expect(pos(cardLocal(BOX, 1)).z).toBeCloseTo(CARD_DEPTH);
    expect(pos(cardLocal(BOX, -1)).z).toBeCloseTo(-CARD_DEPTH);
    expect(pos(cardLocal(BOX, 1)).y).toBeCloseTo(1.5);
  });

  it('two draws, no shadows, whatever the count; grows and reuses slots', () => {
    const p = new WindowPanes(2, undefined);
    for (let i = 0; i < 5; i++) p.add(new Matrix4(), BOX, 1, 0, i, 0);
    expect(p.root.children).toHaveLength(2);
    expect(p.glass.castShadow || p.card.castShadow).toBe(false);
    expect(p.size).toBe(5);
    p.remove(1);
    expect(p.glassShown(1)).toBe(false);
    expect(p.add(new Matrix4(), BOX, 1, 0, 9, 9)).toBe(1);
    expect(p.glass.count).toBe(5);
  });

  it('near the player the card hides (real furniture shows), the glass stays', () => {
    const p = new WindowPanes(4, undefined);
    const far = p.add(new Matrix4(), BOX, 1, 0, 100, 100);
    const near = p.add(new Matrix4(), BOX, 1, 0, 3, 0);
    p.setNear(0, 0);
    expect(p.cardShown(near)).toBe(false);
    expect(p.glassShown(near)).toBe(true);
    expect(p.cardShown(far)).toBe(true);
    const late = p.add(new Matrix4(), BOX, 1, 0, NEAR_TILES - 1, 0);
    expect(p.cardShown(late)).toBe(false);
    p.setNear(undefined, undefined);
    expect(p.cardShown(near)).toBe(true);
  });

  it('lit / lowered windows: neither glass nor card', () => {
    const p = new WindowPanes(1, undefined);
    const i = p.add(new Matrix4(), BOX, -1, 3, 0, 0);
    p.set(i, false, false);
    expect(p.glassShown(i) || p.cardShown(i)).toBe(false);
  });
});
