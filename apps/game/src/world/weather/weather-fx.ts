import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Scene,
} from 'three';
import type { WeatherView } from '@deadzone/protocol';

/**
 * Rain, snow and lightning on screen (protocol 50 `WeatherView`). Drops live in world space in a
 * box that follows the camera target (they wrap around it, so walking does not drag the rain
 * along). All motion is in the vertex shader: one draw call per kind, no per-frame uploads.
 * Lightning (storm) is a short double flash returned by `flash()` for the lights.
 */
export const WEATHER_FX = {
  /** Box around the camera target (m): x / z width, height. */
  box: new Vector3(80, 28, 80),
  rainDrops: 7000,
  snowFlakes: 5000,
  /** Fall speed (m/s) and streak length (m) of rain; snow falls slowly and sways. */
  rainFall: 18,
  rainLength: 0.9,
  snowFall: 1.4,
  snowSway: 0.6,
  /** Seconds between lightning strikes (random in this range) and length of one flash. */
  lightningEvery: [5, 16] as const,
  flashSec: 0.22,
} as const;

/** Precipitation strength 0..1 per kind from the weather view (blends with `from` / `blend`). */
export function precipitation(wx: WeatherView | undefined): { rain: number; snow: number } {
  if (!wx) return { rain: 0, snow: 0 };
  const of = (k: WeatherView['kind']) =>
    k === 'rain'
      ? { rain: 0.6, snow: 0 }
      : k === 'storm'
        ? { rain: 1, snow: 0 }
        : k === 'snow'
          ? { rain: 0, snow: 1 }
          : { rain: 0, snow: 0 };
  const a = of(wx.from);
  const b = of(wx.kind);
  return {
    rain: a.rain + (b.rain - a.rain) * wx.blend,
    snow: a.snow + (b.snow - a.snow) * wx.blend,
  };
}

const VERT_RAIN = /* glsl */ `
attribute vec3 seed;
attribute float tip;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uFall;
uniform vec2 uWind;
uniform float uLen;
varying float vTip;
void main() {
  float t = uTime + seed.y * 7.0;
  vec3 p;
  p.x = uCenter.x + mod(seed.x * uBox.x + uWind.x * t - uCenter.x, uBox.x) - uBox.x * 0.5;
  p.z = uCenter.z + mod(seed.z * uBox.z + uWind.y * t - uCenter.z, uBox.z) - uBox.z * 0.5;
  p.y = mod(seed.y * uBox.y - uTime * uFall, uBox.y);
  vec3 dir = normalize(vec3(uWind.x, -uFall, uWind.y));
  p -= dir * uLen * tip;
  vTip = tip;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG_RAIN = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vTip;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - vTip * 0.8));
}`;

const VERT_SNOW = /* glsl */ `
attribute vec3 seed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uFall;
uniform float uSway;
uniform float uSize;
void main() {
  float t = uTime + seed.y * 11.0;
  vec3 p;
  p.x = uCenter.x + mod(seed.x * uBox.x + sin(t * 0.9 + seed.z * 6.28) * uSway - uCenter.x, uBox.x) - uBox.x * 0.5;
  p.z = uCenter.z + mod(seed.z * uBox.z + cos(t * 0.7 + seed.x * 6.28) * uSway - uCenter.z, uBox.z) - uBox.z * 0.5;
  p.y = mod(seed.y * uBox.y - uTime * uFall, uBox.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.6 + 0.8 * fract(seed.x * 13.7));
}`;

