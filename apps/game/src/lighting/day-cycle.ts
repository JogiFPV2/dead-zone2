import { compilePreset, mixCompiled, type CompiledPreset } from './compiled.js';
import type { DayCycleConfig, LampSchedule } from './day-cycle-config.js';
import { smoothstep } from './preset.js';

export const MINUTES_PER_DAY = 1440;

/** Minute of day wrapped into [0, 1440). */
export const wrapMinute = (m: number): number =>
  ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

export interface Segment {
  from: number;
  to: number;
  /** Linear progress 0..1 between keyframe `from` and `to` (before smoothstep). */
  t: number;
}

/** Keyframe pair around `minute` (wrapping past midnight). Writes into `out` (no allocation). */
export function segmentAt(
  minutes: readonly number[],
  minute: number,
  out: Segment = { from: 0, to: 0, t: 0 },
): Segment {
  const m = wrapMinute(minute);
  const n = minutes.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (minutes[k]! <= m) i = k;
    else break;
  }
  const j = (i + 1) % n;
  const start = minutes[i]!;
  const span = wrapMinute(minutes[j]! - start) || MINUTES_PER_DAY;
  out.from = i;
  out.to = j;
  out.t = wrapMinute(m - start) / span;
  return out;
}

/** Street lamp level 0..1 with a smooth fade after `on` and after `off` (wraps midnight). */
export function lampLevel(minute: number, s: LampSchedule): number {
  const m = wrapMinute(minute);
  const sinceOn = wrapMinute(m - s.on);
  const sinceOff = wrapMinute(m - s.off);
  const onSpan = wrapMinute(s.off - s.on);
  const fade = Math.max(1e-6, s.fadeMinutes);
  if (sinceOn < onSpan) return smoothstep(sinceOn / fade); // lit period: fade in
  return 1 - smoothstep(sinceOff / fade); // dark period: fade out
}

/**
 * Samples the lighting for a minute of day: smoothstep blend of the neighbouring keyframes into
 * one reused CompiledPreset. Per-frame calls allocate nothing.
 */
export class DayCycle {
  private readonly compiled: CompiledPreset[];
  private readonly minutes: number[];
  private readonly out: CompiledPreset;
  private readonly seg: Segment = { from: 0, to: 0, t: 0 };

  constructor(readonly config: DayCycleConfig) {
    if (config.keyframes.length === 0) throw new Error('DayCycle: brak klatek kluczowych');
    for (let i = 1; i < config.keyframes.length; i++) {
      if (config.keyframes[i]!.minute <= config.keyframes[i - 1]!.minute) {
        throw new Error('DayCycle: klatki muszą być posortowane rosnąco');
      }
    }
    this.compiled = config.keyframes.map((k) => compilePreset(k.preset));
    this.minutes = config.keyframes.map((k) => wrapMinute(k.minute));
    this.out = compilePreset(config.keyframes[0]!.preset);
  }

  sample(minute: number): CompiledPreset {
    const s = segmentAt(this.minutes, minute, this.seg);
    return mixCompiled(this.out, this.compiled[s.from]!, this.compiled[s.to]!, smoothstep(s.t));
  }

  lampLevel(minute: number): number {
    return lampLevel(minute, this.config.lamps);
  }
}
