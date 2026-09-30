import { MeshStandardMaterial } from 'three';

/**
 * Grey-box placeholder material that reacts to the scene lights like the reference
 * (spec 4.1: MeshStandardMaterial, roughness 0.92, metalness 0, flat shading).
 */
export function placeholderMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true });
}
