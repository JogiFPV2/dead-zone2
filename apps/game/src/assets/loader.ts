import {
  DoubleSide,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import type { AnimationClip, Object3D, Texture, WebGLRenderer } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GpuBudget } from './budget.js';
import { RefCache } from './cache.js';
import { estimateObjectGeometry, estimateTexture } from './estimate.js';
import { buildLod } from './lod.js';
import { assetUrl, findAsset, parseManifest, type AssetManifest } from './manifest.js';
import { MaterialRegistry } from './materials.js';

export interface AssetLoaderOptions {
  renderer: WebGLRenderer;
  /** Directory holding manifest.json (served from apps/game/public). */
  baseUrl?: string;
  /** Basis transcoder (copied from three by the Vite plugin in vite.config.ts). */
  transcoderPath?: string;
  budget?: GpuBudget;
  /** See buildLod. */
  lodDistanceBias?: number;
  /**
   * Shared KTX2Loader (three.js warns about several active ones; menu, creator and game share
   * one via `models/model-kit.ts`). Not disposed by this loader when given.
   */
  ktx2?: KTX2Loader;
}

/**
 * Runtime loader for pipeline output: GLTFLoader + MeshoptDecoder + KTX2Loader, cache by URL,
 * shared palette materials, THREE.LOD, GPU budget accounting and explicit unload.
 */
export class AssetLoader {
  readonly budget: GpuBudget;
  readonly materials = new MaterialRegistry();
  private readonly baseUrl: string;
  private readonly gltf = new GLTFLoader();
  private readonly ktx2: KTX2Loader;
  private readonly ownsKtx2: boolean;
  private readonly scenes: RefCache<GLTF>;
  private readonly textures = new Map<string, Texture>();
  private readonly palettes = new Map<string, Promise<void>>();
  private manifest?: AssetManifest;

  constructor(private readonly opts: AssetLoaderOptions) {
    this.baseUrl = opts.baseUrl ?? `${import.meta.env.BASE_URL}models/`;
    this.budget = opts.budget ?? new GpuBudget();
    this.ownsKtx2 = !opts.ktx2;
    this.ktx2 =
      opts.ktx2 ??
      new KTX2Loader()
        .setTranscoderPath(opts.transcoderPath ?? `${import.meta.env.BASE_URL}basis/`)
        .detectSupport(opts.renderer);
    this.gltf.setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(this.ktx2);
    this.scenes = new RefCache<GLTF>((g, url) => {
      // Geometry is owned by the cached glTF; shared materials by the registry.
      g.scene.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
      this.budget.remove(url);
    });
  }

  async loadManifest(): Promise<AssetManifest> {
    const res = await fetch(assetUrl(this.baseUrl, 'manifest.json'));
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    this.manifest = parseManifest(await res.json());
    return this.manifest;
  }

  /** One instance of `id` (THREE.LOD when there are several levels). Pair with `release(id)`. */
  async load(id: string): Promise<Object3D> {
    const asset = findAsset(this.requireManifest(), id);
    await this.ensurePalette(asset.pack);
    const levels = await Promise.all(
      asset.lods.map(async (l) => ({
        object: (await this.acquire(l.file)).scene.clone(),
        distance: l.distance,
      })),
    );
    const root =
      levels.length === 1 ? levels[0]!.object : buildLod(levels, this.opts.lodDistanceBias);
    root.name = id;
    return root;
  }

  /**
   * Animated model (skinned, single level): a skeleton-aware clone and the clips. Pair with
   * `release(id)`.
   */
  async loadAnimated(id: string): Promise<{ object: Object3D; clips: AnimationClip[] }> {
    const asset = findAsset(this.requireManifest(), id);
    const lod = asset.lods[0]!;
    const g = await this.acquire(lod.file);
    return { object: cloneSkinned(g.scene), clips: g.animations };
  }

  /** One LOD level only (dev page / tools). Pair with `releaseFile(file)`. */
  async loadLevel(id: string, level: number): Promise<Object3D> {
    const asset = findAsset(this.requireManifest(), id);
    const lod = asset.lods[Math.min(level, asset.lods.length - 1)]!;
    await this.ensurePalette(asset.pack);
    return (await this.acquire(lod.file)).scene.clone();
  }

  release(id: string): void {
    for (const l of findAsset(this.requireManifest(), id).lods) this.releaseFile(l.file);
  }

  releaseFile(file: string): void {
    this.scenes.release(assetUrl(this.baseUrl, file));
  }

  /** Unloads everything: cached geometry, palette textures, shared materials. */
  dispose(): void {
    this.scenes.clear();
    for (const [url, t] of this.textures) {
      t.dispose();
      this.budget.remove(url);
    }
    this.textures.clear();
    this.palettes.clear();
    this.materials.dispose();
    if (this.ownsKtx2) this.ktx2.dispose();
  }

  private requireManifest(): AssetManifest {
    if (!this.manifest) throw new Error('AssetLoader: najpierw loadManifest()');
    return this.manifest;
  }

  private acquire(file: string): Promise<GLTF> {
    const url = assetUrl(this.baseUrl, file);
    return this.scenes.acquire(url, async () => {
      const g = await this.gltf.loadAsync(url);
      this.materials.bind(g.scene);
      this.budget.set(url, estimateObjectGeometry(g.scene));
      return g;
    });
  }

  /** Palette packs: one KTX2 texture + one material for the whole pack, loaded once. */
  private ensurePalette(packId: string): Promise<void> {
    const pal = this.requireManifest().packs.find((p) => p.id === packId)?.palette;
    if (!pal) return Promise.resolve();
    const url = assetUrl(this.baseUrl, pal.file);
    let p = this.palettes.get(url);
    if (!p) {
      p = this.loadPalette(url, pal.material);
      this.palettes.set(url, p);
      p.catch(() => this.palettes.delete(url));
    }
    return p;
  }

  private async loadPalette(url: string, material: string): Promise<void> {
    const map = url.endsWith('.ktx2')
      ? await this.ktx2.loadAsync(url)
      : await new TextureLoader().loadAsync(url);
    map.colorSpace = SRGBColorSpace;
    map.magFilter = NearestFilter;
    map.flipY = false; // glTF UV convention
    this.textures.set(url, map);
    this.budget.set(url, estimateTexture(map));
    this.materials.register(
      material,
      new MeshStandardMaterial({ map, roughness: 1, metalness: 0, side: DoubleSide }),
    );
  }
}
