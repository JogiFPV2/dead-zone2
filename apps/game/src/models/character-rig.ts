import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';

export type CharacterAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'back'
  | 'strafeLeft'
  | 'strafeRight'
  | 'attack'
  | 'dead'
  | 'slash'
  | 'push'
  | 'hit'
  | 'stagger'
  | 'getup'
  | 'idle_gun'
  | 'aim'
  | 'shoot';

/**
 * Clip name suffix per anim (Quaternius `CharacterArmature|Walk` ...). `getup` has no clip of
 * its own: it is `Death` played backwards (see CLIP_SOURCE).
 */
export const CHARACTER_CLIPS: Record<Exclude<CharacterAnim, 'getup'>, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  // Quaternius has no slow backwards / side walk: the run clips played slower read as a walk.
  back: 'Run_Back',
  strafeLeft: 'Run_Left',
  strafeRight: 'Run_Right',
  attack: 'Punch_Right',
  dead: 'Death',
  slash: 'Sword_Slash',
  push: 'Punch_Left',
  hit: 'HitRecieve',
  stagger: 'HitRecieve_2',
  idle_gun: 'Idle_Gun',
  aim: 'Idle_Gun_Pointing',
  shoot: 'Idle_Gun_Shoot',
};

/** The clip an anim plays and whether backwards. */
export function clipSource(anim: CharacterAnim): {
  anim: Exclude<CharacterAnim, 'getup'>;
  reverse: boolean;
} {
  return anim === 'getup' ? { anim: 'dead', reverse: true } : { anim, reverse: false };
}

export const findClip = (
  clips: readonly AnimationClip[],
  name: string,
): AnimationClip | undefined => clips.find((c) => c.name === name || c.name.endsWith(`|${name}`));

/** Weight fade time constant (s): ~95 % of a cross-fade in 0.15 s. */
const FADE_TAU_S = 0.05;

/**
 * One animated character: mixer + blending between clips. The clip time is set by the caller
 * every frame (`pose`, `locomote`), so playback follows the sim state timing exactly. Weights
 * fade towards their targets (sum 1) in `update`: a single clip (`pose`) or the walk / run mix
 * (`locomote`, both clips at the same gait phase).
 */
export class CharacterRig {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<CharacterAnim, AnimationAction>();
  /** Target weight per playing action; missing = fading out to 0. */
  private readonly target = new Map<AnimationAction, number>();
  private readonly weight = new Map<AnimationAction, number>();

  constructor(
    readonly object: Object3D,
    clips: readonly AnimationClip[],
  ) {
    this.mixer = new AnimationMixer(object);
    for (const [anim, name] of Object.entries(CHARACTER_CLIPS) as [CharacterAnim, string][]) {
      const clip = findClip(clips, name);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      a.timeScale = 0;
      this.actions.set(anim, a);
    }
  }

  /** Clip length (s), 1 when missing. */
  length(anim: CharacterAnim): number {
    return this.action(anim)?.getClip().duration ?? 1;
  }

  private action(anim: CharacterAnim): AnimationAction | undefined {
    return this.actions.get(clipSource(anim).anim) ?? this.actions.get('idle');
  }

  private setTime(a: AnimationAction, anim: CharacterAnim, time: number, loop: boolean): void {
    const dur = a.getClip().duration;
    const t = loop ? ((time % dur) + dur) % dur : Math.min(Math.max(time, 0), dur - 1e-4);
    a.time = clipSource(anim).reverse ? dur - 1e-4 - t : t;
  }

  private targets(list: [AnimationAction, number][]): void {
    this.target.clear();
    for (const [a, w] of list) {
      this.target.set(a, (this.target.get(a) ?? 0) + w);
      if (!this.weight.has(a)) {
        // First frame of a fresh rig: no fade from nothing.
        const first = this.weight.size === 0;
        a.reset();
        a.timeScale = 0;
        a.play();
        this.weight.set(a, first ? w : 0);
        a.setEffectiveWeight(first ? w : 0);
      }
    }
  }

  /** Shows `anim` at clip time `time` (s); loops wrap, one-shots clamp (backwards for get-up). */
  pose(anim: CharacterAnim, time: number, loop: boolean): void {
    const next = this.action(anim);
    if (!next) return;
    this.targets([[next, 1]]);
    this.setTime(next, anim, time, loop);
  }

  /** Walk and run mixed (`run` = run weight 0..1) at their own clip times (same gait phase). */
  locomote(walkTime: number, runTime: number, run: number): void {
    const walk = this.action('walk');
    const runA = this.action('run');
    if (!walk || !runA) return;
    const r = Math.max(0, Math.min(1, run));
    this.targets([
      [walk, 1 - r],
      [runA, r],
    ]);
    this.setTime(walk, 'walk', walkTime, true);
    this.setTime(runA, 'run', runTime, true);
  }

  update(dtS: number): void {
    const k = 1 - Math.exp(-Math.max(0, dtS) / FADE_TAU_S);
    for (const [a, w] of this.weight) {
      const t = this.target.get(a) ?? 0;
      const nw = t === 0 && w < 1e-3 ? 0 : w + (t - w) * k;
      if (nw === 0) {
        a.stop();
        this.weight.delete(a);
        continue;
      }
      this.weight.set(a, nw);
      a.setEffectiveWeight(nw);
    }
    this.mixer.update(dtS);
  }
}
