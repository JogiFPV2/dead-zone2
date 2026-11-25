import {
  AdditiveBlending,
  BackSide,
  Color,
  LessEqualDepth,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  type Object3D,
} from 'three';

/**
 * Highlight of the piece of furniture the F key acts on (Paweł 25.11: the cupboard / shelf /
 * fridge / oven that will be searched lights up): a warm outline (inverted hull, pushed out
 * along the normals in view space, so a fitted / scaled model keeps an even line) plus a soft
 * additive tint over the model. Both pulse gently. The view is a clone of the fitted model with
 * its geometry shared; only the two materials below are owned here (one set for the game).
 */

/** Warm light, close to the door glow. */
export const HIGHLIGHT_COLOR = 0xffd98a;
/** Outline width (m, view space). */
export const OUTLINE_WIDTH_M = 0.055;
/** Peak opacity of the outline and of the additive tint. */
const OUTLINE_ALPHA = 1;
const TINT_ALPHA = 0.32;
/** Pulse period (s). */
const PULSE_SEC = 1.6;

const outline = new ShaderMaterial({
  uniforms: {
    uColor: { value: new Color(HIGHLIGHT_COLOR) },
    uAlpha: { value: OUTLINE_ALPHA },
    uWidth: { value: OUTLINE_WIDTH_M },
  },
  vertexShader: /* glsl */ `
    uniform float uWidth;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      mv.xyz += normalize(normalMatrix * normal) * uWidth;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uAlpha;
    void main() { gl_FragColor = vec4(uColor, uAlpha); }
  `,
  side: BackSide,
  transparent: true,
  depthWrite: false,
});
outline.name = 'furniture-highlight-outline';

const tint = new MeshBasicMaterial({
  color: HIGHLIGHT_COLOR,
  transparent: true,
  opacity: TINT_ALPHA,
  blending: AdditiveBlending,
  depthWrite: false,
  depthFunc: LessEqualDepth,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -2,
});
tint.name = 'furniture-highlight-tint';

/**
 * Turns `model` (a fresh clone, geometry shared with the instances) into the highlight: each
 * mesh draws the tint over the furniture and gets a sibling outline shell. Returns `model`.
 */
export function makeHighlight(model: Object3D): Object3D {
  const meshes: Mesh[] = [];
  model.traverse((n) => {
    if (n instanceof Mesh) meshes.push(n as Mesh);
  });
  for (const m of meshes) {
    m.material = tint;
    m.castShadow = false;
    m.receiveShadow = false;
    m.renderOrder = 2;
    const shell = new Mesh(m.geometry, outline);
    shell.renderOrder = 1;
    shell.raycast = () => {};
    m.raycast = () => {};
    m.add(shell);
  }
  model.name = 'furniture-highlight';
  return model;
}

/** Pulse of both materials at time `nowMs` (one call per frame). */
export function pulseHighlight(nowMs: number): void {
  const k = 0.7 + 0.3 * Math.sin((nowMs / 1000) * ((2 * Math.PI) / PULSE_SEC));
  outline.uniforms.uAlpha!.value = OUTLINE_ALPHA * k;
  tint.opacity = TINT_ALPHA * k;
}
