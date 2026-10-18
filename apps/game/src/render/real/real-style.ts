import {
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Camera,
  type DirectionalLight,
  type MeshStandardMaterial,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { setPbrModelHook } from '../../assets/loader.js';
import { parseManifest } from '../../assets/manifest.js';
import type { TownKit } from '../../world/town/kit.js';
import { parseLayers, type PbrLayers } from './layers.js';
import { bakePbrScene, instancedModel, pbrModelSources, type PbrModelSource } from './models.js';
import type { RealQuality } from './options.js';
import {
  createPbrUniforms,
  makeModelMaterial,
  preparePbrGeometry,
  type PbrUniforms,
} from './pbr-material.js';
import { RealPipeline, applyShadowQuality } from './pipeline.js';
import { REAL_QUALITY, type RealQualityPreset } from './quality.js';
import { realTownKit } from './real-kit.js';
import { loadPbrTextures, pbrTextureFiles } from './textures.js';
import { DEMO_LAYOUT, type DemoPlacement } from './demo-layout.js';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The realistic style (`?style=real`): textures, the shared `deadzone-pbr` materials, Designer's
 * models and the frame pipeline. Built only when the flag is on; nothing here runs otherwise.
 */
export class RealStyle {
  readonly modelMaterial: MeshStandardMaterial;
  private pipeline: RealPipeline | undefined;
  private light: DirectionalLight | undefined;

  private constructor(
    private readonly renderer: WebGLRenderer,
    readonly quality: RealQuality,
    readonly preset: RealQualityPreset,
    readonly layers: PbrLayers,
    readonly uniforms: PbrUniforms,
    readonly sources: readonly PbrModelSource[],
    /** Model id → baked geometry (`pbrUv` / `pbrL` / colour, metres). */
    readonly models: ReadonlyMap<string, BufferGeometry>,
  ) {
    this.modelMaterial = makeModelMaterial(uniforms);
  }

  static async load(
    renderer: WebGLRenderer,
    ktx2: KTX2Loader,
    quality: RealQuality,
    baseUrl: string,
  ): Promise<RealStyle> {
    const preset = REAL_QUALITY[quality];
    const aniso = Math.min(preset.anisotropy, renderer.capabilities.getMaxAnisotropy());
    // Everything comes from the built manifest (Designer's assets, Modules' `pbr` schema).
    const manifest = parseManifest(await fetchJson(`${baseUrl}models/manifest.json`));
    const maps = manifest.assets.find((a) => a.material === 'pbr' && a.pbr)?.pbr;
    if (!maps) throw new Error('deadzone-pbr: manifest bez danych pbr (styl real niedostępny)');
    const files = pbrTextureFiles(preset.textureSize, maps);
    const sources = pbrModelSources(manifest.assets);
    const [layersJson, tx] = await Promise.all([
      fetchJson(`${baseUrl}${files.layers}`),
      loadPbrTextures(ktx2, baseUrl, files, aniso),
    ]);
    const layers = parseLayers(layersJson);
    // Built models are meshopt-compressed (quantized, dequantize transform on the node,
    // which bakePbrScene keeps via matrixWorld).
    const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const models = new Map<string, BufferGeometry>();
    await Promise.all(
      sources.map(async (m) => {
        try {
          const g = await gltf.loadAsync(`${baseUrl}${m.url}`);
          models.set(m.id, bakePbrScene(g.scene, m.scale));
        } catch (err) {
          // Missing model: the current one stays (fallback), the style still works.
          console.warn(`deadzone-pbr: ${m.url} nie wczytany`, err);
        }
      }),
    );
    const style = new RealStyle(
      renderer,
      quality,
      preset,
      layers,
      createPbrUniforms(tx, layers, preset),
      sources,
      models,
    );
    // Manifest models with `material: 'pbr'` load through AssetLoader with the shared material.
    setPbrModelHook({ material: style.modelMaterial, prepare: preparePbrGeometry });
    return style;
  }

  /** The town kit in the real style (same geometry Map shape; input untouched). */
  townKit(kit: TownKit): TownKit {
    return realTownKit(kit, this.uniforms, this.models);
  }

  /** Builds the frame pipeline once the scene, camera and sun / moon light exist. */
  attach(scene: Scene, camera: Camera, light: DirectionalLight, dpr: number): void {
    this.light = light;
    applyShadowQuality(light, this.preset);
    this.pipeline = new RealPipeline(this.renderer, scene, camera, this.preset, dpr);
  }

  /** Per frame after the day cycle wrote the light: keep the preset's shadow softness. */
  afterLighting(): void {
    if (this.light) this.light.shadow.radius = this.preset.shadow.radius;
  }

  /** Floating origin (world = render + origin) for world-locked texture UVs. */
  setOrigin(x: number, z: number): void {
    this.uniforms.uOrigin.value.set(x, 0, z);
  }

  setSize(width: number, height: number): void {
    this.pipeline?.setSize(width, height);
  }

  render(): void {
    this.pipeline?.render();
  }

  budget(): ReturnType<RealPipeline['budget']> | undefined {
    return this.pipeline?.budget();
  }

  /**
   * Dev `?pbrdemo=x,z`: Designer's models laid out like the pilot scene around a world point,
   * one InstancedMesh per file (shared material: one draw call per file).
   */
  demo(x: number, z: number, layout: readonly DemoPlacement[] = DEMO_LAYOUT): Object3D {
    const root = new Group();
    root.name = 'pbr-demo';
    const byId = new Map<string, Matrix4[]>();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (const p of layout) {
      const m = new Matrix4().compose(
        new Vector3(x + p.x, 0, z + p.z),
        q.setFromAxisAngle(up, p.rotY ?? 0).clone(),
        new Vector3().setScalar(p.scale ?? 1),
      );
      byId.set(p.id, [...(byId.get(p.id) ?? []), m]);
    }
    for (const [id, list] of byId) {
      const g = this.models.get(id);
      if (g) root.add(instancedModel(g, this.modelMaterial, list, id));
    }
    return root;
  }
}
