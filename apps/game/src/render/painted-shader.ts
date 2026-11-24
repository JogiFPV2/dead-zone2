/**
 * „Malowany” (painted) graphics style: one fullscreen pass over the full-resolution scene
 * (already tone mapped + sRGB, see GraphicsStylePass.ensureTarget):
 * - Kuwahara filter (4 quadrants, mean of the least varied one): flat colour patches with kept
 *   edges, the look of brush strokes; tap stride grows with the screen height and shrinks as
 *   the camera zooms in, where part of the sharp image is mixed back (`uDetail`) so textures
 *   and model detail read up close;
 * - grade: cool blue-violet shadows, warm light, a touch more saturation;
 * - thin warm-brown ink lines on depth breaks (silhouettes, wall / ground contours);
 * - canvas grain (screen-locked value noise).
 * Characters also get the inverted-hull outlines of the outline style (style-materials.ts); the
 * player (`tMask`, CHARACTER_LAYER) skips the brush filter, so it stays sharp at any zoom.
 */
export const PAINTED_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform float uDepthRange;
uniform float uStride;
uniform float uLine;
uniform float uEdgeMeters;
uniform vec3 uShadowTint;
uniform vec3 uLightTint;
uniform vec3 uInk;
uniform float uGrain;
uniform float uDetail;
uniform float uLift;
uniform float uSat;
varying vec2 vUv;

float dzH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float dzNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dzH(i), dzH(i + vec2(1.0, 0.0)), f.x), mix(dzH(i + vec2(0.0, 1.0)), dzH(i + vec2(1.0, 1.0)), f.x), f.y);
}

const int R = 3;

vec3 kuwahara(vec2 uv) {
  vec2 px = uTexel * uStride;
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
  for (int j = 0; j <= R; j++) {
    for (int i = 0; i <= R; i++) {
      vec3 c;
      c = texture2D(tColor, uv + vec2(-i, -j) * px).rgb; m0 += c; s0 += c * c;
      c = texture2D(tColor, uv + vec2( i, -j) * px).rgb; m1 += c; s1 += c * c;
      c = texture2D(tColor, uv + vec2(-i,  j) * px).rgb; m2 += c; s2 += c * c;
      c = texture2D(tColor, uv + vec2( i,  j) * px).rgb; m3 += c; s3 += c * c;
    }
  }
  float n = float((R + 1) * (R + 1));
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  vec3 v0 = abs(s0 / n - m0 * m0), v1 = abs(s1 / n - m1 * m1);
  vec3 v2 = abs(s2 / n - m2 * m2), v3 = abs(s3 / n - m3 * m3);
  float a0 = v0.r + v0.g + v0.b, a1 = v1.r + v1.g + v1.b;
  float a2 = v2.r + v2.g + v2.b, a3 = v3.r + v3.g + v3.b;
  vec3 best = m0; float bv = a0;
  if (a1 < bv) { bv = a1; best = m1; }
  if (a2 < bv) { bv = a2; best = m2; }
  if (a3 < bv) { best = m3; }
  return best;
}

float depthM(vec2 uv) { return texture2D(tDepth, uv).r * uDepthRange; }

float edge(vec2 uv) {
  vec2 o = uTexel * uLine;
  float d = depthM(uv);
  float e = max(max(abs(d - depthM(uv + vec2(o.x, 0.0))), abs(d - depthM(uv - vec2(o.x, 0.0)))),
                max(abs(d - depthM(uv + vec2(0.0, o.y))), abs(d - depthM(uv - vec2(0.0, o.y)))));
  // Sky / far plane has no contour.
  if (d > uDepthRange * 0.999) return 0.0;
  return smoothstep(uEdgeMeters, uEdgeMeters * 2.5, e);
}

void main() {
  // Zoomed in: part of the sharp image comes back (textures, model detail), the brush stays.
  vec3 sharp = texture2D(tColor, vUv).rgb;
  vec3 c = mix(kuwahara(vUv), sharp, uDetail);
  // The player stays sharp at any zoom (mask of its visible pixels, slightly widened).
  vec2 mo = uTexel * 1.5;
  float m = max(texture2D(tMask, vUv).r, max(
    max(texture2D(tMask, vUv + vec2(mo.x, 0.0)).r, texture2D(tMask, vUv - vec2(mo.x, 0.0)).r),
    max(texture2D(tMask, vUv + vec2(0.0, mo.y)).r, texture2D(tMask, vUv - vec2(0.0, mo.y)).r)));
  c = mix(c, sharp, m);
  // The game's palette is tuned dark: lift mid-tones before the grade (display gamma).
  c = pow(max(c, vec3(0.0)), vec3(uLift));
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Grade (display values): shadows lean cool, light leans warm, a little more saturation.
  c = mix(c, c * uShadowTint, (1.0 - smoothstep(0.08, 0.5, L)) * 0.55);
  c = mix(c, c * uLightTint, smoothstep(0.45, 0.9, L) * 0.5);
  c = max(vec3(0.0), mix(vec3(L), c, uSat));
  vec2 fc = gl_FragCoord.xy;
  float canvas = (dzNoise(fc * 0.9) - 0.5) + (dzNoise(vec2(fc.x * 0.25, fc.y * 1.6)) - 0.5) * 0.8;
  c *= 1.0 + canvas * uGrain;
  c = mix(c, c * uInk, edge(vUv) * 0.75);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
