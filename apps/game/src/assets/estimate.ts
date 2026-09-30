import { CompressedTexture, Mesh, type BufferGeometry, type Object3D, type Texture } from 'three';
import { geometryBytes, textureBytes } from './budget.js';

export function estimateGeometry(g: BufferGeometry): number {
  const attrs = Object.values(g.attributes).map((a) => ({
    count: a.count,
    itemSize: a.itemSize,
    bytesPerElement: a.array.BYTES_PER_ELEMENT,
  }));
  const i = g.index;
  return geometryBytes(
    attrs,
    i ? { count: i.count, itemSize: 1, bytesPerElement: i.array.BYTES_PER_ELEMENT } : undefined,
  );
}

/** Compressed textures: sum of the transcoded mip levels; others: RGBA8 (+ mips). */
export function estimateTexture(t: Texture): number {
  if (t instanceof CompressedTexture) {
    return t.mipmaps.reduce((s, m: { data?: ArrayBufferView }) => s + (m.data?.byteLength ?? 0), 0);
  }
  const img = t.image as { width?: number; height?: number } | null;
  if (!img?.width || !img.height) return 0;
  return textureBytes(img.width, img.height, 4, t.generateMipmaps);
}

/** Unique geometries under `root` (shared buffers are counted once). */
export function estimateObjectGeometry(root: Object3D): number {
  const seen = new Set<BufferGeometry>();
  root.traverse((o) => {
    if (o instanceof Mesh) seen.add(o.geometry as BufferGeometry);
  });
  let sum = 0;
  for (const g of seen) sum += estimateGeometry(g);
  return sum;
}
