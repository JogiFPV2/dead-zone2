import {
  BackSide,
  Color,
  MeshBasicMaterial,
  ShaderChunk,
  ShaderLib,
  SkinnedMesh,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * Material side of the graphics styles (no asset changes, nothing recompiles on a switch):
 * - a 3-band lighting ramp in every lit three.js material (`lights_fragment_end`), driven by
 *   one shared struct uniform (`dzStyle`, shared by reference through the ShaderLib clone);
 * - inverted-hull outlines for characters (back faces pushed out along the normal in screen
 *   pixels, flat ink colour), shown only by the styles that want them;
 * - a brightness lift for character materials (pixel art: sprites read brighter than the set).
 */

/** Shared by every lit material (UniformsUtils.clone copies plain objects by reference). */
export const STYLE_UNIFORM = { value: { toon: 0, step: 1, soft: 1.25 } };
/** Shared by every hull material: outline width (px) and the target size (px). */
export const HULL_UNIFORM = { value: { px: 2, resX: 1280, resY: 720 } };

/** Ink colours of the hulls: dark for characters, light for vehicles (dark asphalt). */
export const HULL_COLORS = { character: 0x120d0b, vehicle: 0x8a7d70 } as const;
export type HullKind = keyof typeof HULL_COLORS;

const RAMP = /* glsl */ `
#ifndef DZ_STYLE_NO_RAMP
if ( dzStyle.toon > 0.5 ) {
  // 3-band ramp on the diffuse irradiance (albedo divided out, palette and ACES untouched):
  // log2 steps rounded to the nearest band, the border softened over ~2-3 px (fwidth).
  vec3 dzAlb = max( diffuseColor.rgb, vec3( 0.02 ) );
  vec3 dzIrr = ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) / dzAlb;
  float dzI = max( dot( dzIrr, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 );
  float dzS = log2( dzI ) / dzStyle.step;
  float dzW = clamp( fwidth( dzS ) * dzStyle.soft, 0.02, 0.5 );
  float dzQ = floor( dzS ) + smoothstep( 0.5 - dzW, 0.5 + dzW, fract( dzS ) );
  float dzR = clamp( exp2( dzQ * dzStyle.step ) / dzI, 0.55, 1.6 );
  reflectedLight.directDiffuse *= dzR;
  reflectedLight.indirectDiffuse *= dzR;
}
#endif
`;

let installed = false;

/** Installs the ramp into the shader chunks (idempotent; before the first compile). */
export function installStyleShaders(): void {
  if (installed) return;
  installed = true;
  const chunks = ShaderChunk as unknown as Record<string, string>;
  chunks.lights_pars_begin =
    'struct DzStyle { float toon; float step; float soft; };\nuniform DzStyle dzStyle;\n' +
    chunks.lights_pars_begin;
  chunks.lights_fragment_end = chunks.lights_fragment_end + RAMP;
  for (const id of ['lambert', 'phong', 'standard', 'physical', 'toon'] as const) {
    const lib = (ShaderLib as Record<string, { uniforms: Record<string, unknown> } | undefined>)[
      id
    ];
    if (lib) lib.uniforms.dzStyle = STYLE_UNIFORM;
  }
}

const hulls = new Set<Object3D>();
let hullsOn = false;

/** Whether hull outlines are drawn (zombie views copy this into their per-frame visibility). */
export function hullsEnabled(): boolean {
  return hullsOn;
}

/** Character materials and their base self-light (lifted in the pixel style). */
const lifted = new Map<MeshStandardMaterial, number>();
let lift = 0;

/** Registers a character material for the pixel-style lift (base = current emissive share). */
export function registerCharacterMaterial(m: MeshStandardMaterial): void {
  if (lifted.has(m)) return;
  lifted.set(m, m.emissiveIntensity);
  m.emissiveIntensity += lift;
}

/** Applies the material side of a style: ramp on/off, hull visibility, character lift. */
export function applyStyleMaterials(opts: { toon: boolean; hulls: boolean; lift: number }): void {
  installStyleShaders();
  STYLE_UNIFORM.value.toon = opts.toon ? 1 : 0;
  hullsOn = opts.hulls;
  for (const h of hulls) h.visible = opts.hulls;
  lift = opts.lift;
  for (const [m, base] of lifted) m.emissiveIntensity = base + lift;
}

/** Hull outline width `px` for a target of `resX` x `resY` pixels. */
export function setHullSize(px: number, resX: number, resY: number): void {
  const v = HULL_UNIFORM.value;
  v.px = px;
  v.resX = resX;
  v.resY = resY;
}

const HULL_VERTEX = /* glsl */ `#include <project_vertex>
  {
    #ifdef USE_SKINNING
      vec3 dzN = objectNormal;
    #else
      vec3 dzN = normal;
    #endif
    #ifdef USE_INSTANCING
      dzN = mat3( instanceMatrix ) * dzN;
    #endif
    vec2 dzD = ( projectionMatrix * vec4( normalMatrix * dzN, 0.0 ) ).xy;
    float dzL = length( dzD );
    if ( dzL > 1e-6 ) {
      gl_Position.xy += dzD / dzL * dzHull.px * 2.0 / vec2( dzHull.resX, dzHull.resY ) * gl_Position.w;
    }
  }`;

/**
 * Adds the hull extrusion to `material` (keeps an existing onBeforeCompile, e.g. the baked
 * skinning of the instanced zombies, and extends its program cache key).
 */
export function withHullExtrusion<M extends Material>(material: M): M {
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev(shader, renderer);
    shader.uniforms.dzHull = HULL_UNIFORM;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'struct DzHull { float px; float resX; float resY; };\nuniform DzHull dzHull;\nvoid main() {',
      )
      .replace('#include <project_vertex>', HULL_VERTEX);
  };
  material.customProgramCacheKey = () => `${prevKey()}|dz-hull`;
  return material;
}

/** Flat ink back-face material of a hull (no lights, fog or tone mapping). */
export function hullMaterial(kind: HullKind = 'character'): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: new Color(HULL_COLORS[kind]), side: BackSide });
  m.toneMapped = false;
  m.fog = false;
  return m;
}

/** Tracks `hull` (visibility follows the style). */
export function registerHull(hull: Object3D): void {
  hull.visible = hullsOn;
  hulls.add(hull);
  hull.addEventListener('removed', () => hulls.delete(hull));
}

/**
 * Inverted-hull outlines for every skinned mesh of `object` (player / menu zombies): a sibling
 * skinned mesh on the same geometry and skeleton with the hull material. One material per
 * object (draw call per skinned part).
 */
export function addHulls(object: Object3D, kind: HullKind = 'character'): void {
  installStyleShaders();
  const material = withHullExtrusion(hullMaterial(kind));
  const found: SkinnedMesh[] = [];
  object.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh && !o.userData.dzHull) found.push(o as SkinnedMesh);
  });
  for (const m of found) {
    const hull = new SkinnedMesh(m.geometry, material);
    hull.userData.dzHull = true;
    hull.name = `${m.name}-hull`;
    hull.position.copy(m.position);
    hull.quaternion.copy(m.quaternion);
    hull.scale.copy(m.scale);
    hull.bindMode = m.bindMode;
    hull.bind(m.skeleton, m.bindMatrix);
    hull.castShadow = hull.receiveShadow = false;
    hull.frustumCulled = m.frustumCulled;
    m.parent?.add(hull);
    registerHull(hull);
  }
}
