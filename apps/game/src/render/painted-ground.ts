import {
  CanvasTexture,
  Color,
  DataTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Painted ground of the „Malowany” style: hand-painted canvas textures (grass, asphalt, paving
 * slabs, earth, gravel) that the terrain material samples in world metres instead of the flat
 * palette colours. Built lazily the first time the style is switched on (canvas 2D, ~0.2 s), so the
 * other styles and the tests never paint anything.
 *
 * Layers follow the terrain `dmask` channels (R asphalt, G grass, B paving, A earth); a vertex
 * with both earth and asphalt or paving is gravel (gravel tracks, track ballast).
 */
export const PAINTED_GROUND_LAYERS = ['trawa', 'asfalt', 'plyty', 'ziemia', 'szuter'] as const;
export type PaintedGroundLayer = (typeof PAINTED_GROUND_LAYERS)[number];

/** Texture tile of each layer in metres (world tiles). */
export const PAINTED_GROUND_TILE: Readonly<Record<PaintedGroundLayer, number>> = {
  trawa: 7,
  asfalt: 4,
  plyty: 1,
  ziemia: 2.5,
  szuter: 2,
};

const SIZE = 512;

function placeholder(): Texture {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/**
 * Shared uniforms of every terrain material (same objects by reference): `on` switches the
 * painted ground, the textures are 1×1 placeholders until `enablePaintedGround()` paints them.
 */
export const PAINTED_GROUND = {
  on: { value: 0 },
  trawa: { value: placeholder() },
  asfalt: { value: placeholder() },
  plyty: { value: placeholder() },
  ziemia: { value: placeholder() },
  szuter: { value: placeholder() },
};

let painted = false;

/** Turns the painted ground on or off (paints the textures on the first call with `on`). */
export function setPaintedGround(on: boolean): void {
  PAINTED_GROUND.on.value = on ? 1 : 0;
  if (!on || painted || typeof document === 'undefined') return;
  painted = true;
  for (const name of PAINTED_GROUND_LAYERS) {
    const old = PAINTED_GROUND[name].value;
    PAINTED_GROUND[name].value = paintedTexture(name);
    old.dispose();
  }
}

/** Seeded LCG in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

const hex = (c: Color) => `#${c.getHexString()}`;

/** `base` with lightness × k (saturation follows a little) and a hue shift. */
function shade(base: number, k: number, hue = 0): Color {
  const c = new Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + hue + 1) % 1,
    Math.min(1, hsl.s * (1 + (k - 1) * 0.3)),
    Math.min(1, Math.max(0, hsl.l * k)),
  );
  return c;
}

const WRAP = [0, -SIZE, SIZE];

interface StrokeOpts {
  len?: number;
  width?: number;
  spread?: number;
  alpha?: number;
  angle?: number | null;
  hueJit?: number;
}

/** Brush strokes: short, thick, translucent lines in shades of the base (wrapped: tileable). */
function strokes(ctx: Ctx, s: number, base: number, n: number, r: Rand, o: StrokeOpts = {}): void {
  const { len = 0.06, width = 0.02, spread = 0.12, alpha = 0.18, angle = null, hueJit = 0.01 } = o;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * s;
    const y = r() * s;
    const a = angle === null ? r() * Math.PI : angle + (r() - 0.5) * 0.5;
    const l = s * len * (0.5 + r());
    ctx.strokeStyle = hex(shade(base, 1 + (r() - 0.5) * 2 * spread, (r() - 0.5) * hueJit));
    ctx.globalAlpha = alpha * (0.5 + r());
    ctx.lineWidth = s * width * (0.5 + r());
    for (const dx of WRAP)
      for (const dy of WRAP) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
        ctx.stroke();
      }
  }
  ctx.globalAlpha = 1;
}

