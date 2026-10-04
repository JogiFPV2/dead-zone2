/**
 * Noise circle in world space (HUD v2 spec „Okrąg hałasu”): one flat quad on the ground whose
 * shader draws the faint fill, a dark underlay and the stroke. The stroke width is measured in
 * screen pixels with `fwidth` of the distance from the centre, so it stays 1.5 / 2 px whatever
 * the zoom, and the ring is an exact ellipse under the iso camera. No depth test: walls do not
 * hide it (drawn after the world, under the DOM HUD).
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, type Object3D } from 'three';
import { LEVEL_HEIGHT } from '../../world/instances.js';
import { NOISE_LOOK, NOISE_UNDERLAY, type NoiseSample } from './noise-model.js';

/** Height over the floor (m). */
const LIFT_M = 0.03;
/** Quad margin around the circle (fraction of the radius) for the stroke / underlay. */
const MARGIN = 0.12;

const VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// vP is in units of the radius (the quad is scaled by the radius, 1 = on the circle).
const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStroke;
uniform float uFill;
uniform float uWidth;
uniform float uUnder;
uniform float uUnderWidth;
uniform float uAlpha;
uniform float uPx;
varying vec2 vP;
void main() {
  float d = length(vP);
  float fw = max(fwidth(d), 1e-6);
  float dpx = abs(d - 1.0) / fw;
  float line = clamp(uWidth * uPx * 0.5 - dpx + 0.5, 0.0, 1.0);
  float under = clamp(uUnderWidth * uPx * 0.5 - dpx + 0.5, 0.0, 1.0);
  float inside = clamp((1.0 - d) / fw + 0.5, 0.0, 1.0);
  // Fill, then the dark underlay, then the stroke (premultiplied "over", output straight).
  vec3 col = uColor * uFill * inside;
  float a = uFill * inside;
  float ua = uUnder * under;
  col = col * (1.0 - ua);
  a = ua + a * (1.0 - ua);
  float sa = uStroke * line;
  col = uColor * sa + col * (1.0 - sa);
  a = sa + a * (1.0 - sa);
  if (a * uAlpha < 0.002) discard;
  gl_FragColor = vec4(col / a, a * uAlpha);
  #include <colorspace_fragment>
}`;

export class NoiseRingView {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly color = new Color();

  constructor(parent: Object3D) {
    const geo = new PlaneGeometry(2 * (1 + MARGIN), 2 * (1 + MARGIN));
    const mat = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new Color() },
        uStroke: { value: 0 },
        uFill: { value: 0 },
        uWidth: { value: 1.5 },
        uUnder: { value: NOISE_UNDERLAY.alpha },
        uUnderWidth: { value: NOISE_UNDERLAY.widthPx },
        uAlpha: { value: 0 },
        uPx: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(geo, mat);
    // Plane in xy laid on the ground, facing up (the circle is symmetric, so y → −z is fine).
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 900;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'noise-ring';
    parent.add(this.mesh);
  }

  /** Drawing-buffer pixels per CSS pixel (devicePixelRatio, or the pixel-style target scale). */
  setPixelScale(px: number): void {
    this.mesh.material.uniforms.uPx!.value = px;
  }

  update(s: NoiseSample | undefined): void {
    const m = this.mesh;
    if (!s || s.alpha <= 0.001 || s.radiusM <= 0) {
      m.visible = false;
      return;
    }
    const look = NOISE_LOOK[s.tier];
    const u = m.material.uniforms;
    (u.uColor!.value as Color).copy(this.color.setHex(look.color)).convertSRGBToLinear();
    u.uStroke!.value = look.stroke;
    u.uFill!.value = look.fill;
    u.uWidth!.value = look.widthPx;
    u.uAlpha!.value = s.alpha;
    m.position.set(s.x, s.z * LEVEL_HEIGHT + LIFT_M, s.y);
    m.scale.set(s.radiusM, s.radiusM, 1);
    m.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
