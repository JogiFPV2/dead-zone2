import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GPU_BUDGET_BYTES,
  GpuBudget,
  compressedTextureBytes,
  geometryBytes,
  textureBytes,
} from './budget.js';

describe('budget math', () => {
  it('estimates textures with and without mipmaps', () => {
    expect(textureBytes(512, 512, 4, false)).toBe(1_048_576);
    expect(textureBytes(512, 512)).toBe(Math.ceil(1_048_576 * (4 / 3)));
    expect(compressedTextureBytes(512, 512, 16, false)).toBe(262_144);
    expect(compressedTextureBytes(5, 5, 8, false)).toBe(4 * 8); // partial blocks round up
  });

  it('sums attributes and the index buffer', () => {
    const pos = { count: 100, itemSize: 3, bytesPerElement: 4 };
    const uv = { count: 100, itemSize: 2, bytesPerElement: 2 };
    expect(geometryBytes([pos, uv], { count: 300, itemSize: 1, bytesPerElement: 2 })).toBe(
      1200 + 400 + 600,
    );
  });
});

describe('GpuBudget', () => {
  it('defaults to 256 MB', () => {
    expect(new GpuBudget().limitBytes).toBe(DEFAULT_GPU_BUDGET_BYTES);
    expect(DEFAULT_GPU_BUDGET_BYTES).toBe(268_435_456);
  });

  it('tracks per-key bytes, replaces and removes them', () => {
    const b = new GpuBudget(100);
    b.set('a', 30);
    b.set('b', 20);
    b.set('a', 10);
    expect(b.total).toBe(30);
    b.remove('a');
    b.remove('missing');
    expect(b.total).toBe(20);
  });

  it('warns once per crossing and marks the overlay line', () => {
    const onOver = vi.fn();
    const b = new GpuBudget(100, onOver);
    b.set('a', 90);
    expect(b.line()).not.toMatch(/OVER/);
    b.set('b', 20);
    b.set('c', 5);
    expect(onOver).toHaveBeenCalledTimes(1);
    expect(b.line()).toMatch(/OVER BUDGET/);
    b.remove('b');
    b.remove('c');
    b.set('d', 50);
    expect(onOver).toHaveBeenCalledTimes(2);
  });
});
