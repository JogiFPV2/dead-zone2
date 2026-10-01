import {
  AnimationMixer,
  LoopOnce,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';

export type CharacterAnim = 'idle' | 'walk' | 'run' | 'attack' | 'dead';

/** Clip name suffix per anim (Quaternius `CharacterArmature|Walk` …). */
const CLIPS: Record<CharacterAnim, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: 'Punch_Right',
  dead: 'Death',
};
const FADE_S = 0.2;

/** One animated character: mixer + cross-fading between a few clips. */
export class CharacterRig {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<CharacterAnim, AnimationAction>();
  private current: CharacterAnim | undefined;

  constructor(
    readonly object: Object3D,
    clips: readonly AnimationClip[],
    /** Playback speed for walk/run (zombies shamble slower). */
    private readonly speed = 1,
  ) {
    this.mixer = new AnimationMixer(object);
    for (const [anim, name] of Object.entries(CLIPS) as [CharacterAnim, string][]) {
      const clip = clips.find((c) => c.name === name || c.name.endsWith(`|${name}`));
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (anim === 'dead') {
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(anim, a);
    }
  }

  play(anim: CharacterAnim): void {
    if (anim === this.current) return;
    const next = this.actions.get(anim) ?? this.actions.get('idle');
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    this.current = anim;
    next.reset();
    next.timeScale = anim === 'walk' || anim === 'run' ? this.speed : 1;
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, FADE_S, false);
  }

  update(dtS: number): void {
    this.mixer.update(dtS);
  }
}
