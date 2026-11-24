import { describe, expect, it } from 'vitest';
import type { SimEvent, WoundView } from '@deadzone/protocol';
import { INITIAL_GAME_STATE, type GameState } from '../state/game-state.js';
import type { HudContentIndex, HudItemDef } from '../hud/content-index.js';
import {
  Journal,
  JOURNAL_MAX,
  characterVM,
  journalText,
  journalTime,
  medicalTargetPart,
  skillsVM,
  woundRejectText,
} from './character-model.js';

const wound = (w: Partial<WoundView>): WoundView => ({
  part: 'forearm_l',
  wound: 'laceration',
  bleeding: 0,
  healed: 0,
  bandaged: false,
  bandageDirty: false,
  infected: false,
  ...w,
});

const item = (id: string, extra: Partial<HudItemDef>): HudItemDef => ({
  id,
  kind: 'medical',
  maxStack: 1,
  weightKg: 0.1,
  ...extra,
});

const content: HudContentIndex = {
  moodles: new Map(),
  items: new Map([
    ['base:bandage', item('base:bandage', { medical: ['stop_bleeding', 'heal_wound'] })],
    ['base:needle', item('base:needle', { kind: 'tool', tags: ['base:tool-needle'] })],
    ['base:thread', item('base:thread', { kind: 'material', tags: ['base:thread'] })],
  ]),
};

function state(over: Partial<GameState> = {}, carried: string[] = []): GameState {
  return {
    ...INITIAL_GAME_STATE,
    inventory: {
      container: 1,
      loadKg: 0,
      capacityKg: 10,
      hardLimitKg: 20,
      carryLoad: 0,
      equipped: {},
      containers: {
        1: {
          id: 1,
          kind: 'inventory',
          capacityKg: null,
          weightKg: 0,
          items: carried.map((def, i) => ({ id: 10 + i, def, count: 1, weightKg: 0.1 })),
        },
      },
    },
    ...over,
  };
}

describe('character model', () => {
  it('shows stats with warnings, name, profession and traits', () => {
    const vm = characterVM(
      state({
        player: {
          ...INITIAL_GAME_STATE.player,
          stats: { health: 80, hunger: 75, thirst: 10, 'body-temperature-c': 36.64 },
        },
        characterProfile: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          appearance: { skin: 'a', parts: {} },
          profession: 'base:fisherman',
          traits: ['base:strong', 'base:brave'],
          skills: {},
          pointsLeft: 0,
        },
      }),
      content,
    );
    expect(vm.name).toBe('Jan Kowalski');
    expect(vm.profession).toBe('Rybak');
    expect(vm.stats.map((r) => [r.label, r.value, r.warn])).toEqual([
      ['Zdrowie', 80, false],
      ['Głód', 75, true],
      ['Pragnienie', 10, false],
    ]);
    expect(vm.temperatureC).toBe(36.6);
    expect(vm.traits.map((t) => t.name)).toEqual(['Odważny', 'Silny']);
  });

  it('groups wounds by part, worst first, with the treatments that make sense', () => {
    const s = state(
      {
        player: {
          ...INITIAL_GAME_STATE.player,
          wounds: [
            wound({ part: 'hand_r', wound: 'scratch', bleeding: 2, infected: true }),
            wound({ part: 'forearm_l', bleeding: 20 }),
            wound({ part: 'forearm_l', wound: 'scratch', bleeding: 5 }),
            wound({ part: 'head', wound: 'scratch', bandaged: true, disinfected: true }),
          ],
        },
      },
      ['base:bandage', 'base:needle'],
    );
    const rows = characterVM(s, content).wounds;
    expect(rows.map((r) => [r.partLabel, r.wounds, r.bleeding])).toEqual([
      ['Lewe przedramię', 'Rana cięta, Zadrapanie', 25],
      ['Prawa dłoń', 'Zadrapanie', 2],
      ['Głowa', 'Zadrapanie', 0],
    ]);
    const arm = rows[0]!.actions;
    expect(arm.map((a) => [a.id, a.ready])).toEqual([
      ['bandage', true],
      ['disinfect', false],
      ['stitch', false],
    ]);
    expect(arm[2]!.missing).toBe('Potrzebna nić');
    // A scratch is not stitched; an infected wound says so.
    expect(rows[1]!.actions.map((a) => a.id)).toEqual(['bandage', 'disinfect']);
    expect(rows[1]!.flags).toEqual(['zakażona']);
    // Bandaged and disinfected: nothing to do.
    expect(rows[2]!.actions).toEqual([]);
    expect(rows[2]!.flags).toEqual(['opatrzona', 'odkażona']);
  });

  it('lists every skill by group with progress to the next level', () => {
    const groups = skillsVM(
      state({
        skills: [
          { id: 'base:fishing', level: 2, xp: 30, next: 120 },
          { id: 'base:carpentry', level: 10, xp: 0, next: null },
          { id: 'mod:juggling', level: 1, xp: 0, next: 50 },
        ],
      }),
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Walka',
      'Przetrwanie',
      'Rzemiosło',
      'Ruch',
      'Inne',
    ]);
    const fishing = groups[1]!.skills.find((k) => k.id === 'base:fishing')!;
    expect(fishing).toMatchObject({ name: 'Wędkarstwo', level: 2, pct: 25, xpText: '30 / 120 XP' });
    expect(groups[2]!.skills.find((k) => k.id === 'base:carpentry')).toMatchObject({
      pct: 100,
      xpText: 'maks.',
    });
    expect(groups[0]!.skills.every((k) => k.level === 0)).toBe(true);
  });

  it('keeps a journal of the local player, newest first and capped', () => {
    const ev = (e: object) => ({ tick: 1, playerId: 1, ...e }) as SimEvent;
    const j = new Journal(1);
    expect(
      j.add(
        [
          ev({ type: 'wounded', part: 'shin_r', wound: 'bite' }),
          ev({ type: 'fished', caught: true }),
          ev({ type: 'fished', playerId: 2, caught: true }),
          ev({ type: 'moodleChanged', moodle: 'base:hunger', from: 0, to: 1 }),
        ],
        3,
        545,
      ),
    ).toBe(true);
    expect(j.entries.map((e) => e.text)).toEqual(['Złowiłem rybę', 'Ugryzienie: prawa goleń']);
    expect(journalTime(j.entries[0]!)).toBe('Dzień 3, 09:05');
    for (let i = 0; i < JOURNAL_MAX + 5; i++) j.add([ev({ type: 'fished', caught: false })], 3, i);
    expect(j.entries).toHaveLength(JOURNAL_MAX);
    expect(
      journalText(ev({ type: 'traitChanged', trait: 'base:overweight', gained: true }), 1),
    ).toBe('Nowa cecha: Otyły');
  });

  it('picks the wound to bandage from the inventory and words rejections', () => {
    expect(medicalTargetPart([])).toBeUndefined();
    expect(
      medicalTargetPart([
        wound({ part: 'head', bleeding: 30, bandaged: true }),
        wound({ part: 'thigh_l', bleeding: 4 }),
        wound({ part: 'foot_r', bleeding: 9 }),
      ]),
    ).toBe('foot_r');
    expect(medicalTargetPart([wound({ part: 'head', bandaged: true })])).toBe('head');
    expect(woundRejectText('missing-tool')).toBe('Potrzebna igła');
    expect(woundRejectText('weird')).toBe('Teraz się nie da');
  });
});
