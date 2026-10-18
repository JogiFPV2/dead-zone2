import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { PbrTextures } from './pbr-material.js';

export type PbrMapKind = 'albedo' | 'normal' | 'orm';

/** Anything with `loadAsync(url)` returning a texture (KTX2Loader; a stub in tests). */
export interface TextureSource {
  loadAsync(url: string): Promise<Texture>;
}

/** Sampling setup of one array (repeat, trilinear, anisotropy; albedo sRGB, others linear). */
export function setupArrayTexture(t: Texture, kind: PbrMapKind, anisotropy: number): Texture {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  t.colorSpace = kind === 'albedo' ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Resolved files of one quality: the three arrays + layers.json (relative to the base URL). */
export interface PbrTextureFiles {
  readonly albedo: string;
  readonly normal: string;
  readonly orm: string;
  readonly layers: string;
}

/** Shape of a manifest asset's `pbr` (Modules' schema; see assets/manifest.ts). */
export interface PbrMapsLike {
  albedo: string;
  normal: string;
  orm: string;
  layers: string;
  lowRes?: { albedo: string; normal: string; orm: string };
}

/**
 * Texture files for a preset from the manifest's `pbr` data (Designer, built by
 * `assets build`): the `lowRes` 512 set on low when present, otherwise the main set.
 */
export function pbrTextureFiles(size: 512 | 1024, maps: PbrMapsLike): PbrTextureFiles {
  const set = size === 512 && maps.lowRes ? maps.lowRes : maps;
  return { albedo: set.albedo, normal: set.normal, orm: set.orm, layers: maps.layers };
}

/**
 * The three 13-layer arrays at `size` (512 on low, 1024 otherwise). KTX2Loader returns a
 * `CompressedArrayTexture` for array KTX2 files; the shader samples them as `sampler2DArray`.
 */
export async function loadPbrTextures(
  loader: TextureSource,
  baseUrl: string,
  files: PbrTextureFiles,
  anisotropy: number,
): Promise<PbrTextures> {
  const url: Record<PbrMapKind, string> = {
    albedo: files.albedo,
    normal: files.normal,
    orm: files.orm,
  };
  const load = async (kind: PbrMapKind) =>
    setupArrayTexture(await loader.loadAsync(baseUrl + url[kind]), kind, anisotropy);
  const [alb, nrm, orm] = await Promise.all([load('albedo'), load('normal'), load('orm')]);
  return { alb, nrm, orm };
}
