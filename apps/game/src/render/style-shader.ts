/**
 * 32-colour dusk palette of the pixel style (designer's `styles-src/pixel.py`): hue-shifted
 * ramps (cool violet shadows -> warm amber light) plus the HUD / accent tokens. Three entries
 * (two near-black greens and a duplicate black) are swapped for neutral light greys: the game's
 * concrete, asphalt and shirts are neutral, and without them they snapped to skin tones.
 */
export const PIXEL_PALETTE = [
  0x0e0c14, 0x1a1724, 0x262536, 0x353548, 0x48495c, 0x5e6170, 0x4a3a5a, 0x3a1e1e, 0x5a2c26,
  0x7e3d2f, 0xa35a3e, 0xc98552, 0x6e5c4c, 0x927a60, 0xb89a72, 0xdcc08e, 0xf4e2b0, 0x7a7d8a,
  0xa2a5ae, 0x4a6040, 0x6e8452, 0x9aa866, 0xffd27a, 0xe0a23a, 0xc8453c, 0x6e1e22, 0x4fa8c8,
  0x2c5470, 0xc08a62, 0x8a5a44, 0xe4e6e3, 0xc8cacf,
] as const;

/** Fullscreen triangle. */
export const STYLE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Pixel style pass over the low-res scene (already tone mapped + sRGB): designer grade, depth
 * breaks shaded one step down, Bayer 4x4 dither, nearest colour of the palette in OKLab. The
 * nearest upscale is the sampling itself (NearestFilter, one low-res texel per art pixel).
 */
export const STYLE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uDepthRange;
uniform float uEdgeThreshold;
uniform float uShade;
uniform float uDither;
uniform vec3 uPal[32];
uniform vec3 uPalLab[32];
varying vec2 vUv;

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x + q.y * 4.0);
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return m[i] / 16.0 - 0.47;
}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 oklab(vec3 srgb) {
  vec3 l = toLinear(srgb);
  vec3 lms = vec3(
    dot(l, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(l, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(l, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return vec3(
    dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
    dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}

void main() {
  vec2 cell = floor(vUv / uTexel);
  vec2 uv = (cell + 0.5) * uTexel;
  vec3 c = texture2D(tColor, uv).rgb;

  // Grade: a bit more saturation, lift, shadows hue-shifted toward violet.
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 g = clamp(vec3(y) + (c - y) * 1.1, 0.0, 1.0);
  g = clamp(g * 1.18 + 0.025, 0.0, 1.0);
  y = dot(g, vec3(0.299, 0.587, 0.114));
  float sh = clamp(1.0 - y / 0.35, 0.0, 1.0);
  g = g * (1.0 - 0.35 * sh) + 0.35 * sh * (vec3(0.21, 0.19, 0.30) * (0.4 + y));

  // Selective outline of the set: a texel behind a nearer neighbour (depth break) darkens one
  // step, so the shade lands outside the nearer object and never speckles small characters.
  float d = texture2D(tDepth, uv).x;
  float dn = min(
    min(texture2D(tDepth, uv - vec2(uTexel.x, 0.0)).x, texture2D(tDepth, uv + vec2(uTexel.x, 0.0)).x),
    min(texture2D(tDepth, uv - vec2(0.0, uTexel.y)).x, texture2D(tDepth, uv + vec2(0.0, uTexel.y)).x));
  if ((d - dn) * uDepthRange > uEdgeThreshold) g *= uShade;

  g = clamp(g + bayer4(cell) * uDither, 0.0, 1.0);
  vec3 lab = oklab(g);
  vec3 best = uPal[0];
  float bd = 1e9;
  for (int i = 0; i < 32; i++) {
    vec3 e = lab - uPalLab[i];
    float k = dot(e, e);
    if (k < bd) { bd = k; best = uPal[i]; }
  }
  gl_FragColor = vec4(best, 1.0);
}
`;
