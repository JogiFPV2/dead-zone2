import { ShaderChunk, ShaderLib } from 'three';

/**
 * Snow lying on everything that faces up (ground, roofs, car roofs, tree crowns), from the sim's
 * `WeatherView.snow` (0..1, grows while it snows and melts later). Global, so every material and
 * every chunk streamed in later is covered without touching their code:
 * - the shader chunks of the lit materials (standard / physical, lambert, phong) mix the diffuse
 *   colour towards snow on up-facing surfaces before lighting;
 * - the amount is one uniform `dzSnow` (vec2: x = cover) whose value is a typed array shared by
 *   reference: `UniformsUtils.clone` copies typed arrays by reference, so every material's copy
 *   of the built-in uniforms points at the same numbers.
 * Skinned meshes (characters) are left out.
 */
export const SNOW_VALUE = new Float32Array(2);

const SNOW_GLSL = /* glsl */ `
#ifndef USE_SKINNING
{
  vec3 dzUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float dzFace = smoothstep(0.55, 0.9, dot(normalize(normal), dzUp));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), dzSnow.x * dzFace * 0.92);
}
#endif
`;

let installed = false;

/** Installs the snow into three's shader chunks (once, before the first material compiles). */
export function installSnowCover(): void {
  if (installed) return;
  installed = true;
  ShaderChunk.lights_pars_begin = `uniform vec2 dzSnow;\n${ShaderChunk.lights_pars_begin}`;
  for (const k of [
    'lights_physical_fragment',
    'lights_lambert_fragment',
    'lights_phong_fragment',
  ] as const) {
    ShaderChunk[k] = `${SNOW_GLSL}\n${ShaderChunk[k]}`;
  }
  for (const k of ['standard', 'physical', 'lambert', 'phong'] as const) {
    ShaderLib[k].uniforms.dzSnow = { value: SNOW_VALUE };
  }
}

/** Per frame: snow amount from the weather view (eased so an update does not jump). */
export function setSnowCover(target: number, dtSec: number): void {
  const k = Math.min(1, dtSec / 4);
  let v = SNOW_VALUE[0]! + (target - SNOW_VALUE[0]!) * k;
  if (Math.abs(v - target) < 1e-3) v = target;
  SNOW_VALUE[0] = v;
}

export const snowCoverNow = (): number => SNOW_VALUE[0]!;
