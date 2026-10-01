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

const FADE_S = 0.15;

/**
 * One animated character: mixer + cross-fading between clips. The clip time is set by the
 * caller every frame (`pose`), so playback follows the sim state timing exactly.
 */
export class CharacterRig {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<CharacterAnim, AnimationAction>();
  private current: AnimationAction | undefined;

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

  /** Shows `anim` at clip time `time` (s); loops wrap, one-shots clamp (backwards for get-up). */
  pose(anim: CharacterAnim, time: number, loop: boolean): void {
    const next = this.action(anim);
    if (!next) return;
    if (next !== this.current) {
      const prev = this.current;
      this.current = next;
      next.reset();
      next.timeScale = 0;
      next.play();
      if (prev) prev.crossFadeTo(next, FADE_S, false);
    }
    const dur = next.getClip().duration;
    const t = loop ? ((time % dur) + dur) % dur : Math.min(Math.max(time, 0), dur - 1e-4);
    next.time = clipSource(anim).reverse ? dur - 1e-4 - t : t;
  }

  update(dtS: number): void {
    this.mixer.update(dtS);
  }
}
