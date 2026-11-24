/**
 * Procedural one-shots (no asset file): generated once into an AudioBuffer by `AudioEngine`.
 * Pure sample generators, so they are testable without Web Audio.
 */

/** Swallow (pill taken): two short, low, damped "gulp" sweeps, ~0.45 s. */
export function swallowSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(rate * 0.45));
  const gulp = (t0: number, dur: number, f0: number, f1: number, amp: number) => {
    let phase = 0;
    const n0 = Math.round(t0 * rate);
    const n = Math.round(dur * rate);
    for (let i = 0; i < n && n0 + i < out.length; i++) {
      const t = i / n;
      const f = f0 + (f1 - f0) * t;
      phase += (2 * Math.PI * f) / rate;
      // Fast attack, smooth decay.
      const env = Math.min(1, t * 20) * (1 - t) * (1 - t);
      out[n0 + i]! += Math.sin(phase) * env * amp;
    }
  };
  gulp(0.02, 0.16, 260, 110, 0.7);
  gulp(0.22, 0.2, 180, 70, 0.55);
  return out;
}

/** Deterministic noise source (mulberry32), so every generated sound is the same each run. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

/** One-pole low-pass coefficient for a cutoff (Hz). */
const lpK = (rate: number, hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate);

/** Peak-normalises in place to `peak`. */
function normalise(out: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of out) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < out.length; i++) out[i]! *= peak / m;
  return out;
}

/**
 * Gunshot: a sharp noise crack, a low body thump and a long filtered tail (echo of the street).
 * `heavy` (shotgun) is lower and longer, `sharp` (rifle) has a brighter crack.
 */
export function gunshotSamples(
  rate: number,
  kind: 'pistol' | 'shotgun' | 'rifle' = 'pistol',
): Float32Array {
  const len = kind === 'shotgun' ? 1.3 : 1.0;
  const out = new Float32Array(Math.round(rate * len));
  const rnd = noise(kind === 'shotgun' ? 11 : kind === 'rifle' ? 12 : 13);
  const crackHz = kind === 'rifle' ? 6000 : kind === 'shotgun' ? 2500 : 4000;
  const bodyHz = kind === 'shotgun' ? 55 : kind === 'rifle' ? 85 : 70;
  const kCrack = lpK(rate, crackHz);
  const kTail = lpK(rate, 700);
  let c = 0;
  let tail = 0;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const n = rnd();
    c += (n - c) * kCrack;
    tail += (n - tail) * kTail;
    const crack = c * Math.exp(-t / (kind === 'shotgun' ? 0.05 : 0.03));
    phase += (2 * Math.PI * bodyHz * (1 + 1.5 * Math.exp(-t / 0.02))) / rate;
    const body = Math.sin(phase) * Math.exp(-t / (kind === 'shotgun' ? 0.16 : 0.1));
    const rumble = tail * 2.5 * Math.min(1, t / 0.03) * Math.exp(-t / (len * 0.35));
    out[i] = crack * 1.6 + body * 0.9 + rumble;
  }
  return normalise(out, 0.95);
}

/** Short metallic click (dry fire, jam, magazine seated). */
export function clickSamples(rate: number, hz = 2400, len = 0.06): Float32Array {
  const out = new Float32Array(Math.round(rate * len));
  const rnd = noise(7);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    ph += (2 * Math.PI * hz) / rate;
    out[i] = (Math.sin(ph) * 0.6 + rnd() * 0.5) * Math.exp(-t / 0.008);
  }
  return normalise(out, 0.7);
}

/** Reload: magazine out, a pause, magazine in and the slide (three clicks). */
export function reloadSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(rate * 0.5));
  const put = (t0: number, s: Float32Array, amp: number) => {
    const n0 = Math.round(t0 * rate);
    for (let i = 0; i < s.length && n0 + i < out.length; i++) out[n0 + i]! += s[i]! * amp;
  };
  put(0, clickSamples(rate, 1700, 0.05), 0.6);
  put(0.22, clickSamples(rate, 2200, 0.06), 0.9);
  put(0.36, clickSamples(rate, 3000, 0.08), 1);
  return normalise(out, 0.7);
}

/**
 * Zombie groan: a rough, low voice (sawtooth with jittered pitch, two formants) and breath,
 * `variant` changes pitch, length and contour. `alert` is the higher, rising shriek when it spots
 * someone.
 */
export function groanSamples(rate: number, variant: number, alert = false): Float32Array {
  const len = alert ? 0.9 : 1.1 + (variant % 3) * 0.3;
  const out = new Float32Array(Math.round(rate * len));
  const rnd = noise(100 + variant * 17 + (alert ? 50 : 0));
  const f0 = alert ? 170 + variant * 25 : 72 + (variant % 3) * 14;
  const k1 = lpK(rate, alert ? 1400 : 700);
  const k2 = lpK(rate, alert ? 3000 : 1500);
  const kb = lpK(rate, 900);
  let ph = 0;
  let a = 0;
  let b = 0;
  let br = 0;
  let jit = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / len / rate;
    jit += (rnd() * 0.6 - jit) * 0.002;
    const contour = alert ? 0.8 + 0.6 * t : 1 + 0.25 * Math.sin(Math.PI * t * (1 + (variant % 2)));
    const f = f0 * contour * (1 + jit + 0.03 * Math.sin(2 * Math.PI * 5.5 * (i / rate)));
    ph += f / rate;
    const saw = 2 * (ph - Math.floor(ph)) - 1;
    a += (saw - a) * k1;
    b += (saw - b) * k2;
    br += (rnd() - br) * kb;
    const env = Math.min(1, t * 8) * Math.pow(1 - t, alert ? 1.5 : 0.8);
    out[i] = (a * 0.8 + (b - a) * 0.4 + br * 0.5) * env;
  }
  return normalise(out, 0.8);
}

