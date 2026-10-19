import { isStoppableLeisure } from './leisure-actions.js';
import type { Command, SimEvent, SleepView } from '@deadzone/protocol';
import type { CommandBody } from '../sim/sim-client.js';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import { craftItemName, skillName } from './crafting-labels.js';
import { sleepFeedback, type Feedback, type PendingKind } from './sleep-feedback.js';
import { sleepScreenVM } from './sleep-model.js';
import { createSleepScreen } from './sleep-screen.js';
import { DEFAULT_SLEEP_SETTINGS } from './sleep-settings.js';

/** Sleep screen refresh (the model changes at most once per real second / game minute). */
const SCREEN_UPDATE_MS = 100;
/** Pending commands kept for rejections (the sim answers within a few ticks). */
const MAX_PENDING = 32;
/** Hotbar keys 1, 2 and 4 pick the speed while asleep. */
const SPEED_BY_SLOT: Partial<Record<number, 1 | 2 | 4>> = { 0: 1, 1: 2, 3: 4 };

export interface SleepControllerOptions {
  root: HTMLElement;
  playerId: number;
  /** Stamps and sends; returns the stamped command (its `seq`). */
  send: (body: CommandBody) => Command;
  /** Worker speed-up (`client.setSpeed`); absent with the mock sim. */
  setSpeed?: ((x: 1 | 2 | 4) => void) | undefined;
  state: () => GameState;
  content: () => HudContentIndex;
  keys: () => { wake: string; speed: [string, string, string] };
}

export interface SleepController {
  readonly sleeping: boolean;
  /** Sleep key: fall asleep here, or wake up when asleep. */
  toggleSleep(): void;
  wake(): void;
  /** TV key / button: watch the TV nearby, or stop watching. */
  watchTv(vhs?: number): void;
  /** Remember a command sent elsewhere (inventory: VHS tape) for its rejection text. */
  track(cmd: Command): void;
  /** Hotbar key while asleep → speed; true when consumed. */
  speedKey(slot: number): boolean;
  /** Sleep / leisure feedback (HUD option `feedback`). */
  feedback(e: SimEvent): Feedback | undefined;
  /** Raw events: speed hints from the sim. */
  events(events: readonly SimEvent[]): void;
  /** Store change: keeps the last sleep view (wake-up feedback). */
  observe(next: GameState, prev: GameState): void;
  frame(now: number, tick: number): void;
}

/** Sleep, wake, speed and TV commands plus the sleep screen (mockup sleep.png). */
export function createSleepController(opts: SleepControllerOptions): SleepController {
  const pending = new Map<number, PendingKind>();
  let lastSleep: SleepView | undefined;
  let baseline: { start: number; hunger: number; thirst: number } | undefined;
  let lastScreen = -Infinity;
  const cfg = () => opts.content().sleep ?? DEFAULT_SLEEP_SETTINGS;

  const sendTracked = (kind: PendingKind, body: CommandBody): void => {
    const cmd = opts.send(body);
    pending.set(cmd.seq, kind);
    if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
  };
  const setSpeed = (x: 1 | 2 | 4): void => {
    opts.setSpeed?.(x);
  };
  const wake = (): void => {
    opts.send({ type: 'wake' });
  };
  const screen = createSleepScreen({
    root: opts.root,
    onWake: wake,
    onSpeed: setSpeed,
    keys: opts.keys,
  });

  const api: SleepController = {
    get sleeping() {
      return opts.state().player.sleeping;
    },
    toggleSleep() {
      const s = opts.state();
      if (s.death || !s.player.alive) return;
      if (s.player.sleeping) wake();
      else sendTracked('sleep', { type: 'sleep' });
    },
    wake,
    watchTv(vhs) {
      if (vhs === undefined && isStoppableLeisure(opts.state().action?.kind)) {
        opts.send({ type: 'cancelAction' });
        return;
      }
      sendTracked(vhs === undefined ? 'tv' : 'vhs', {
        type: 'watchTv',
        ...(vhs !== undefined ? { vhs } : {}),
      });
    },
    track(cmd) {
      if (cmd.type === 'watchTv') pending.set(cmd.seq, cmd.vhs === undefined ? 'tv' : 'vhs');
    },
    speedKey(slot) {
      const x = SPEED_BY_SLOT[slot];
      if (!opts.state().player.sleeping) return false;
      if (x) setSpeed(x);
      return true;
    },
    feedback(e) {
      const s = opts.state();
      const fb = sleepFeedback(e, {
        playerId: opts.playerId,
        pending,
        threat: s.threat,
        fatigue: s.player.stats.fatigue ?? 0,
        minFatigueToSleep: cfg().minFatigueToSleep,
        wakeOnZombieTiles: cfg().wakeOnZombieTiles,
        clock: s.clock,
        lastSleep: s.player.sleep ?? lastSleep,
        itemName: craftItemName,
        skillName,
      });
      if (e.type === 'commandRejected') pending.delete(e.seq);
      return fb;
    },
    events(events) {
      for (const e of events) {
        // The sim suggests ×4 when falling asleep and ×1 on waking; follow it in singleplayer.
        if (e.type === 'timeScaleHint') setSpeed(e.speed);
      }
    },
    observe(next, prev) {
      if (prev.player.sleep) lastSleep = prev.player.sleep;
      if (next.player.sleep) lastSleep = next.player.sleep;
    },
    frame(now, tick) {
      if (now - lastScreen < SCREEN_UPDATE_MS) return;
      lastScreen = now;
      const s = opts.state();
      const sleep = s.player.sleep;
      if (!sleep || !s.clock || s.death) {
        baseline = undefined;
        screen.update(null);
        return;
      }
      const hunger = s.player.stats.hunger ?? 0;
      const thirst = s.player.stats.thirst ?? 0;
      if (baseline?.start !== sleep.sleepStartTick) {
        baseline = { start: sleep.sleepStartTick, hunger, thirst };
      }
      screen.update(
        sleepScreenVM({
          sleep,
          clock: s.clock,
          fatigue: s.player.stats.fatigue ?? 0,
          hungerGain: hunger - baseline.hunger,
          thirstGain: thirst - baseline.thirst,
          threat: s.threat,
          tick,
          cfg: cfg(),
        }),
      );
    },
  };
  return api;
}
