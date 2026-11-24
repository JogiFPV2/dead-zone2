import type {
  Material,
  MeshStandardMaterial,
  Object3D,
  WebGLProgramParametersWithUniforms,
} from 'three';
import {
  BLD_LAYERS,
  PAINTED_BLD,
  PAINTED_BLD_PARS,
  PAINTED_BLD_VERT,
  PAINTED_BLD_VERT_PARS,
} from './painted-buildings.js';

/**
 * Furniture in the „Malowany” style (Paweł 24.11: the whole game painted): the vertex-coloured
 * furniture models keep their shape and colours and get a painted surface from the buildings'
 * texture array (`painted-buildings.ts`): wood grain on brown parts, fabric weave on coloured
 * ones, enamel / terrazzo speckle on light ones and sheet metal on grey ones, as a brightness
 * pattern around each part's own colour (the colour never changes), projected in world metres
 * along the dominant axis, plus darker brushed edges. Off (one uniform) in the other styles.
 */

/** Packs whose models are furniture / room props (asset file prefixes). */
export const FURNITURE_PACKS = ['deadzone-furniture/', 'kenney-furniture/', 'kenney-survival/'];

/** Texture repeats per metre on furniture (finer than on walls). */
const FURNITURE_SCALE = 2.5;
/** How strongly the pattern varies the brightness (0 = flat colour). */
const PATTERN = 0.5;
/** Edge darkening at silhouettes. */
const EDGE = 0.2;

const layer = (n: (typeof BLD_LAYERS)[number]) => BLD_LAYERS.indexOf(n).toFixed(1);

/** Fragment body (after `#include <normal_fragment_maps>`: `normal` is the view normal). */
export const PAINTED_FURNITURE_FRAG = /* glsl */ `
if (pbOn > 0.5) {
  vec3 pfC = diffuseColor.rgb;
  float pfMx = max(pfC.r, max(pfC.g, pfC.b));
  float pfMn = min(pfC.r, min(pfC.g, pfC.b));
  float pfSat = pfMx > 1e-4 ? (pfMx - pfMn) / pfMx : 0.0;
  float pfLum = dot(pfC, vec3(0.2126, 0.7152, 0.0722));
  float pfLayer =
    (pfC.r >= pfC.g && pfC.g >= pfC.b && pfSat > 0.25 && pfLum < 0.4) ? ${layer('deski')} :
    pfSat > 0.2 ? ${layer('wykladzina')} :
    pfLum > 0.35 ? ${layer('lastryko')} : ${layer('blacha')};
  vec3 pfN = abs(normalize(vPbN));
  vec3 pfW = (vPbW + pbOrigin) * ${FURNITURE_SCALE.toFixed(2)};
  vec2 pfUv = pfN.y > max(pfN.x, pfN.z) ? pfW.xz : (pfN.x > pfN.z ? pfW.zy : pfW.xy);
  float pfT = dot(texture(pbTex, vec3(pfUv, pfLayer)).rgb, vec3(0.3333));
  float pfAvg = dot(textureLod(pbTex, vec3(0.5, 0.5, pfLayer), 8.0).rgb, vec3(0.3333));
  float pfK = clamp(pfT / max(pfAvg, 0.04), 0.55, 1.45);
  diffuseColor.rgb = pfC * mix(1.0, pfK, ${PATTERN.toFixed(2)});
  float pfRim = 1.0 - abs(normal.z);
  diffuseColor.rgb *= 1.0 - ${EDGE.toFixed(2)} * smoothstep(0.55, 1.0, pfRim);
}
`;

/** Patches a furniture material once (chained after its own hooks, e.g. the x-ray / fade). */
export function withPaintedFurniture(m: Material): Material {
  const s = m as MeshStandardMaterial & { dzPaintedFurniture?: true };
  if (s.dzPaintedFurniture || !('isMeshStandardMaterial' in s)) return m;
  s.dzPaintedFurniture = true;
  const prev = s.onBeforeCompile.bind(s);
  const prevKey = s.customProgramCacheKey.bind(s);
  s.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev(sh, r);
    patchPaintedFurniture(sh);
  };
  s.customProgramCacheKey = () => `${prevKey()}|dz-painted-furn`;
  return m;
}

export function patchPaintedFurniture(sh: WebGLProgramParametersWithUniforms): void {
  Object.assign(sh.uniforms, PAINTED_BLD);
  if (!sh.vertexShader.includes('vPbW')) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${PAINTED_BLD_VERT_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${PAINTED_BLD_VERT}`);
  }
  if (sh.fragmentShader.includes('pfLayer')) return;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${PAINTED_BLD_VERT_PARS}${PAINTED_BLD_PARS}`)
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${PAINTED_FURNITURE_FRAG}`,
    );
}

/** Every mesh material of a loaded furniture model patched (idempotent). */
export function paintFurnitureModel(root: Object3D): void {
  root.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) withPaintedFurniture(x);
  });
}