/** Soft round patches of a lighter / darker base (wrapped). */
function blotches(
  ctx: Ctx,
  s: number,
  base: number,
  n: number,
  r: Rand,
  k = 0.1,
  rad = 0.12,
  alpha = 0.12,
): void {
  for (let i = 0; i < n; i++) {
    const x = r() * s;
    const y = r() * s;
    const rr = s * rad * (0.4 + r());
    const c = shade(base, 1 + (r() - 0.5) * 2 * k);
    const rgb = `${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0}`;
    for (const dx of WRAP)
      for (const dy of WRAP) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
        g.addColorStop(0, `rgba(${rgb},${alpha})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
      }
  }
}

function fill(ctx: Ctx, s: number, c: number): void {
  ctx.fillStyle = hex(new Color(c));
  ctx.fillRect(0, 0, s, s);
}

function dots(ctx: Ctx, s: number, n: number, r: Rand, style: (v: number) => string, px = 2): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = style(r());
    ctx.fillRect(r() * s, r() * s, px, px);
  }
}

/** Painted plant textures (crowns, needles, bark, hedges): `paintedTexture()`. */
export const PAINTED_PLANT_LAYERS = [
  'liscie',
  'liscie_jasne',
  'igly',
  'kora',
  'kora_sosny',
  'kora_brzozy',
  'zywoplot',
] as const;
export type PaintedPlantLayer = (typeof PAINTED_PLANT_LAYERS)[number];
export type PaintedLayer = PaintedGroundLayer | PaintedPlantLayer;

function leafDabs(
  ctx: Ctx,
  s: number,
  r: Rand,
  base: number,
  n: number,
  rx: number,
  ry: number,
  hue: number,
): void {
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = hex(shade(base, 0.65 + r() * 0.7, (r() - 0.5) * hue));
    ctx.beginPath();
    ctx.ellipse(
      r() * s,
      r() * s,
      rx * (0.6 + r()),
      ry * (0.6 + r()),
      r() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const PAINTERS: Record<PaintedLayer, (ctx: Ctx, s: number, r: Rand) => void> = {
  liscie(ctx, s, r) {
    fill(ctx, s, 0x3e6a2c);
    blotches(ctx, s, 0x3e6a2c, 30, r, 0.3, 0.15, 0.4);
    leafDabs(ctx, s, r, 0x4a7c30, 1600, 9, 4, 0.05);
  },
  liscie_jasne(ctx, s, r) {
    fill(ctx, s, 0x6a8a3a);
    blotches(ctx, s, 0x6a8a3a, 30, r, 0.3, 0.15, 0.4);
    leafDabs(ctx, s, r, 0x8aa848, 1600, 7, 4, 0.06);
  },
  igly(ctx, s, r) {
    fill(ctx, s, 0x2c4a32);
    blotches(ctx, s, 0x2c4a32, 30, r, 0.3, 0.15, 0.4);
    strokes(ctx, s, 0x3a5c3a, 2500, r, {
      alpha: 0.5,
      spread: 0.4,
      len: 0.02,
      width: 0.003,
      hueJit: 0.03,
    });
  },
  kora(ctx, s, r) {
    fill(ctx, s, 0x4e4034);
    strokes(ctx, s, 0x5a4a3c, 500, r, {
      alpha: 0.4,
      spread: 0.35,
      len: 0.12,
      width: 0.015,
      angle: Math.PI / 2,
    });
  },
  kora_sosny(ctx, s, r) {
    fill(ctx, s, 0x8a5a3a);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = hex(shade(0xa8683e, 0.7 + r() * 0.6));
      ctx.fillRect(r() * s, r() * s, 10 + r() * 30, 4 + r() * 8);
    }
    strokes(ctx, s, 0x5a3a2a, 300, r, {
      alpha: 0.35,
      spread: 0.3,
      len: 0.08,
      width: 0.006,
      angle: Math.PI / 2,
    });
  },
  kora_brzozy(ctx, s, r) {
    fill(ctx, s, 0xe6e2d6);
    strokes(ctx, s, 0xe6e2d6, 300, r, {
      alpha: 0.25,
      spread: 0.08,
      len: 0.1,
      width: 0.02,
      angle: 0,
    });
    ctx.fillStyle = 'rgba(30,28,26,0.85)';
    for (let i = 0; i < 40; i++) ctx.fillRect(r() * s, r() * s, 8 + r() * 40, 2 + r() * 5);
  },
  zywoplot(ctx, s, r) {
    fill(ctx, s, 0x2f5a26);
    blotches(ctx, s, 0x2f5a26, 40, r, 0.3, 0.1, 0.4);
    leafDabs(ctx, s, r, 0x3e6e2e, 2400, 3.5, 2, 0.04);
  },

  trawa(ctx, s, r) {
    fill(ctx, s, 0x627838);
    blotches(ctx, s, 0x627838, 60, r, 0.12, 0.1, 0.25);
    strokes(ctx, s, 0x627838, 3500, r, {
      alpha: 0.3,
      spread: 0.22,
      len: 0.012,
      width: 0.004,
      angle: -Math.PI / 2,
      hueJit: 0.04,
    });
    blotches(ctx, s, 0x8a7a48, 8, r, 0.08, 0.06, 0.2);
  },
  asfalt(ctx, s, r) {
    fill(ctx, s, 0x4c4c50);
    blotches(ctx, s, 0x4c4c50, 50, r, 0.1, 0.1, 0.2);
    strokes(ctx, s, 0x505056, 600, r, { alpha: 0.15, spread: 0.2, len: 0.05, width: 0.02 });
    dots(ctx, s, 4000, r, (v) => (v < 0.5 ? 'rgba(25,25,28,0.35)' : 'rgba(150,150,150,0.3)'));
    // Cracks.
    ctx.strokeStyle = 'rgba(20,20,22,0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      let x = r() * s;
      let y = r() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (r() - 0.5) * 40;
        y += (r() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  // Pavement: 50 × 50 cm slabs (2 × 2 per 1 m tile).
  plyty(ctx, s, r) {
    fill(ctx, s, 0x6e6a60);
    const n = 2;
    const w = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = shade(0xaaa294, 0.88 + r() * 0.2);
        ctx.fillStyle = hex(c);
        ctx.fillRect(x * w + 3, y * w + 3, w - 6, w - 6);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x * w + 3, y * w + 3, w - 6, w - 6);
        ctx.clip();
        blotches(ctx, s, c.getHex(), 6, r, 0.12, 0.08, 0.3);
        strokes(ctx, s, c.getHex(), 80, r, { alpha: 0.12, spread: 0.12, len: 0.04, width: 0.02 });
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,245,0.3)';
        ctx.fillRect(x * w + 3, y * w + 3, w - 6, 3);
      }
    dots(ctx, s, 900, r, () => 'rgba(60,55,45,0.25)');
  },
  // Trodden earth: brown, pebbles, footprints, a few grass blades.
  ziemia(ctx, s, r) {
    fill(ctx, s, 0x8a7254);
    blotches(ctx, s, 0x8a7254, 50, r, 0.18, 0.12, 0.35);
    strokes(ctx, s, 0x8a7254, 500, r, { alpha: 0.18, spread: 0.2, len: 0.05, width: 0.02 });
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = hex(shade(0x9a8a70, 0.7 + r() * 0.6));
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 2 + r() * 3, 1.5 + r() * 2, r() * 3, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(60,45,30,0.25)';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 6, 13, r() * 0.6 - 0.3, 0, 7);
      ctx.fill();
    }
    strokes(ctx, s, 0x627838, 120, r, {
      alpha: 0.35,
      spread: 0.2,
      len: 0.015,
      width: 0.004,
      angle: -Math.PI / 2,
    });
  },
  szuter(ctx, s, r) {
    fill(ctx, s, 0x9a9282);
    blotches(ctx, s, 0x9a9282, 40, r, 0.12, 0.12, 0.3);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = hex(shade(r() < 0.5 ? 0xb0a894 : 0x7c7668, 0.75 + r() * 0.5));
      const rr = 1.5 + r() * 3.5;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, rr, rr * (0.6 + r() * 0.4), r() * 3, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,240,0.25)';
      ctx.fillRect(r() * s, r() * s, 1.5, 1.5);
    }
  },
};

const cache = new Map<PaintedLayer, Texture>();

/** One painted texture, shared (painted once per session; needs a DOM). */
export function paintedTexture(name: PaintedLayer): Texture {
  let t = cache.get(name);
  if (!t) cache.set(name, (t = paintedGroundTexture(name)));
  return t;
}

/** One painted, tileable texture (sRGB, repeat, mipmapped). */
export function paintedGroundTexture(name: PaintedLayer, seed = 7): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  PAINTERS[name](ctx, SIZE, rng(seed + name.length * 31));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * GLSL (fragment, after `color_fragment`): the painted ground over the vertex colour. Needs
 * `vMask`, `vWXZ` and the uniforms `pgOn`, `pgRef[5]` (palette colour of each layer, linear),
 * `pgTrawa` … `pgSzuter`.
 */
export const PAINTED_GROUND_GLSL = /* glsl */ `
if (pgOn > 0.5) {
  float pgSum = vMask.x + vMask.y + vMask.z + vMask.w;
  if (pgSum > 0.001) {
    // Gravel: earth mixed with asphalt or paving in one vertex (gravel tracks, track ballast).
    float gr = (vMask.w > 0.01 && (vMask.x > 0.01 || vMask.z > 0.01)) ? 1.0 : 0.0;
    vec4 w = vec4(vMask.x, vMask.y, vMask.z, vMask.w) * vec4(1.0 - gr, 1.0, 1.0 - gr, 1.0 - gr);
    float ws = gr * (vMask.x + vMask.z + vMask.w);
    float tot = w.x + w.y + w.z + w.w + ws;
    w /= tot; ws /= tot;
    vec3 tex = vec3(0.0);
    vec3 ref = vec3(0.0);
    if (w.y > 0.0) { tex += w.y * pgSample(pgTrawa, vWXZ / ${PAINTED_GROUND_TILE.trawa.toFixed(1)}); ref += w.y * pgRef[0]; }
    if (w.x > 0.0) { tex += w.x * pgSample(pgAsfalt, vWXZ / ${PAINTED_GROUND_TILE.asfalt.toFixed(1)}); ref += w.x * pgRef[1]; }
    if (w.z > 0.0) { tex += w.z * texture2D(pgPlyty, vWXZ / ${PAINTED_GROUND_TILE.plyty.toFixed(1)}).rgb; ref += w.z * pgRef[2]; }
    if (w.w > 0.0) { tex += w.w * pgSample(pgZiemia, vWXZ / ${PAINTED_GROUND_TILE.ziemia.toFixed(1)}); ref += w.w * pgRef[3]; }
    if (ws > 0.0) { tex += ws * pgSample(pgSzuter, vWXZ / ${PAINTED_GROUND_TILE.szuter.toFixed(1)}); ref += ws * pgRef[4]; }
    // The palette variation (grass hues, worn verges, wheel ruts) carried over as a ratio.
    vec3 tint = clamp(vColor.rgb / max(ref, vec3(0.01)), vec3(0.55), vec3(1.6));
    diffuseColor.rgb = tex * tint;
  }
}
`;

/** GLSL (fragment, in `common`): uniforms and the anti-tiling sampler of the painted ground. */
export const PAINTED_GROUND_PARS = /* glsl */ `
uniform float pgOn;
uniform vec3 pgRef[5];
uniform sampler2D pgTrawa;
uniform sampler2D pgAsfalt;
uniform sampler2D pgPlyty;
uniform sampler2D pgZiemia;
uniform sampler2D pgSzuter;
// Two scales blended plus a slow brightness patch: no visible repeat of the painted tile.
vec3 pgSample(sampler2D t, vec2 uv) {
  vec3 a = texture2D(t, uv).rgb;
  vec3 b = texture2D(t, uv * 0.37 + vec2(0.31, 0.17)).rgb;
  vec3 c = texture2D(t, uv * 0.071 + vec2(0.7, 0.2)).rgb;
  float macro = dot(c, vec3(0.333)) / max(dot(a, vec3(0.333)), 0.05);
  return mix(a, b, 0.45) * mix(1.0, clamp(macro, 0.7, 1.3), 0.6);
}
`;
