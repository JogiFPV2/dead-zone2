import type { Material, WebGLProgramParametersWithUniforms } from 'three';

/**
 * Walls between the camera and the player fade (Designer spec 25.10): only walls within
 * FADE_RADIUS of the player on the camera side, crossing the player's silhouette corridor; down
 * to FADE_MIN (posts by doors / windows to FADE_POST), FADE_MS both ways, FADE_HYST hysteresis.
 * Opacity is per instance (BatchedMesh colour alpha / `instanceFade` attribute) and drawn as
 * screen-door dithering, so no sorting, no new draw calls and shadows (depth material) unchanged.
 */
export const FADE_MIN = 0.15;
export const FADE_POST = 0.5;
export const FADE_RADIUS = 3;
export const FADE_HYST = 0.5;
export const FADE_MS = 200;
/** Half width (m) of the player's silhouette corridor toward the camera. */
export const FADE_HALF_WIDTH = 0.8;

/** Player position (sim x / y), camera yaw and floor level. */
export interface FadeView {
  px: number;
  py: number;
  yaw: number;
  z: number;
}

/**
 * Whether the wall segment (x0, y0)–(x1, y1) occludes the player: some point of it lies on the
 * camera side (in front of the player toward the camera), within FADE_RADIUS and inside the
 * corridor. `was` (already fading) widens every bound by FADE_HYST. Pure (tests).
 */
export function occludesPlayer(
  v: FadeView,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  was = false,
): boolean {
  const h = was ? FADE_HYST : 0;
  const dx = Math.sin(v.yaw);
  const dy = Math.cos(v.yaw);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rx = x0 + (x1 - x0) * t - v.px;
    const ry = y0 + (y1 - y0) * t - v.py;
    const along = rx * dx + ry * dy;
    if (along <= 0.15 - h) continue;
    if (Math.abs(-rx * dy + ry * dx) > FADE_HALF_WIDTH + h) continue;
    if (Math.hypot(rx, ry) > FADE_RADIUS + h) continue;
    return true;
  }
  return false;
}

/** Next opacity: toward `target` at full range per FADE_MS. */
export function stepFade(cur: number, target: number, dtMs: number): number {
  const k = Math.max(0, dtMs) / FADE_MS;
  return cur < target ? Math.min(target, cur + k) : Math.max(target, cur - k);
}

const VERT_DECL =
  'varying float vDzFade;\n#ifdef DZ_FADE_ATTR\nattribute float instanceFade;\n#endif\n';
const VERT_BODY = `
#if defined( USE_BATCHING_COLOR )
  vDzFade = getBatchingColor( getIndirectIndex( gl_DrawID ) ).a;
#elif defined( DZ_FADE_ATTR )
  vDzFade = instanceFade;
#else
  vDzFade = 1.0;
#endif
`;
const FRAG_DECL = `varying float vDzFade;
float dzBayer( vec2 p ) {
  ivec2 q = ivec2( mod( p, 4.0 ) );
  int i = q.x + q.y * 4;
  int m[16] = int[16]( 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 );
  return ( float( m[i] ) + 0.5 ) / 16.0;
}
`;
const FRAG_BODY = '\nif ( vDzFade < 0.999 && dzBayer( gl_FragCoord.xy ) >= vDzFade ) discard;\n';

/** Patches a program for the per-instance fade (`onBeforeCompile`). */
export function patchFadeShader(sh: WebGLProgramParametersWithUniforms, attr: boolean): void {
  sh.vertexShader = (attr ? '#define DZ_FADE_ATTR\n' : '') + VERT_DECL + sh.vertexShader;
  sh.vertexShader = sh.vertexShader.replace(
    '#include <color_vertex>',
    `#include <color_vertex>\n${VERT_BODY}`,
  );
  sh.fragmentShader = FRAG_DECL + sh.fragmentShader;
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>${FRAG_BODY}`,
  );
}

type Hooks = Pick<Material, 'onBeforeCompile' | 'customProgramCacheKey'>;
const bases = new WeakMap<Material, Hooks>();

/** Program hooks of `m` without the fade (as before `withFade`). */
export function unfaded(m: Material): Hooks {
  return (
    bases.get(m) ?? {
      onBeforeCompile: m.onBeforeCompile.bind(m),
      customProgramCacheKey: m.customProgramCacheKey.bind(m),
    }
  );
}

/**
 * Adds the fade to `m` (keeps an existing onBeforeCompile / cache key). `attr`: the meshes carry
 * an `instanceFade` attribute (InstancedMesh); else the BatchedMesh colour alpha is read.
 */
export function withFade<M extends Material>(m: M, attr = false): M {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  bases.set(m, { onBeforeCompile: prev, customProgramCacheKey: prevKey });
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    patchFadeShader(sh, attr);
  };
  m.customProgramCacheKey = () => `${prevKey()}|dz-fade${attr ? '-attr' : ''}`;
  return m;
}
