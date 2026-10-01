import type { AudioSettings } from '../settings/schema.js';

export type AudioBus = 'music' | 'sfx' | 'ambience' | 'ui';

/** Perceptual curve of the sliders (spec §5): gain = v², v in 0..1. */
export function volumeToGain(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c * c;
}

/** Per-bus gains (excluding master). Music is silenced in the menu when `menuMusic` is off. */
export function busGains(a: AudioSettings, inMenu: boolean): Record<AudioBus, number> {
  return {
    music: inMenu && !a.menuMusic ? 0 : volumeToGain(a.music),
    sfx: volumeToGain(a.effects),
    ambience: volumeToGain(a.ambience),
    ui: volumeToGain(a.voice),
  };
}

/** Master gain; 0 when muted. */
export function masterGain(a: AudioSettings): number {
  return a.muted ? 0 : volumeToGain(a.master);
}

/** Slider label 0–100. */
export function percent(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100);
}