/** Breaking glass: a crash of bright noise and a scatter of high pings. */
export function glassSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(rate * 0.9));
  const rnd = noise(31);
  let lo = 0;
  const k = lpK(rate, 1500);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const n = rnd();
    lo += (n - lo) * k;
    out[i] = (n - lo) * Math.exp(-t / 0.07) * 0.9;
  }
  for (let p = 0; p < 14; p++) {
    const t0 = 0.01 + (rnd() * 0.5 + 0.5) * 0.4 * (p / 14);
    const hz = 2500 + (rnd() * 0.5 + 0.5) * 4500;
    const n0 = Math.round(t0 * rate);
    for (let i = 0; i < rate * 0.12 && n0 + i < out.length; i++) {
      out[n0 + i]! += Math.sin((2 * Math.PI * hz * i) / rate) * Math.exp(-i / rate / 0.03) * 0.25;
    }
  }
  return normalise(out, 0.8);
}

/** Dull thud of something landing (thrown item). */
export function thudSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(rate * 0.25));
  const rnd = noise(41);
  let lo = 0;
  const k = lpK(rate, 400);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    lo += (rnd() - lo) * k;
    ph += (2 * Math.PI * (90 - 40 * t * 4)) / rate;
    out[i] = (Math.sin(ph) * 0.7 + lo * 2) * Math.exp(-t / 0.05);
  }
  return normalise(out, 0.7);
}

/** Thunder: a crack and a long rolling rumble of low noise, ~4.5 s. */
export function thunderSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(rate * 4.5));
  const rnd = noise(51);
  const k = lpK(rate, 160);
  const k2 = lpK(rate, 2000);
  let lo = 0;
  let mid = 0;
  let roll = 0;
  const kr = lpK(rate, 3);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const n = rnd();
    lo += (n - lo) * k;
    mid += (n - mid) * k2;
    roll += (Math.abs(rnd()) - roll) * kr;
    const crack = mid * Math.exp(-t / 0.12) * 0.35;
    const env = Math.min(1, t / 0.15) * Math.exp(-t / 1.6) * (0.5 + roll * 1.6);
    out[i] = crack + lo * 6 * env;
  }
  return normalise(out, 0.9);
}

/**
 * Rain loop (4 s, seamless): a steady hiss with random drops; the ends are cross-faded so the
 * loop has no click.
 */
export function rainSamples(rate: number): Float32Array {
  const len = Math.round(rate * 4);
  const fade = Math.round(rate * 0.25);
  const raw = new Float32Array(len + fade);
  const rnd = noise(61);
  const kh = lpK(rate, 5000);
  const kl = lpK(rate, 400);
  let h = 0;
  let l = 0;
  for (let i = 0; i < raw.length; i++) {
    const n = rnd();
    h += (n - h) * kh;
    l += (n - l) * kl;
    raw[i] = (h - l) * 0.8;
  }
  for (let d = 0; d < 900; d++) {
    const n0 = Math.floor((rnd() * 0.5 + 0.5) * raw.length);
    const hz = 1200 + (rnd() * 0.5 + 0.5) * 3000;
    const amp = 0.05 + (rnd() * 0.5 + 0.5) * 0.12;
    for (let i = 0; i < rate * 0.015 && n0 + i < raw.length; i++)
      raw[n0 + i]! += Math.sin((2 * Math.PI * hz * i) / rate) * Math.exp(-i / rate / 0.004) * amp;
  }
  const out = raw.slice(0, len);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = raw[len + i]! * (1 - w) + raw[i]! * w;
  }
  return normalise(out, 0.6);
}

export const SYNTH_SOUNDS = {
  'sfx-swallow': swallowSamples,
  'sfx-shot-pistol': (r: number) => gunshotSamples(r, 'pistol'),
  'sfx-shot-shotgun': (r: number) => gunshotSamples(r, 'shotgun'),
  'sfx-shot-rifle': (r: number) => gunshotSamples(r, 'rifle'),
  'sfx-dryfire': (r: number) => clickSamples(r),
  'sfx-reload': reloadSamples,
  'sfx-zombie-groan0': (r: number) => groanSamples(r, 0),
  'sfx-zombie-groan1': (r: number) => groanSamples(r, 1),
  'sfx-zombie-groan2': (r: number) => groanSamples(r, 2),
  'sfx-zombie-alert0': (r: number) => groanSamples(r, 0, true),
  'sfx-zombie-alert1': (r: number) => groanSamples(r, 1, true),
  'sfx-glass': glassSamples,
  'sfx-thud': thudSamples,
  'sfx-thunder': thunderSamples,
  'amb-rain': rainSamples,
} as const;
export type SynthSoundId = keyof typeof SYNTH_SOUNDS;
