import {
  DataTexture,
  MeshStandardMaterial,
  NearestFilter,
  RedFormat,
  Vector3,
  type BufferGeometry,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { KIT_LIFT, layerTables, type PbrLayers } from './layers.js';
import { patchPbrShader, type PbrVariant } from './pbr-shader.js';
import type { RealQualityPreset } from './quality.js';

export interface PbrTextures {
  readonly alb: Texture;
  readonly nrm: Texture;
  readonly orm: Texture;
}

/** Uniforms shared by reference by every `deadzone-pbr` program (one update reaches all). */
export interface PbrUniforms {
  readonly tAlb: IUniform<Texture>;
  readonly tNrm: IUniform<Texture>;
  readonly tOrm: IUniform<Texture>;
  readonly uNrmK: IUniform<number>;
  readonly uGrime: IUniform<number>;
  readonly uAO: IUniform<number>;
  /** Floating origin (world = render + origin): world-locked UVs across origin shifts. */
  readonly uOrigin: IUniform<Vector3>;
  readonly uTile: IUniform<Float32Array>;
  readonly uMean: IUniform<Float32Array>;
  /** 1 = `natural` layer (own colour), 0 = `tint`. */
  readonly uNat: IUniform<Float32Array>;
  /** Kit / terrain palette lift (`KIT_LIFT`: tint ×, natural ×, max albedo). */
  readonly uLift: IUniform<Vector3>;
}

export function createPbrUniforms(
  tx: PbrTextures,
  layers: PbrLayers,
  q: RealQualityPreset,
): PbrUniforms {
  const { tile, mean, natural } = layerTables(layers);
  return {
    tAlb: { value: tx.alb },
    tNrm: { value: tx.nrm },
    tOrm: { value: tx.orm },
    uNrmK: { value: q.normalScale },
    uGrime: { value: 1 },
    uAO: { value: q.textureAO },
    uOrigin: { value: new Vector3() },
    uTile: { value: tile },
    uMean: { value: mean },
    uNat: { value: natural },
    uLift: { value: new Vector3(KIT_LIFT.tint, KIT_LIFT.natural, KIT_LIFT.maxAlbedo) },
  };
}

function attach(
  m: MeshStandardMaterial,
  u: PbrUniforms,
  variant: PbrVariant,
  extra: Record<string, IUniform> = {},
): MeshStandardMaterial {
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, u, extra);
    patchPbrShader(sh, variant);
  };
  m.customProgramCacheKey = () => `deadzone-pbr-${variant}`;
  return m;
}

/** Designer's `*.pbr.glb` meshes: one shared material for every file (one draw call each). */
export function makeModelMaterial(u: PbrUniforms): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.name = 'deadzone-pbr';
  return attach(m, u, 'model');
}

/** Cell → layer lookup as a nearest-sampled R8 texture (palette grid, glTF UV orientation). */
export function lutTexture(lut: Uint8Array, grid: number): DataTexture {
  const t = new DataTexture(lut, grid, grid, RedFormat);
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * The town kit material in the real style: same palette / emissive maps (night windows), same
 * flags, plus the PBR layers. The kit geometry is untouched, so batches build exactly as before.
 */
export function makeKitMaterial(
  base: MeshStandardMaterial,
  u: PbrUniforms,
  lut: Texture,
): MeshStandardMaterial {
  const m = base.clone();
  m.name = 'deadzone-pbr/kit';
  m.roughness = 1;
  m.metalness = 0;
  return attach(m, u, 'kit', { tLut: { value: lut } });
}

/** Town terrain (vertex colours + `dmask`) in the real style. */
export function makeTerrainMaterial(u: PbrUniforms): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.name = 'deadzone-pbr/terrain';
  return attach(m, u, 'terrain');
}

/**
 * glTF `TEXCOORD_0` / `TEXCOORD_1` → `pbrUv` / `pbrL` (STYLE.md §1): otherwise three.js would
 * treat them as its own UV sets. Idempotent.
 */
export function preparePbrGeometry(g: BufferGeometry): BufferGeometry {
  const uv = g.getAttribute('uv');
  if (uv) {
    g.setAttribute('pbrUv', uv);
    g.deleteAttribute('uv');
  }
  const uv1 = g.getAttribute('uv1');
  if (uv1) {
    g.setAttribute('pbrL', uv1);
    g.deleteAttribute('uv1');
  }
  return g;
}
