import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import { saveWoundCareSchema, treatWoundCommandSchema } from '@deadzone/protocol/schema';
import { describe, expect, it } from 'vitest';
import { fixturePack, runMinutes, send } from '../test/content-fixtures.js';
import { findItem, itemsSim, rejectedReasons } from '../test/item-fixtures.js';
import type { Sim } from '../sim.js';

/** Fixture pack + wound-care items (own file: the shared fixture index order stays). */
function content(wounds: Record<string, unknown> = {}): ContentBundle {
  const pack = fixturePack({ survival: { wounds } });
  return buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files,
        {
          path: 'items/wound-care.json',
          json: [
            {
              id: 'fixture:peroxide',
              name: 'item.fixture.peroxide',
              kind: 'medical',
              weightKg: 0.2,
              medical: { effects: ['disinfect'], potency: 0.8, durationMin: 1, uses: 3 },
            },
            {
              id: 'fixture:sterile-bandage',
              name: 'item.fixture.sterile-bandage',
              kind: 'medical',
              weightKg: 0.05,
              medical: { effects: ['stop_bleeding', 'disinfect'], potency: 0.5, durationMin: 0.01 },
            },
            {
              id: 'fixture:spirit',
              name: 'item.fixture.spirit',
              kind: 'drink',
              weightKg: 0.5,
              tags: ['base:disinfectant-liquid'],
              drink: { perUse: { thirst: -1 }, uses: 4, drinkMin: 0.3 },
            },
            {
              id: 'fixture:needle',
              name: 'item.fixture.needle',
              kind: 'tool',
              weightKg: 0.01,
              tags: ['base:tool-needle'],
              tool: {},
            },
            {
              id: 'fixture:thread',
              name: 'item.fixture.thread',
              kind: 'material',
              weightKg: 0.01,
              maxStack: 20,
              tags: ['base:thread'],
            },
          ],
        },
      ],
    },
  ]);
}

const wounds = (sim: Sim) =>
  sim.world.survival!.wounds.get(sim.world.c.StableId.value[sim.world.players.get(0)!]!)!;
const views = (sim: Sim) => sim.getSurvival()!.wounds;
const treated = (sim: Sim) => sim.drainEvents().filter((e) => e.type === 'woundTreated');

function setup(cfg: Record<string, unknown> = {}, wound: 'scratch' | 'laceration' = 'laceration') {
  const sim = itemsSim(content(cfg));
  send(sim, { type: 'debugWound', part: 'hand_l', wound });
  sim.step();
  return sim;
}

describe('wound care: disinfect (stage 3)', () => {
  it('hydrogen peroxide via useItem: infection cured, protected, wound smaller; one use', () => {
    const sim = setup({
      disinfect: { protectMin: 5 },
      dirtInfection: { unbandagedChancePerMin: 1 },
    });
    runMinutes(sim, 1.2);
    expect(views(sim)[0]!.infected).toBe(true);
    const before = wounds(sim)[0]!.healed;
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:peroxide' });
    sim.step();
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:peroxide')!.id, part: 'hand_l' });
    sim.drainEvents();
    runMinutes(sim, 1.4);
    expect(treated(sim)).toEqual([
      expect.objectContaining({
        treatment: 'disinfect',
        part: 'hand_l',
        item: 'fixture:peroxide',
        success: true,
      }),
    ]);
    const wd = wounds(sim)[0]!;
    expect(wd.dirt).toBe(false);
    expect(wd.healed).toBeGreaterThanOrEqual(before + 0.08 - 1e-6);
    expect(views(sim)[0]).toMatchObject({ infected: false, disinfected: true });
    expect(findItem(sim, 'fixture:peroxide')!.uses).toBe(2);
    // Protected for `protectMin`, then the dirt can come back.
    runMinutes(sim, 3);
    expect(wounds(sim)[0]!.dirt).toBe(false);
    runMinutes(sim, 3);
    expect(wounds(sim)[0]!.dirt).toBe(true);
    expect(views(sim)[0]!.disinfected).toBeUndefined();
  });

  it('treatWound picks a carried disinfectant liquid (vodka); missing item / no wound rejected', () => {
    const sim = setup();
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'disinfect' });
    send(sim, { type: 'treatWound', part: 'shin_r', treatment: 'disinfect' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['missing-item', 'invalid-target']);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:spirit' });
    sim.step();
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'disinfect' });
    sim.step();
    runMinutes(sim, 1.4);
    expect(treated(sim)[0]).toMatchObject({ item: 'fixture:spirit', success: true });
    expect(findItem(sim, 'fixture:spirit')!.uses).toBe(3);
    expect(wounds(sim)[0]!.cleanUntilAge).toBeGreaterThan(0);
  });

  it('a sterile bandage (stop_bleeding + disinfect) dresses and disinfects', () => {
    const sim = setup();
    wounds(sim)[0]!.dirt = true;
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:sterile-bandage' });
    sim.step();
    send(sim, {
      type: 'useItem',
      item: findItem(sim, 'fixture:sterile-bandage')!.id,
      part: 'hand_l',
    });
    runMinutes(sim, 0.1);
    expect(views(sim)[0]).toMatchObject({ bandaged: true, infected: false, disinfected: true });
  });
});

