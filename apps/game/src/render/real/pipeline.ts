import {
  DepthTexture,
  HalfFloatType,
  PMREMGenerator,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type DirectionalLight,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { checkDrawBudget, type DrawBudget, type RealQualityPreset } from './quality.js';

/** GTAO at a fraction of the composer resolution (medium: ½); the blend stays full size. */
class ScaledGtaoPass extends GTAOPass {
  constructor(
    scene: Scene,
    camera: Camera,
    private readonly scale: number,
  ) {
    super(scene, camera, 512, 512);
  }

  override setSize(width: number, height: number): void {
    super.setSize(
      Math.max(1, Math.round(width * this.scale)),
      Math.max(1, Math.round(height * this.scale)),
    );
  }

  override render(...args: Parameters<GTAOPass['render']>): void {
    // Without an external depth the AO G-buffer pass is a second scene render: keep it from
    // redrawing the shadow maps.
    const r = args[0];
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    super.render(...args);
    r.shadowMap.autoUpdate = auto;
  }
}

/** Shadow setup of the sun / moon light for a preset (PCF, STYLE.md §5). */
export function applyShadowQuality(light: DirectionalLight, q: RealQualityPreset): void {
  const s = light.shadow;
  if (s.mapSize.x !== q.shadow.mapSize) {
    s.mapSize.set(q.shadow.mapSize, q.shadow.mapSize);
    s.map?.dispose();
    s.map = null;
  }
  s.radius = q.shadow.radius;
  s.bias = q.shadow.bias;
  s.normalBias = q.shadow.normalBias;
}

/**
 * Frame renderer of the realistic style: plain `renderer.render` on low (no post), otherwise
 * RenderPass → GTAO → OutputPass (tone mapping + sRGB) in an MSAA half-float target. Counts the
 * draw calls of the whole frame (shadow passes and post included) for the budget check.
 */
export class RealPipeline {
  private composer: EffectComposer | undefined;
  private ao: ScaledGtaoPass | undefined;
  private env: Texture | undefined;
  private readonly size = new Vector2();
  private lastCalls = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly q: RealQualityPreset,
    devicePixelRatio: number,
  ) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatioMax));
    if (q.envIntensity > 0) {
      const pm = new PMREMGenerator(renderer);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      scene.environment = this.env;
      scene.environmentIntensity = q.envIntensity;
    }
    if (q.ssao.mode === 'gtao') {
      renderer.getSize(this.size);
      const target = new WebGLRenderTarget(
        Math.max(1, this.size.x * renderer.getPixelRatio()),
        Math.max(1, this.size.y * renderer.getPixelRatio()),
        { type: HalfFloatType, samples: q.msaa },
      );
      // The RenderPass depth feeds GTAO (normals rebuilt from depth): no second scene render for
      // the AO G-buffer, which was about a third of the frame's draw calls on medium.
      target.depthTexture = new DepthTexture(target.width, target.height);
      const c = new EffectComposer(renderer, target);
      c.addPass(new RenderPass(scene, camera));
      const ao = new ScaledGtaoPass(scene, camera, q.ssao.resolutionScale);
      ao.setGBuffer(target.depthTexture);
      ao.updateGtaoMaterial({ samples: q.ssao.samples, radius: 0.6, distanceFallOff: 1 });
      ao.blendIntensity = 1;
      c.addPass(ao);
      this.ao = ao;
      c.addPass(new OutputPass());
      this.composer = c;
    }
  }

  get preset(): RealQualityPreset {
    return this.q;
  }

  setSize(width: number, height: number): void {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(width, height);
  }

  render(): void {
    const r = this.renderer;
    const auto = r.info.autoReset;
    r.info.autoReset = false;
    r.info.reset();
    const c = this.composer;
    if (c) {
      // The RenderPass draws into the read buffer: GTAO must sample that buffer's depth.
      const depth = c.readBuffer.depthTexture;
      if (this.ao && depth && this.ao.depthTexture !== depth) this.ao.setGBuffer(depth);
      c.render();
    } else {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
    }
    this.lastCalls = r.info.render.calls;
    r.info.autoReset = auto;
  }

  /** Draw calls of the last frame against the preset budget. */
  budget(): DrawBudget {
    return checkDrawBudget(this.lastCalls, this.q);
  }

  dispose(): void {
    this.composer?.dispose();
    this.env?.dispose();
  }
}
