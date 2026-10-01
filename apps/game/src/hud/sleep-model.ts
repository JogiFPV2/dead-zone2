import type { ClockView, SleepView } from '@deadzone/protocol';
import type { HudSleepSettings, SleepSurface } from './sleep-settings.js';

/** Sleep screen view model (approved mockup sleep.png). Pure: state in, strings out. */

export const SURFACE_NAME: Record<SleepSurface, string> = {
  bed: 'Łóżko',
  sofa: 'Kanapa',
  floor: 'Podłoga',
};
/** `Limit łóżka` / `kanapy` / `podłogi`. */
const SURFACE_GEN: Record<SleepSurface, string> = {
  bed: 'łóżka',
  sofa: 'kanapy',
  floor: 'podłogi',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Real seconds → `1:12`. */
export function formatRealSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Absolute game minute (day 1 = 0) → `06:10`. */
export const formatClock = (abs: number): string => {
  const m = ((Math.floor(abs) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

export const absMinute = (c: Pick<ClockView, 'day' | 'minuteOfDay'>): number =>
  (c.day - 1) * 1440 + c.minuteOfDay;

export const dayOf = (abs: number): number => Math.floor(abs / 1440) + 1;

/** Game time per real time: ticks are 20/s, `ticksPerGameMinute` per game minute, × timeScale. */
export function gameSpeedRatio(clock: Pick<ClockView, 'ticksPerGameMinute' | 'timeScale'>): number {
  const tpm = Math.max(1, clock.ticksPerGameMinute);
  return Math.round((20 * 60 * (clock.timeScale ?? 1)) / tpm);
}

export interface WakeEstimate {
  /** Game minutes slept so far. */
  elapsedMin: number;
  /** Game minutes until `rested` (place limit, `wakeAtFatigue` or max duration). */
  remainingMin: number;
  /** Fatigue at the start of this sleep and when rested. */
  fatigueStart: number;
  fatigueEnd: number;
}

/**
 * When the player wakes up rested. The rate is the place's `fatigueRecoveryPerMin`, refined by
 * the measured rate after 10 game minutes (pain / cold make sleep worse).
 */
export function wakeEstimate(
  sleep: SleepView,
  fatigue: number,
  tick: number,
  ticksPerGameMinute: number,
  cfg: HudSleepSettings,
): WakeEstimate {
  const elapsedMin = Math.max(0, (tick - sleep.sleepStartTick) / Math.max(1, ticksPerGameMinute));
  const base = cfg.surfaces[sleep.surface].ratePerMin;
  const rate = elapsedMin >= 10 && sleep.restGained > 0 ? sleep.restGained / elapsedMin : base;
  const fatigueStart = fatigue + sleep.restGained;
  const fatigueEnd = Math.max(cfg.wakeAtFatigue, fatigueStart - sleep.restCap);
  const rest = Math.max(0, fatigue - fatigueEnd);
  const remainingMin = Math.max(
    0,
    Math.min(rest / Math.max(1e-6, rate), cfg.maxDurationMin - elapsedMin),
  );
  return { elapsedMin, remainingMin, fatigueStart, fatigueEnd };
}

export type RowTone = 'default' | 'accent' | 'danger' | 'warn';

export interface SleepRowVM {
  label: string;
  value: string;
  tone: RowTone;
  /** Small bar before the value (0..1). */
  bar?: number;
  /** Muted suffix after the value (`w czasie snu`). */
  note?: string;
}

export interface SleepScreenVM {
  title: string;
  subtitle: string;
  safe: boolean;
  safeText: string;
  /** Ring: real seconds of uninterrupted sleep towards the save. */
  real: { text: string; total: string; pct: number };
  game: { time: string; ratio: string; from: string; to: string; pct: number };
  save: { ready: boolean; title: string; detail: string };
  rows: SleepRowVM[];
  /** Under the wake button. */
  wakeNote: { text: string; tone: 'warn' | 'ok' };
  speed: 1 | 2 | 4;
  speedBlocked: boolean;
}

export interface SleepScreenInput {
  sleep: SleepView;
  clock: ClockView;
  fatigue: number;
  /** Hunger / thirst gained since falling asleep (client baseline). */
  hungerGain: number;
  thirstGain: number;
  threat: number;
  tick: number;
  cfg: HudSleepSettings;
}

const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v))}`;

export function sleepScreenVM(i: SleepScreenInput): SleepScreenVM {
  const { sleep, clock, cfg } = i;
  const est = wakeEstimate(sleep, i.fatigue, i.tick, clock.ticksPerGameMinute, cfg);
  const now = absMinute(clock);
  const start = now - est.elapsedMin;
  const wake = now + est.remainingMin;
  const wakeLabel = `${formatClock(wake)} · Dzień ${dayOf(wake)}`;
  const total = est.elapsedMin + est.remainingMin;
  const safe = i.threat <= 0;
  const restNow = Math.round(sleep.restGained);
  const left = Math.max(0, sleep.saveAfterRealSec - sleep.realSec);
  return {
    title: `Śpisz · ${SURFACE_NAME[sleep.surface]}`,
    subtitle: `Limit odpoczynku ${Math.round(sleep.restCap)} · zapis po ${formatRealSec(sleep.saveAfterRealSec)} snu`,
    safe,
    safeText: safe
      ? `Bezpiecznie · brak zombie w ${cfg.wakeOnZombieTiles} m`
      : 'Zagrożenie · zombie w pobliżu',
    real: {
      text: formatRealSec(Math.min(sleep.realSec, sleep.saveAfterRealSec)),
      total: `/ ${formatRealSec(sleep.saveAfterRealSec)}`,
      pct: Math.min(1, sleep.realSec / Math.max(1, sleep.saveAfterRealSec)),
    },
    game: {
      time: formatClock(now),
      ratio: `×${gameSpeedRatio(clock)}`,
      from: formatClock(start),
      to: wakeLabel,
      pct: total > 0 ? Math.min(1, est.elapsedMin / total) : 1,
    },
    save: sleep.saveReady
      ? {
          ready: true,
          title: 'Gra zapisana',
          detail: 'możesz spać dalej lub wstać bez utraty zapisu',
        }
      : {
          ready: false,
          title: `Zapis gry po ${formatRealSec(sleep.saveAfterRealSec)} nieprzerwanego snu`,
          detail: `jeszcze ${formatRealSec(left)} · hałas lub zombie przerywa odliczanie`,
        },
    rows: [
      {
        label: 'Zmęczenie',
        value: `${Math.round(est.fatigueStart)} → ${Math.round(est.fatigueEnd)}`,
        tone: 'accent',
      },
      {
        label: 'Zmęczenie teraz',
        value: String(Math.round(i.fatigue)),
        tone: 'accent',
        bar: Math.min(1, Math.max(0, i.fatigue / 100)),
      },
      {
        label: `Limit ${SURFACE_GEN[sleep.surface]}`,
        value: `−${Math.round(sleep.restCap)}`,
        tone: 'danger',
      },
      {
        label: 'Głód i pragnienie',
        value: `${signed(i.hungerGain)} / ${signed(i.thirstGain)}`,
        tone: 'warn',
        note: 'od zaśnięcia',
      },
      { label: 'Pobudka', value: wakeLabel, tone: 'accent' },
    ],
    wakeNote: sleep.saveReady
      ? { text: `✓ gra zapisana · odpoczynek −${restNow}`, tone: 'ok' }
      : { text: `▲ bez zapisu, odpoczynek częściowy (−${restNow} teraz)`, tone: 'warn' },
    speed: clock.timeScale ?? 1,
    speedBlocked: clock.fastForwardBlocked,
  };
}