describe('wound care: stitching', () => {
  it('needle + thread; success stitches (less bleeding), thread used up', () => {
    const sim = setup({ stitch: { chance: 1 } });
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    sim.step();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:needle' });
    sim.step();
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['missing-tool', 'missing-item']);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:thread', count: 2 });
    sim.step();
    const bleeding = views(sim)[0]!.bleeding;
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    runMinutes(sim, 10);
    expect(treated(sim)).toEqual([expect.objectContaining({ treatment: 'stitch', success: true })]);
    expect(views(sim)[0]!.stitched).toBe(true);
    expect(views(sim)[0]!.bleeding).toBeLessThan(bleeding * 0.2);
    expect(findItem(sim, 'fixture:thread')!.count).toBe(1);
    expect(findItem(sim, 'fixture:needle')).toBeDefined();
    // Already stitched: nothing left to stitch.
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
  });

  it('a failed stitch hurts and still uses the thread; scratches are not stitched', () => {
    const sim = setup({ stitch: { chance: 0, chancePerLevel: 0 } });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:needle' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:thread' });
    sim.step();
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    runMinutes(sim, 10);
    expect(treated(sim)[0]).toMatchObject({ success: false });
    expect(views(sim)[0]!.stitched).toBeUndefined();
    expect(findItem(sim, 'fixture:thread')).toBeUndefined();
    const s2 = setup({}, 'scratch');
    send(s2, { type: 'debugGiveItem', itemId: 'fixture:needle' });
    send(s2, { type: 'debugGiveItem', itemId: 'fixture:thread' });
    s2.step();
    send(s2, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    s2.step();
    expect(rejectedReasons(s2)).toEqual(['invalid-target']);
  });

  it('save → load keeps stitched / cleanUntilAge (same hash); schemas accept them', () => {
    const sim = setup({ stitch: { chance: 1 } });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:needle' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:thread' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:peroxide' });
    sim.step();
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'stitch' });
    send(sim, { type: 'treatWound', part: 'hand_l', treatment: 'disinfect' });
    runMinutes(sim, 13);
    const wd = wounds(sim)[0]!;
    expect(wd.stitched).toBe(true);
    expect(wd.cleanUntilAge).toBeGreaterThan(0);
    const back = itemsSim(content({ stitch: { chance: 1 } }), { load: sim.save() });
    expect(wounds(back)[0]).toMatchObject({ stitched: true, cleanUntilAge: wd.cleanUntilAge });
    expect(back.hash()).toBe(sim.hash());
    expect(saveWoundCareSchema.parse({ stitched: true, cleanUntilAge: 730 })).toBeTruthy();
    expect(
      treatWoundCommandSchema.safeParse({
        type: 'treatWound',
        tick: 0,
        playerId: 0,
        seq: 0,
        part: 'hand_l',
        treatment: 'stitch',
      }).success,
    ).toBe(true);
  });
});
