import type { BufferGeometry, Material } from 'three';

/** Car size the vehicle view fits a model to (content `vehicleTypes`: metres, nose +x). */
export interface CarSize {
  readonly id: string;
  readonly length: number;
  readonly width: number;
}

/** A car model of the realistic style: one geometry per car type, the shared PBR material. */
export interface RealCarModel {
  readonly material: Material;
  /** Geometry fitted to the type (nose +x, centred on x / z, wheels on y = 0); cached. */
  geometryFor(t: CarSize): BufferGeometry;
}

/** Kenney's sedan has its nose on model +z: a quarter turn puts it on the car's +x. */
export const SEDAN_NOSE_ROT_Y = Math.PI / 2;

/** Scale of a model `size` (x = length after the turn, z = width) onto a car type. */
export function carFit(
  model: { length: number; width: number },
  t: CarSize,
): { sx: number; sy: number; sz: number } {
  const sx = t.length / model.length;
  const sz = t.width / model.width;
  // Height follows the length (keeps the silhouette; the type has no height).
  return { sx, sy: sx, sz };
}

/** Designer's sedan (`deadzone-pbr/sedan`) fitted per car type. */
export function realSedan(src: BufferGeometry, material: Material): RealCarModel {
  const cache = new Map<string, BufferGeometry>();
  return {
    material,
    geometryFor(t) {
      const key = `${t.id}|${t.length}|${t.width}`;
      let g = cache.get(key);
      if (g) return g;
      g = src.clone();
      g.rotateY(SEDAN_NOSE_ROT_Y);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const fit = carFit({ length: bb.max.x - bb.min.x, width: bb.max.z - bb.min.z }, t);
      g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      g.scale(fit.sx, fit.sy, fit.sz);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      cache.set(key, g);
      return g;
    },
  };
}