const FRAG_SNOW = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c));
  gl_FragColor = vec4(uColor, uOpacity * a);
}`;

/** Deterministic seeds (the look does not need the sim's RNG; same every start). */
function seeds(n: number, perDrop: number): Float32Array {
  const out = new Float32Array(n * perDrop * 3);
  let s = 0x2545f491;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const x = rnd();
    const y = rnd();
    const z = rnd();
    for (let k = 0; k < perDrop; k++) out.set([x, y, z], (i * perDrop + k) * 3);
  }
  return out;
}

export class WeatherFx {
  private readonly rain: LineSegments<BufferGeometry, ShaderMaterial>;
  private readonly snow: Points<BufferGeometry, ShaderMaterial>;
  private readonly center = new Vector3();
  private nextStrike = 0;
  private strikeAt = -1;

  constructor(private readonly scene: Scene) {
    const o = WEATHER_FX;
    const rg = new BufferGeometry();
    rg.setAttribute('seed', new BufferAttribute(seeds(o.rainDrops, 2), 3));
    const tip = new Float32Array(o.rainDrops * 2);
    for (let i = 0; i < o.rainDrops; i++) tip[i * 2 + 1] = 1;
    rg.setAttribute('tip', new BufferAttribute(tip, 1));
    // `position` is unused (the shader places drops) but three needs it for the draw count.
    rg.setAttribute('position', new BufferAttribute(new Float32Array(o.rainDrops * 6), 3));
    this.rain = new LineSegments(
      rg,
      new ShaderMaterial({
        vertexShader: VERT_RAIN,
        fragmentShader: FRAG_RAIN,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: this.center },
          uBox: { value: o.box },
          uFall: { value: o.rainFall },
          uWind: { value: new Vector2(2.5, 1) },
          uLen: { value: o.rainLength },
          uColor: { value: new Vector3(0.62, 0.68, 0.74) },
          uOpacity: { value: 0.45 },
        },
      }),
    );
    const sg = new BufferGeometry();
    sg.setAttribute('seed', new BufferAttribute(seeds(o.snowFlakes, 1), 3));
    sg.setAttribute('position', new BufferAttribute(new Float32Array(o.snowFlakes * 3), 3));
    this.snow = new Points(
      sg,
      new ShaderMaterial({
        vertexShader: VERT_SNOW,
        fragmentShader: FRAG_SNOW,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: this.center },
          uBox: { value: o.box },
          uFall: { value: o.snowFall },
          uSway: { value: o.snowSway },
          uSize: { value: 3.5 },
          uColor: { value: new Vector3(0.92, 0.94, 0.97) },
          uOpacity: { value: 0.85 },
        },
      }),
    );
    for (const m of [this.rain, this.snow]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 10;
      m.name = 'weather';
    }
    scene.add(this.rain, this.snow);
  }

  /**
   * Per frame: `x`, `z` = camera target (world), `timeSec` = render clock, `day` 0..1. Returns
   * the lightning flash 0..1 (add it to the fill light / exposure).
   */
  update(wx: WeatherView | undefined, x: number, z: number, timeSec: number, day: number): number {
    const p = precipitation(wx);
    const o = WEATHER_FX;
    this.center.set(x, 0, z);
    const rainN = Math.round(o.rainDrops * p.rain);
    this.rain.visible = rainN > 0;
    this.rain.geometry.setDrawRange(0, rainN * 2);
    const rm = this.rain.material.uniforms;
    rm.uTime!.value = timeSec;
    // Rain is lighter in the day, faint at night (it only shows where light hits it).
    rm.uOpacity!.value = 0.22 + 0.3 * day;
    const snowN = Math.round(o.snowFlakes * p.snow);
    this.snow.visible = snowN > 0;
    this.snow.geometry.setDrawRange(0, snowN);
    const sm = this.snow.material.uniforms;
    sm.uTime!.value = timeSec;
    sm.uOpacity!.value = 0.35 + 0.5 * day;
    return this.lightning(wx, timeSec);
  }

  private lightning(wx: WeatherView | undefined, t: number): number {
    const storm = wx
      ? wx.kind === 'storm'
        ? wx.blend
        : wx.from === 'storm'
          ? 1 - wx.blend
          : 0
      : 0;
    if (storm < 0.5) {
      this.nextStrike = 0;
      return 0;
    }
    const [a, b] = WEATHER_FX.lightningEvery;
    if (this.nextStrike === 0) this.nextStrike = t + a + Math.random() * (b - a);
    if (t >= this.nextStrike) {
      this.strikeAt = t;
      this.nextStrike = t + a + Math.random() * (b - a);
    }
    const s = t - this.strikeAt;
    const f = WEATHER_FX.flashSec;
    if (this.strikeAt < 0 || s > f * 2.2) return 0;
    // Two pulses: a bright one, a short gap, a weaker one.
    if (s < f) return 1 - s / f;
    if (s < f * 1.3) return 0;
    return 0.6 * (1 - (s - f * 1.3) / (f * 0.9));
  }

  dispose(): void {
    this.scene.remove(this.rain, this.snow);
    for (const m of [this.rain, this.snow]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
