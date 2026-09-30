import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  SRGBColorSpace,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { LIGHTING_CONFIG, fogRange, type LightingPreset } from './preset.js';
import { DEFAULT_SHADOW_FIT, fitShadowFrustum, type OrthoView } from './shadow-fit.js';

/** Renderer settings of the spec (4.1). PCFSoftShadowMap is gone in r186, so PCFShadowMap. */
export function configureRenderer(renderer: WebGLRenderer, preset: LightingPreset): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = preset.exposure;
  renderer.outputColorSpace = SRGBColorSpace;
}

/**
 * Global lights: hemisphere fill + a shadow-casting directional light (moon) whose shadow
 * frustum follows the camera view, plus fog and background. `apply` takes any preset, so a
 * day-night blend only has to call it with `blendPresets(...)` each frame.
 */
export class SceneLighting {
  readonly hemisphere = new HemisphereLight();
  readonly directional = new DirectionalLight();
  private readonly fog = new Fog('#000000');
  private readonly background = new Color();
  private readonly direction = new Vector3();
  private preset: LightingPreset;

  constructor(
    private readonly scene: Scene,
    preset: LightingPreset,
    private readonly cameraDistance: number,
  ) {
    const d = this.directional;
    d.name = 'moon';
    d.castShadow = true;
    d.shadow.mapSize.set(LIGHTING_CONFIG.shadowMapSize, LIGHTING_CONFIG.shadowMapSize);
    d.shadow.bias = LIGHTING_CONFIG.shadowBias;
    d.shadow.normalBias = LIGHTING_CONFIG.shadowNormalBias;
    this.hemisphere.name = 'hemisphere';
    scene.add(this.hemisphere, d, d.target);
    scene.fog = this.fog;
    scene.background = this.background;
    this.preset = preset;
    this.apply(preset);
  }

  apply(preset: LightingPreset, renderer?: WebGLRenderer): void {
    this.preset = preset;
    if (renderer) renderer.toneMappingExposure = preset.exposure;
    this.background.set(preset.background);
    const { near, far } = fogRange(preset.fog, this.cameraDistance);
    this.fog.color.set(preset.fog.color);
    this.fog.near = near;
    this.fog.far = far;
    const h = preset.hemisphere;
    this.hemisphere.color.set(h.sky);
    this.hemisphere.groundColor.set(h.ground);
    this.hemisphere.intensity = h.intensity;
    const d = preset.directional;
    this.directional.color.set(d.color);
    this.directional.intensity = d.intensity;
    this.directional.shadow.radius = d.shadowRadius;
    this.directional.shadow.intensity = d.shadowIntensity;
    this.direction.set(d.offset.x, d.offset.y, d.offset.z).normalize();
  }

  /** Per frame, after the camera moved: refit the shadow frustum to what is on screen. */
  update(view: OrthoView): void {
    const fit = fitShadowFrustum(view, this.direction, {
      ...DEFAULT_SHADOW_FIT,
      mapSize: LIGHTING_CONFIG.shadowMapSize,
    });
    const d = this.directional;
    d.position.copy(fit.position);
    d.target.position.copy(fit.target);
    d.target.updateMatrixWorld();
    const cam = d.shadow.camera;
    if (cam.right !== fit.halfSize || cam.near !== fit.near || cam.far !== fit.far) {
      Object.assign(cam, {
        left: -fit.halfSize,
        right: fit.halfSize,
        top: fit.halfSize,
        bottom: -fit.halfSize,
        near: fit.near,
        far: fit.far,
      });
      cam.updateProjectionMatrix();
    }
  }

  get current(): LightingPreset {
    return this.preset;
  }

  dispose(): void {
    this.directional.shadow.dispose();
    this.scene.remove(this.hemisphere, this.directional, this.directional.target);
    this.scene.fog = null;
  }
}
