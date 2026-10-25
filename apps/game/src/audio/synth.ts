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

export const SYNTH_SOUNDS = {
  'sfx-swallow': swallowSamples,
} as const;
export type SynthSoundId = keyof typeof SYNTH_SOUNDS;
