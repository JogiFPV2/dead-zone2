import {
  BufferGeometry,
  DepthTexture,
  Float32BufferAttribute,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import type { GraphicsStyle } from '../settings/schema.js';
import { applyStyleMaterials, installStyleShaders, setHullSize } from './style-materials.js';
import { PIXEL_PALETTE, STYLE_FRAGMENT, STYLE_VERTEX } from './style-shader.js';

// The ramp lives in the shader chunks: installed before any program compiles.
installStyleShaders();

/** Raw sRGB of a hex colour (no linearisation: the pass works on display values). */
function srgbOf(hex: number): Vector3 {
  return new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** OKLab of an sRGB hex colour (palette matching in the pixel pass). */
function oklabOf(hex: number): Vector3 {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = lin(((hex >> 16) & 255) / 255);
  const g = lin(((hex >> 8) & 255) / 255);
  const b = lin((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return new Vector3(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}

/** Tuning of the styles. */
export const STYLE_TUNING = {
  /**
   * Outline: hull width (px at 720 px of height), ramp band (log2 of the irradiance) and its
   * soft border (x fwidth, ~2-3 px).
   */
  outline: { hullPx: 2, toonStep: 1, toonSoft: 1.25 },
  /**
   * Pixel: art-pixel rows of the target (427 x 240 at 16:9), dither amplitude, depth break
   * (world units) shaded one palette step down, character lift (extra emissive share).
   */
  pixel: { rows: 240, dither: 0.035, edge: 0.6, shade: 0.62, lift: 0.35 },
} as const;

/**
 * „Styl grafiki” on the same scene and assets:
 * - classic: plain `renderer.render`;
 * - outline: still a plain render, with the 3-band lighting ramp switched on in the lit
 *   materials and inverted-hull ink outlines on characters (see style-materials.ts);
 * - pixel: same ramp, scene into a 240-row target (nearest), one fullscreen pass with grade,
 *   Bayer 4x4 dither and the 32-colour palette (OKLab nearest), 1-px hull outlines and a lift
 *   on characters; the camera is snapped to the art-pixel grid (view plane) so static
 *   geometry does not shimmer while it follows the player. The HUD (DOM) is untouched.
 * The low-res target is tone mapped and sRGB encoded like the canvas (see ensureTarget).
 */
export class GraphicsStylePass {
  private style: GraphicsStyle = 'classic';
  private target: WebGLRenderTarget | undefined;
  private targetKey = '';
  private readonly quad: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly saved = new Vector3();

  constructor(private readonly renderer: WebGLRenderer) {
    installStyleShaders();
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new ShaderMaterial({
      vertexShader: STYLE_VERTEX,
      fragmentShader: STYLE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new Vector2() },
        uDepthRange: { value: 1 },
        uEdgeThreshold: { value: STYLE_TUNING.pixel.edge },
        uShade: { value: STYLE_TUNING.pixel.shade },
        uDither: { value: STYLE_TUNING.pixel.dither },
        uPal: { value: PIXEL_PALETTE.map((h) => srgbOf(h)) },
        uPalLab: { value: PIXEL_PALETTE.map((h) => oklabOf(h)) },
      },
    });
    this.quad = new Mesh(g, material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  get current(): GraphicsStyle {
    return this.style;
  }

  setStyle(style: GraphicsStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.targetKey = '';
    const pixel = style === 'pixel';
    applyStyleMaterials({
      toon: style !== 'classic',
      hulls: style !== 'classic',
      lift: pixel ? STYLE_TUNING.pixel.lift : 0,
    });
  }

  /** Renders `scene` from `camera` in the current style to the screen. */
  render(scene: Object3D, camera: Camera): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    if (this.style !== 'pixel') {
      setHullSize((STYLE_TUNING.outline.hullPx * this.size.y) / 720, this.size.x, this.size.y);
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    const h = Math.min(STYLE_TUNING.pixel.rows, this.size.y);
    const w = Math.max(1, Math.round((h * this.size.x) / Math.max(this.size.y, 1)));
    setHullSize(1, w, h);
    const t = this.ensureTarget(w, h);
    const ortho = (camera as OrthographicCamera).isOrthographicCamera
      ? (camera as OrthographicCamera)
      : undefined;
    if (ortho) this.snap(ortho, h);
    r.setRenderTarget(t);
    r.render(scene, camera);
    r.setRenderTarget(null);
    if (ortho) {
      ortho.position.copy(this.saved);
      ortho.updateMatrixWorld();
    }
    const u = this.quad.material.uniforms;
    u.tColor!.value = t.texture;
    u.tDepth!.value = t.depthTexture;
    (u.uTexel!.value as Vector2).set(1 / w, 1 / h);
    u.uDepthRange!.value = ortho ? ortho.far - ortho.near : 1;
    // Keep the scene's draw-call stats: the fullscreen pass adds to them instead of resetting.
    const auto = r.info.autoReset;
    r.info.autoReset = false;
    r.render(this.quadScene, this.quadCamera);
    r.info.autoReset = auto;
  }

  dispose(): void {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }

  /**
   * Moves the camera (in its view plane) onto the art-pixel grid: the scene then lands on the
   * same low-res pixels every frame and only steps by whole art pixels. Restored after render.
   */
  private snap(cam: OrthographicCamera, rows: number): void {
    this.saved.copy(cam.position);
    const texel = (cam.top - cam.bottom) / cam.zoom / rows;
    cam.updateMatrixWorld();
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(cam.matrixWorld, 1);
    const a = cam.position.dot(this.right);
    const b = cam.position.dot(this.up);
    const da = Math.round(a / texel) * texel - a;
    const db = Math.round(b / texel) * texel - b;
    cam.position.addScaledVector(this.right, da).addScaledVector(this.up, db);
    cam.updateMatrixWorld();
  }

  private ensureTarget(w: number, h: number): WebGLRenderTarget {
    const key = `${w}x${h}`;
    if (this.target && key === this.targetKey) return this.target;
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    const depth = new DepthTexture(w, h, UnsignedIntType);
    depth.minFilter = depth.magFilter = NearestFilter;
    this.target = new WebGLRenderTarget(w, h, {
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      depthTexture: depth,
    });
    // Rendered like the screen: three applies the renderer's tone mapping and output colour
    // space per material only for the canvas or an XR target. Flagging the target that way keeps
    // every material (incl. additive lamp glows, blended after tone mapping) identical to
    // `classic`; the bytes stay sRGB encoded and the pass reads them as they are.
    (this.target as WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.targetKey = key;
    return this.target;
  }
}
