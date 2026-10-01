import type { AudioSettings } from '../settings/schema.js';
import type { SettingsStore } from '../settings/store.js';
import { busGains, masterGain, type AudioBus } from './mix.js';

/** CC0 sounds in `public/audio` (licences: ASSETS.md). Each has an .ogg and an .mp3 fallback. */
export type SoundId =
  'menu-emptycity' | 'amb-crickets' | 'ui-click1' | 'ui-rollover2' | 'ui-switch2';

interface Loop {
  readonly gain: GainNode;
  source: AudioBufferSourceNode | null;
}

const FADE_S = 1.2;

/**
 * Web Audio mixer: master → buses (music, sfx, ambience, ui). Volumes follow the settings store
 * live. The context starts suspended until a user gesture (autoplay policy); everything queued
 * before that just plays once it resumes.
 */
export class AudioEngine {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null = null;
  private readonly buses = new Map<AudioBus, GainNode>();
  private readonly buffers = new Map<SoundId, Promise<AudioBuffer | null>>();
  private readonly loops = new Map<AudioBus, Loop>();
  private readonly ext: 'ogg' | 'mp3';
  private inMenu = true;
  private previewing: AudioSettings | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly baseUrl: string,
  ) {
    let ctx: AudioContext | null = null;
    try {
      ctx = typeof AudioContext === 'undefined' ? null : new AudioContext();
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
    const probe = typeof Audio === 'undefined' ? null : new Audio();
    this.ext = probe?.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const bus of ['music', 'sfx', 'ambience', 'ui'] as const) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses.set(bus, g);
    }
    this.applyVolumes(true);
    settings.subscribe(() => this.applyVolumes(false));
    const resume = (): void => {
      if (ctx.state === 'suspended') void ctx.resume();
    };
    for (const ev of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(ev, resume, { capture: true });
    }
  }

  /** Menu vs game: the „Muzyka w menu” toggle only applies in the menu. */
  setInMenu(inMenu: boolean): void {
    this.inMenu = inMenu;
    this.applyVolumes(false);
  }

  /** Live preview of unsaved slider values (Ustawienia › Audio); `null` = back to the store. */
  preview(audio: AudioSettings | null): void {
    this.previewing = audio;
    this.applyVolumes(false);
  }

  /** Starts (or cross-fades to) a looping track on `bus` (music / ambience). */
  playLoop(bus: 'music' | 'ambience', id: SoundId): void {
    const ctx = this.ctx;
    const out = this.buses.get(bus);
    if (!ctx || !out) return;
    this.stopLoop(bus);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    const loop: Loop = { gain, source: null };
    this.loops.set(bus, loop);
    void this.load(id).then((buf) => {
      if (!buf || this.loops.get(bus) !== loop) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      loop.source = src;
      gain.gain.setTargetAtTime(1, ctx.currentTime, FADE_S / 3);
    });
  }

  /** Fades the loop on `bus` out. */
  stopLoop(bus: 'music' | 'ambience'): void {
    const ctx = this.ctx;
    const loop = this.loops.get(bus);
    if (!ctx || !loop) return;
    this.loops.delete(bus);
    loop.gain.gain.cancelScheduledValues(ctx.currentTime);
    loop.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE_S / 4);
    const src = loop.source;
    setTimeout(() => {
      src?.stop();
      loop.gain.disconnect();
    }, FADE_S * 1000);
  }

  /** One-shot (UI clicks, effects). Silently skipped until the buffer has loaded. */
  play(bus: 'sfx' | 'ui', id: SoundId, volume = 1): void {
    const ctx = this.ctx;
    const out = this.buses.get(bus);
    if (!ctx || !out || ctx.state !== 'running') {
      void this.load(id);
      return;
    }
    void this.load(id).then((buf) => {
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(out);
      src.start();
    });
  }

  /** Warms the buffer cache. */
  preload(...ids: SoundId[]): void {
    for (const id of ids) void this.load(id);
  }

  private load(id: SoundId): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    let p = this.buffers.get(id);
    if (!p) {
      p = fetch(`${this.baseUrl}audio/${id}.${this.ext}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch((e: unknown) => {
          console.warn(`Audio: nie wczytano ${id}`, e);
          return null;
        });
      this.buffers.set(id, p);
    }
    return p;
  }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const a = this.previewing ?? this.settings.get().audio;
    const set = (g: GainNode, v: number): void => {
      if (immediate) g.gain.value = v;
      else g.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    };
    set(this.master, masterGain(a));
    const gains = busGains(a, this.inMenu);
    for (const [bus, g] of this.buses) set(g, gains[bus]);
  }
}
