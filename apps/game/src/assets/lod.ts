import { LOD, type Object3D } from 'three';

/**
 * THREE.LOD from levels ordered by distance. `distanceBias` shifts every threshold: with the
 * isometric rig the camera sits ~100 units away, and three divides the distance by `zoom` for
 * orthographic cameras, so bias = rig distance makes the manifest distances mean "zoom-out".
 */
export function buildLod(levels: { object: Object3D; distance: number }[], distanceBias = 0): LOD {
  const lod = new LOD();
  for (const [i, l] of levels.entries())
    lod.addLevel(l.object, i === 0 ? 0 : distanceBias + l.distance);
  return lod;
}
