import {
  BufferGeometry,
  DepthTexture,
  Float32BufferAttribute,
  LinearFilter,
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
import {
  applyStyleMaterials,
  installStyleShaders,
  setHullSize,
  STYLE_UNIFORM,
} from './style-materials.js';
import { PAINTED_FRAGMENT } from './painted-shader.js';
import { setPaintedGround } from './painted-ground.js';
import { setPaintedBuildings } from './painted-buildings.js';
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

/** Styles drawn through the low-res pixel pass. */
export type PixelStyle = 'pixel' | 'pixel-fine';
export const isPixelStyle = (s: GraphicsStyle): s is PixelStyle =>
  s === 'pixel' || s === 'pixel-fine';

/** Screen height (px) the art-pixel size is measured at (the target has a fixed row count). */
export const PIXEL_REF_HEIGHT = 720;
/**
 * Art-pixel size per pixel style, in px at PIXEL_REF_HEIGHT: the one knob to tune each style.
 * `pixel` 3 px = 240 rows (427 × 240 at 16:9), `pixel-fine` („Pikselowy ostry”) 2 px = 360 rows
 * (640 × 360). Palette, dither and outlines are shared.
 */
export const PIXEL_SIZE_PX: Record<PixelStyle, number> = { pixel: 3, 'pixel-fine': 2 };

/** Art-pixel rows of the low-res target of a pixel style. */
export const pixelRows = (style: PixelStyle): number =>
  Math.round(PIXEL_REF_HEIGHT / PIXEL_SIZE_PX[style]);

/** Low-res target size for a drawing buffer (rows capped at the buffer height, never upsampled). */
export function pixelTargetSize(
  style: PixelStyle,
  width: number,
  height: number,
): { w: number; h: number } {
  const h = Math.max(1, Math.min(pixelRows(style), height));
  const w = Math.max(1, Math.round((h * width) / Math.max(height, 1)));
  return { w, h };
}

/** Tuning of the styles. */
export const STYLE_TUNING = {
  /**
   * Outline: hull width (px at 720 px of height), ramp band (log2 of the irradiance) and its
   * soft border (x fwidth, ~2-3 px).
   */
  outline: { hullPx: 2, toonStep: 1, toonSoft: 1.25 },
  /**
   * Pixel styles (size in PIXEL_SIZE_PX): dither amplitude, depth break (world units) shaded one
   * palette step down, character lift (extra emissive share).
   */
  pixel: { dither: 0.035, edge: 0.6, shade: 0.62, lift: 0.35 },
  /**
   * „Malowany”: softer ramp (half-stop bands, wide border), Kuwahara tap stride (px at 720 px
   * of height, 4x4 taps per quadrant), ink line offset (px at 720) and depth break (world units),
   * grade tints (multiplied into shadows / light), ink colour, canvas grain amplitude.
   */
  painted: {
    toonStep: 0.5,
    toonSoft: 3,
    stridePx: 1.4,
    linePx: 1,
    edge: 0.35,
    shadowTint: [0.78, 0.84, 1.1],
    lightTint: [1.08, 1.02, 0.9],
    ink: [0.36, 0.25, 0.2],
    grain: 0.045,
    /** Mid-tone lift (display gamma exponent, < 1 = brighter) and saturation of the grade. */
    lift: 0.78,
    saturation: 1.3,
    /** Camera zoom range (DEFAULT_ZOOM_LIMITS) → stride × (far … near) and sharp share at max. */
    zoom: { min: 0.6, max: 1.6, strideFar: 1.25, strideNear: 0.6, detail: 0.6 },
  },
} as const;

/** „Malowany” at camera `zoom`: Kuwahara stride factor and the share of the sharp image. */
export function paintedZoom(zoom: number): { stride: number; detail: number } {
  const z = STYLE_TUNING.painted.zoom;
  const t = Math.min(1, Math.max(0, (zoom - z.min) / (z.max - z.min)));
  const near = t * t * (3 - 2 * t);
  return {
    stride: z.strideFar + (z.strideNear - z.strideFar) * near,
    detail: z.detail * near,
  };
}

/** `?style=malowany` (or `painted`): the painted look for this session, without saving it. */
export function urlGraphicsStyle(search: string): GraphicsStyle | undefined {
  const v = new URLSearchParams(search).get('style');
  return v === 'malowany' || v === 'painted' ? 'painted' : undefined;
}

/**
 * „Styl grafiki” on the same scene and assets:
 * - classic: plain `renderer.render`;
 * - outline: still a plain render, with the 3-band lighting ramp switched on in the lit
 *   materials and inverted-hull ink outlines on characters (see style-materials.ts);
 * - pixel / pixel-fine: same ramp, scene into a 240- / 360-row target (PIXEL_SIZE_PX 3 / 2,
 *   nearest), one fullscreen pass with grade,
 *   Bayer 4x4 dither and the 32-colour palette (OKLab nearest), 1-px hull outlines and a lift
 *   on characters; the camera is snapped to the art-pixel grid (view plane) so static
 *   geometry does not shimmer while it follows the player. The HUD (DOM) is untouched.
 * - painted („Malowany”): softer ramp, hull outlines, scene into a full-res target, then one
 *   fullscreen pass (painted-shader.ts): Kuwahara brush patches, cool shadows / warm light,
 *   brown ink on depth breaks, canvas grain.
 * The low-res target is tone mapped and sRGB encoded like the canvas (see ensureTarget).
 */
export class GraphicsStylePass {
  private style: GraphicsStyle = 'classic';
  private target: WebGLRenderTarget | undefined;
  private targetKey = '';
  private readonly quad: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly paintedQuad: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly paintedScene = new Scene();
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
    const P = STYLE_TUNING.painted;
    const painted = new ShaderMaterial({
      vertexShader: STYLE_VERTEX,
      fragmentShader: PAINTED_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new Vector2() },
        uDepthRange: { value: 1 },
        uStride: { value: 1 },
        uLine: { value: 1 },
        uEdgeMeters: { value: P.edge },
        uShadowTint: { value: new Vector3(...P.shadowTint) },
        uLightTint: { value: new Vector3(...P.lightTint) },
        uInk: { value: new Vector3(...P.ink) },
        uGrain: { value: P.grain },
        uDetail: { value: 0 },
        uLift: { value: P.lift },
        uSat: { value: P.saturation },
      },
    });
    this.paintedQuad = new Mesh(g, painted);
    this.paintedQuad.frustumCulled = false;
    this.paintedScene.add(this.paintedQuad);
  }

  get current(): GraphicsStyle {
    return this.style;
  }

  setStyle(style: GraphicsStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.targetKey = '';
    const pixel = isPixelStyle(style);
    const painted = style === 'painted';
    STYLE_UNIFORM.value.step = painted
      ? STYLE_TUNING.painted.toonStep
      : STYLE_TUNING.outline.toonStep;
    STYLE_UNIFORM.value.soft = painted
      ? STYLE_TUNING.painted.toonSoft
      : STYLE_TUNING.outline.toonSoft;
    setPaintedGround(painted);
    setPaintedBuildings(painted);
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
    const style = this.style;
    if (style === 'painted') {
      this.renderPainted(scene, camera);
      return;
    }
    if (!isPixelStyle(style)) {
      setHullSize((STYLE_TUNING.outline.hullPx * this.size.y) / 720, this.size.x, this.size.y);
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    // The camera snap below uses the same rows, so it follows each style's grid.
    const { w, h } = pixelTargetSize(style, this.size.x, this.size.y);
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
    this.paintedQuad.material.dispose();
  }

  /** „Malowany”: full-res scene into the target, then the painted pass to the screen. */
  private renderPainted(scene: Object3D, camera: Camera): void {
    const r = this.renderer;
    const { x: w, y: h } = this.size;
    const k = h / 720;
    setHullSize(STYLE_TUNING.outline.hullPx * 0.75 * k, w, h);
    const t = this.ensureTarget(w, h, true);
    r.setRenderTarget(t);
    r.render(scene, camera);
    r.setRenderTarget(null);
    const ortho = (camera as OrthographicCamera).isOrthographicCamera
      ? (camera as OrthographicCamera)
      : undefined;
    const u = this.paintedQuad.material.uniforms;
    u.tColor!.value = t.texture;
    u.tDepth!.value = t.depthTexture;
    (u.uTexel!.value as Vector2).set(1 / w, 1 / h);
    u.uDepthRange!.value = ortho ? ortho.far - ortho.near : 1;
    const zp = paintedZoom(ortho?.zoom ?? 1);
    u.uStride!.value = Math.max(0.75, STYLE_TUNING.painted.stridePx * k * zp.stride);
    u.uDetail!.value = zp.detail;
    u.uLine!.value = Math.max(1, STYLE_TUNING.painted.linePx * k);
    const auto = r.info.autoReset;
    r.info.autoReset = false;
    r.render(this.paintedScene, this.quadCamera);
    r.info.autoReset = auto;
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

  private ensureTarget(w: number, h: number, smooth = false): WebGLRenderTarget {
    const key = `${w}x${h}${smooth ? 's' : ''}`;
    if (this.target && key === this.targetKey) return this.target;
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    const depth = new DepthTexture(w, h, UnsignedIntType);
    depth.minFilter = depth.magFilter = NearestFilter;
    this.target = new WebGLRenderTarget(w, h, {
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      minFilter: smooth ? LinearFilter : NearestFilter,
      magFilter: smooth ? LinearFilter : NearestFilter,
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
