import type { Material } from 'three';

/** Shared wind clock (s) of every tree material (one uniform object, updated once a frame). */
export const windTime = { value: 0 };

/**
 * Cheap leaf sway in the vertex shader: a slow crown sway plus a faster flutter, phase from the
 * instance position (neighbours don't move in step), amplitude growing towards the crown top.
 * Local crown units (radius 1), so about 10–15 cm on a 3 m crown.
 */
export const WIND_GLSL = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 wOrg = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
#else
  vec2 wOrg = vec2(0.0);
#endif
  float wPh = uWindTime * 1.6 + dot(wOrg, vec2(0.37, 0.23));
  float wTop = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
  transformed.x += (sin(wPh) * 0.04 + sin(wPh * 2.7 + position.x * 3.0) * 0.02) * wTop;
  transformed.z += (cos(wPh * 1.3) * 0.03 + sin(wPh * 3.1 + position.z * 3.0) * 0.015) * wTop;
`;

/** Adds the sway to a material (keeps its own lighting / alpha test). */
export function withWind<M extends Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = `uniform float uWindTime;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      WIND_GLSL,
    )}`;
  };
  m.customProgramCacheKey = () => 'dz-tree-wind';
  return m;
}
