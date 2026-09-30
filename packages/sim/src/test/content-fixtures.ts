import { buildContentBundle, type ContentBundle, type PackSource } from '@deadzone/content';
import { BASE_PACK_DIR, readPackDir } from '@deadzone/content/node';
import type { Command, SimContentPack } from '@deadzone/protocol';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { buildMap } from './fixtures.js';

const level = (enterAt: number, exitAt: number, modifiers: unknown[] = []) => ({
  label: 'moodle.fixture.level',
  enterAt,
  exitAt,
  modifiers,
});

/**
 * Small fixture pack (docs 8.2: tests do not depend on the real game balance): default
 * `worldSettings` from the schemas plus a few moodles and a bandage.
 */
export function fixturePack(worldSettings: object = {}): SimContentPack {
  return {
    dir: 'fixture',
    files: [
      { path: 'mod.json', json: { id: 'fixture', name: 'Fixture', version: '0.0.0' } },
      { path: 'world-settings.json', json: worldSettings },
      {
        path: 'moodles/hunger.json',
        json: {
          id: 'fixture:hunger',
          name: 'moodle.fixture.hunger',
          polarity: 'negative',
          maxLevel: 2,
          stat: 'hunger',
          levels: [level(25, 20), level(50, 45)],
        },
      },
      {
        path: 'moodles/fatigue.json',
        json: {
          id: 'fixture:fatigue',
          name: 'moodle.fixture.fatigue',
          polarity: 'negative',
          maxLevel: 2,
          stat: 'fatigue',
          levels: [level(45, 40), level(80, 75, [{ stat: 'move-speed', op: 'mul', value: 0.5 }])],
        },
      },
      {
        path: 'moodles/bleeding.json',
        json: {
          id: 'fixture:bleeding',
          name: 'moodle.fixture.bleeding',
          polarity: 'negative',
          maxLevel: 1,
          stat: 'bleeding',
          levels: [level(5, 2)],
        },
      },
      {
        path: 'moodles/cold.json',
        json: {
          id: 'fixture:cold',
          name: 'moodle.fixture.cold',
          polarity: 'negative',
          maxLevel: 2,
          stat: 'body-temperature-c',
          direction: 'falling',
          levels: [level(36, 36.3), level(35, 35.3)],
        },
      },
      {
        path: 'moodles/carry.json',
        json: {
          id: 'fixture:carry',
          name: 'moodle.fixture.carry',
          polarity: 'negative',
          maxLevel: 1,
          stat: 'carry-load',
          levels: [level(100, 97)],
        },
      },
      {
        path: 'items/medical.json',
        json: [
          {
            id: 'fixture:bandage',
            name: 'item.fixture.bandage',
            kind: 'medical',
            weightKg: 0.05,
            medical: { effects: ['stop_bleeding'], durationMin: 3 },
          },
          {
            id: 'fixture:pills',
            name: 'item.fixture.pills',
            kind: 'medical',
            weightKg: 0.05,
            medical: { effects: ['pain_relief'], durationMin: 1 },
          },
        ],
      },
    ],
  };
}

export const fixtureContent = (worldSettings: object = {}): ContentBundle =>
  buildContentBundle([
    { ...fixturePack(worldSettings), files: [...fixturePack(worldSettings).files] },
  ]);

let base: Promise<ContentBundle> | undefined;
/** The real base pack (only for the Stage 2 acceptance tests). */
export function baseContent(): Promise<ContentBundle> {
  base ??= readPackDir(BASE_PACK_DIR).then((p: PackSource) => buildContentBundle([p]));
  return base;
}

/** 60-minute day → 50 ticks per game minute. */
export const TICKS_PER_MIN = 50;

export function survivalSim(
  content: ContentBundle = fixtureContent(),
  opts: Partial<SimOptions> = {},
): Sim {
  return createSim({
    seed: 7,
    map: buildMap(),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    ...opts,
  });
}

let seq = 1_000_000;
type Payload = Command extends infer C
  ? C extends Command
    ? Omit<C, 'tick' | 'playerId' | 'seq'>
    : never
  : never;

/** Enqueues a command for the current tick (throws when the queue rejects it structurally). */
export function send(sim: Sim, payload: Payload, playerId = 0): void {
  const r = sim.enqueue({ ...payload, tick: sim.tick, playerId, seq: seq++ });
  if (!r.ok) throw new Error(`rejected: ${r.reason} ${r.error ?? ''}`);
}

export const runMinutes = (sim: Sim, minutes: number): void => {
  for (let i = 0; i < minutes * TICKS_PER_MIN; i++) sim.step();
};
