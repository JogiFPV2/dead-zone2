import type { MeshStandardMaterial, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { BLD_PALETTE, type BldType } from './bld-palette.js';
import { V2_CELLS, V2_ROOF_HEX, V2_WALL_HEX } from './bld-v2.js';

/**
 * bld v2 facade detail (look-spec.md B): one 2048² greyscale atlas of 4 × 4 ambientCG CC0
 * materials (`facade-detail.webp`, built by `tools/assets/scripts/facade-detail.py`), multiplied
 * into the palette colour in the **same** town material (no new materials, no new draw calls).
 * Which detail cell a palette cell gets lives in a second nearest-filtered map with the
 * palette's layout (R = (detail + 1) × 15, 0 = none), so only the v2 colour cells are textured.
 * Detail UVs are world-space (planar by the dominant normal axis), tiled per cell.
 */

/** Detail atlas cells (order = facade-detail.json). */
export const DETAIL_CELLS = [
  'plaster',
  'plaster-rough',
  'panel',
  'brick',
  'brick-dark',
  'corrugated',
  'sheet',
  'metal-plates',
  'planks',
  'concrete',
  'tiles-plain',
  'tiles-s',
  'sheet-tile',
  'felt',
  'shopfront',
  'grime',
] as const;
export type DetailCell = (typeof DETAIL_CELLS)[number];

const WALL: Record<BldType, DetailCell> = {
  block: 'panel',
  house: 'plaster',
  service: 'plaster-rough',
  industrial: 'corrugated',
  public: 'plaster',
  outbuilding: 'planks',
};
const ROOF: Record<BldType, DetailCell> = {
  block: 'felt',
  house: 'tiles-plain',
  service: 'felt',
  industrial: 'corrugated',
  public: 'sheet',
  outbuilding: 'felt',
};
/** Colour overrides (brick walls, graphite / brown house roofs). */
const BY_HEX: Readonly<Record<string, DetailCell>> = {
  '#9e5a45': 'brick',
  '#5a4434': 'tiles-s',
  '#3c3f42': 'sheet-tile',
  '#2f3132': 'sheet-tile',
};

const TYPES = Object.keys(BLD_PALETTE) as BldType[];
function detailOf(hex: string, roof: boolean): DetailCell {
  const o = BY_HEX[hex];
  if (o) return o;
  const t = TYPES.find((k) => (roof ? BLD_PALETTE[k].roofs : BLD_PALETTE[k].walls).includes(hex));
  return t ? (roof ? ROOF : WALL)[t] : 'plaster';
}

/** Detail cell of every v2 palette cell (by cell name). */
export const V2_DETAIL: ReadonlyMap<string, DetailCell> = new Map(
  V2_CELLS.map(([name]) => {
    const m = /^v2w(\d+)-/.exec(name);
    const hex = m ? V2_WALL_HEX[Number(m[1])] : V2_ROOF_HEX[Number(name.slice(3))];
    return [name, detailOf(hex ?? '', !m)];
  }),
);

/** Index-map code of a detail cell (R channel, 0 = no detail). */
export const detailCode = (d: DetailCell): number => (DETAIL_CELLS.indexOf(d) + 1) * 15;

/** Paints the index map (black = none) for the v2 sub-cells into a palette-sized canvas. */
export function paintDetailIndex(
  ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>,
  size: number,
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  const px = size / 16;
  const h = px / 2;
  for (const [name, , s] of V2_CELLS) {
    const c = detailCode(V2_DETAIL.get(name) ?? 'plaster');
    ctx.fillStyle = `rgb(${c},0,0)`;
    ctx.fillRect(
      (s.cell % 16) * px + (s.q % 2) * h,
      Math.floor(s.cell / 16) * px + (s.q >> 1) * h,
      h,
      h,
    );
  }
}

/** Detail strength (0 = flat colour, 1 = full luminance of the source material). */
export const DETAIL_STRENGTH = 0.75;

const VERT_DECL = 'varying vec3 vDzWp;\nvarying vec3 vDzWn;\n';
const VERT_MAIN = `
  {
    vec4 dzP = vec4( transformed, 1.0 );
    vec3 dzN = objectNormal;
    #ifdef USE_BATCHING
      dzP = batchingMatrix * dzP; dzN = mat3( batchingMatrix ) * dzN;
    #endif
    #ifdef USE_INSTANCING
      dzP = instanceMatrix * dzP; dzN = mat3( instanceMatrix ) * dzN;
    #endif
    vDzWp = ( modelMatrix * dzP ).xyz;
    vDzWn = mat3( modelMatrix ) * dzN;
  }
`;
const FRAG_DECL = `varying vec3 vDzWp;
varying vec3 vDzWn;
uniform sampler2D dzDetail;
uniform sampler2D dzDetailIdx;
uniform float dzDetailTile[16];
uniform float dzDetailStrength;
`;
const FRAG_MAIN = `
  {
    float dzCode = texture2D( dzDetailIdx, vMapUv ).r * 255.0;
    if ( dzCode > 7.0 ) {
      int dzI = int( floor( dzCode / 15.0 + 0.5 ) ) - 1;
      vec3 dzA = abs( vDzWn );
      vec2 dzT = dzA.y > max( dzA.x, dzA.z ) ? vDzWp.xz : ( dzA.x > dzA.z ? vDzWp.zy : vDzWp.xy );
      dzT /= dzDetailTile[ dzI ];
      vec2 dzCell = vec2( float( dzI - ( dzI / 4 ) * 4 ), float( dzI / 4 ) );
      vec2 dzUv = ( dzCell + 0.01 + fract( dzT ) * 0.98 ) * 0.25;
      float dzD = textureGrad( dzDetail, dzUv, dFdx( dzT ) * 0.245, dFdy( dzT ) * 0.245 ).r * 2.0;
      diffuseColor.rgb *= mix( 1.0, dzD, dzDetailStrength );
    }
  }
`;

/** Patches the town material with the detail (call before `withFade`; same material). */
export function withFacadeDetail(
  m: MeshStandardMaterial,
  detail: Texture,
  index: Texture,
  tileMeters: readonly number[],
): MeshStandardMaterial {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev(sh, r);
    patchDetailShader(sh, detail, index, tileMeters);
  };
  m.customProgramCacheKey = () => `${prevKey()}|dz-detail`;
  return m;
}

export function patchDetailShader(
  sh: WebGLProgramParametersWithUniforms,
  detail: Texture,
  index: Texture,
  tileMeters: readonly number[],
): void {
  sh.uniforms.dzDetail = { value: detail };
  sh.uniforms.dzDetailIdx = { value: index };
  sh.uniforms.dzDetailTile = {
    value: DETAIL_CELLS.map((_, i) => tileMeters[i] ?? 2),
  };
  sh.uniforms.dzDetailStrength = { value: DETAIL_STRENGTH };
  sh.vertexShader =
    VERT_DECL +
    sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>\n${VERT_MAIN}`,
    );
  sh.fragmentShader =
    FRAG_DECL +
    sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_MAIN}`);
}
