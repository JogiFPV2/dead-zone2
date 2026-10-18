import type { WebGLProgramParametersWithUniforms } from 'three';
import { MAX_LAYERS } from './layers.js';

/**
 * `deadzone-pbr` shader patch (port of Designer's `dz-html/style/pbr/pbr-material.js`, three
 * r186, WebGL2): three 2D texture arrays (albedo sRGB, normal in Basis normal mode X = RGB,
 * Y = A, ORM = AO / roughness / metalness), TBN from screen derivatives (no tangents), grime,
 * macro variation and worn lawn patches from the `ziemia` layer. Three variants pick the UV,
 * layer and grime inputs:
 * - `model`: Designer's `*.pbr.glb` (`pbrUv` = UV in metres / tile, `pbrL` = layer + grime,
 *   `COLOR_0` = tint);
 * - `kit`: town kit modules (unchanged geometry, palette UVs): layer from a cell → layer lookup,
 *   world box projection in metres, palette colour as the tint (albedo / layer mean);
 * - `terrain`: town terrain (vertex colours + `dmask`): layer from the mask, world XZ.
 */
export type PbrVariant = 'model' | 'kit' | 'terrain';

const N = MAX_LAYERS;

const VERT_DECL: Record<PbrVariant, string> = {
  model: 'attribute vec2 pbrUv; attribute vec2 pbrL; varying vec2 vPUv; varying vec2 vPL;',
  kit: '',
  terrain: 'attribute vec4 dmask; varying vec4 vMask;',
};
const VERT_BODY: Record<PbrVariant, string> = {
  model: 'vPUv = pbrUv; vPL = pbrL;',
  kit: '',
  terrain: 'vMask = dmask;',
};
const FRAG_DECL: Record<PbrVariant, string> = {
  model: 'varying vec2 vPUv; varying vec2 vPL;',
  kit: 'uniform sampler2D tLut;',
  terrain: 'varying vec4 vMask;',
};

/** Sets pUv (repeats), pLay (layer), pDirt (0..1), pOn and pTint (albedo multiplier). */
const FRAG_INPUT: Record<PbrVariant, string> = {
  model: `pLay = floor(vPL.x + 0.5); pDirt = vPL.y; pUv = vPUv; pOn = true; pTint = vec3(1.0);`,
  kit: `{
  float l = floor(texture2D(tLut, vMapUv).r * 255.0 + 0.5);
  pOn = l < 250.0;
  pLay = pOn ? l : 0.0;
  vec3 wn = abs(normalize(cross(dFdx(pW), dFdy(pW))));
  vec2 m = wn.y > max(wn.x, wn.z) ? pW.xz : (wn.x > wn.z ? pW.zy : pW.xy);
  pUv = m / uTile[int(pLay)];
  pDirt = wn.y > 0.7 ? 0.25 : clamp(1.0 - pW.y / 1.6, 0.0, 1.0) * 0.8;
  if (pOn) { pTint = pPalette(diffuseColor.rgb); diffuseColor.rgb = pCol; }
}`,
  terrain: `{
  vec4 k = vMask;
  float s = k.x + k.y + k.z + k.w;
  pOn = s > 0.01;
  pLay = 0.0;
  float best = k.x;
  if (k.y > best) { best = k.y; pLay = 3.0; }
  if (k.z > best) { best = k.z; pLay = 1.0; }
  if (k.w > best) { best = k.w; pLay = 4.0; }
  pUv = pW.xz / uTile[int(pLay)];
  pDirt = pLay == 3.0 ? 0.25 : 0.2 + k.w * 0.4;
  if (pOn) { pTint = pPalette(diffuseColor.rgb); diffuseColor.rgb = pCol; }
}`,
};

const FRAG_COMMON_DECL = `
precision highp sampler2DArray;
uniform sampler2DArray tAlb; uniform sampler2DArray tNrm; uniform sampler2DArray tOrm;
uniform float uNrmK; uniform float uGrime; uniform float uAO; uniform vec3 uOrigin;
uniform float uTile[${N}]; uniform vec3 uMean[${N}]; uniform float uNat[${N}];
uniform vec3 uLift; /* kit / terrain palette → STYLE.md albedo: tint ×, natural ×, max albedo */
varying vec3 vPW;
vec3 pW; vec2 pUv; float pLay; float pDirt; bool pOn; vec3 pTint; vec3 pORM; float pGrime; vec4 pA;
/*
 * Palette colour (in diffuseColor) → STYLE.md tint rules. tint layers: the (dark, night-tuned)
 * palette colour lifted to the style's albedo range, texture normalised by its mean; natural
 * layers: the texture's own colour times a grey 0.55–1 (±15 % hue from the palette).
 */
vec3 pCol;
vec3 pPalette(vec3 col) {
  vec3 pal = max(col, vec3(1e-4));
  float lum = dot(pal, vec3(0.2126, 0.7152, 0.0722));
  // Bright marks on natural ground (road paint, zebras: linear > 0.2) keep their colour.
  if (uNat[int(pLay)] > 0.5 && lum < 0.2) {
    float g = clamp(lum * uLift.y, 0.55, 1.0);
    pCol = g * (1.0 + clamp(pal / lum - 1.0, -0.15, 0.15));
    return vec3(1.0);
  }
  pCol = min(pal * uLift.x, vec3(uLift.z));
  return 1.0 / uMean[int(pLay)];
}`;

const FRAG_MAP = (v: PbrVariant): string => `
pW = vPW + uOrigin;
${FRAG_INPUT[v]}
if (pOn) {
  pA = texture(tAlb, vec3(pUv, pLay));
  if (abs(pLay - 3.0) < 0.5 && pDirt > 0.01) { /* worn patches in lawns */
    float wm = texture(tAlb, vec3(pW.xz * 0.021 + 0.7, 4.0)).r * 1.9;
    pA.rgb = mix(pA.rgb, texture(tAlb, vec3(pUv * 0.8, 4.0)).rgb * 0.8 * (pTint.x == 1.0 ? vec3(1.0) : uMean[3] / uMean[4]),
      smoothstep(0.95, 1.25, wm) * min(1.0, pDirt * 2.2));
  }
  pORM = texture(tOrm, vec3(pUv, pLay)).rgb;
  float pN = texture(tAlb, vec3(pW.xz * 0.045 + pW.y * 0.06, 4.0)).r * 1.9; /* grime mask */
  pGrime = clamp(pDirt * pN * pN, 0.0, 1.0) * uGrime;
  float pM = texture(tAlb, vec3(pW.xz * 0.013 + 0.31, 4.0)).g * 1.9; /* macro variation */
  diffuseColor.rgb *= pA.rgb * pTint * mix(1.0, pORM.r, uAO) * mix(1.0, clamp(pM, 0.7, 1.3), 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.60, 0.56, 0.50), pGrime * 0.75);
}`;

const FRAG_ROUGH = `
if (pOn) roughnessFactor = clamp(pORM.g + pGrime * 0.15, 0.03, 1.0);`;
const FRAG_METAL = `
if (pOn) metalnessFactor = pORM.b;`;
const FRAG_NORMAL = `
if (pOn) {
  vec4 nt = texture(tNrm, vec3(pUv, pLay));
  vec2 nxy = (vec2(nt.r, nt.a) * 2.0 - 1.0) * uNrmK;
  vec3 tn = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  vec3 dp1 = dFdx(-vViewPosition), dp2 = dFdy(-vViewPosition);
  vec2 du1 = dFdx(pUv), du2 = dFdy(pUv);
  vec3 d2p = cross(dp2, normal), d1p = cross(normal, dp1);
  vec3 T = d2p * du1.x + d1p * du2.x; vec3 B = d2p * du1.y + d1p * du2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  normal = normalize(mat3(T * im, B * im, normal) * tn);
}`;

function replaceOnce(src: string, find: string, add: string, where: 'after' | 'before'): string {
  if (!src.includes(find)) throw new Error(`deadzone-pbr: brak ${find} w shaderze`);
  return src.replace(find, where === 'after' ? `${find}\n${add}` : `${add}\n${find}`);
}

/** Patches a MeshStandardMaterial program (call from `onBeforeCompile`). */
export function patchPbrShader(sh: WebGLProgramParametersWithUniforms, v: PbrVariant): void {
  sh.vertexShader = replaceOnce(
    sh.vertexShader,
    '#include <common>',
    `${VERT_DECL[v]}\nvarying vec3 vPW;`,
    'after',
  );
  sh.vertexShader = replaceOnce(
    sh.vertexShader,
    '#include <worldpos_vertex>',
    `${VERT_BODY[v]}\n{ vec4 pw = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  pw = batchingMatrix * pw;
#endif
#ifdef USE_INSTANCING
  pw = instanceMatrix * pw;
#endif
  vPW = (modelMatrix * pw).xyz; }`,
    'after',
  );
  let f = sh.fragmentShader;
  f = replaceOnce(f, '#include <common>', `${FRAG_COMMON_DECL}\n${FRAG_DECL[v]}`, 'after');
  // Terrain: its palette colour is the vertex colour, applied by color_fragment (after the map).
  const hook = v === 'terrain' ? '#include <color_fragment>' : '#include <map_fragment>';
  f = replaceOnce(f, hook, FRAG_MAP(v), 'after');
  f = replaceOnce(f, '#include <roughnessmap_fragment>', FRAG_ROUGH, 'after');
  f = replaceOnce(f, '#include <metalnessmap_fragment>', FRAG_METAL, 'after');
  f = replaceOnce(f, '#include <normal_fragment_maps>', FRAG_NORMAL, 'after');
  sh.fragmentShader = f;
}
