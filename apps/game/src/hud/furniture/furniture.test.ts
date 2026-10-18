import { describe, expect, it } from 'vitest';
import type { ContainerView, FurnitureView } from '@deadzone/protocol';
import { INITIAL_GAME_STATE, type GameState } from '../../state/game-state.js';
import type { CommandBody } from '../../sim/sim-client.js';
import { EMPTY_HUD_CONTENT, type HudContentIndex } from '../content-index.js';
import { DEFAULT_SLEEP_SETTINGS } from '../sleep-settings.js';
import { FURNITURE_FEATURES, hiddenByFeature } from './furniture-api.js';
import {
  actionDurationLabel,
  durationLabel,
  furnitureIcon,
  furnitureMenuVM,
  furnitureName,
  fridgeVM,
  reasonIcon,
  reasonText,
  sleepChoiceVM,
  stepSelection,
  watchVM,
} from './furniture-model.js';
import { SimFurnitureSource } from './sim-source.js';
import { sleepEntries } from './sleep-entries.js';

const def = (id: string, extra: object) => ({
  id,
  kind: 'placeable',
  maxStack: 1,
  weightKg: 1,
  ...extra,
});
const content: HudContentIndex = {
  ...EMPTY_HUD_CONTENT,
  items: new Map([
    ['base:bed', def('base:bed', { sleepSurface: 'bed' })],
    ['base:sofa', def('base:sofa', { sleepSurface: 'sofa' })],
    ['base:tv', def('base:tv', { tv: true })],
    [
      'base:vhs-cooking',
      def('base:vhs-cooking', {
        kind: 'vhs',
        vhs: { skills: [{ skill: 'base:cooking', xp: 75 }], watchSec: 30, once: true },
      }),
    ],
  ]),
};

const inv = (items: ContainerView['items']): NonNullable<GameState['inventory']> => ({
  container: 1,
  loadKg: 0,
  capacityKg: 14,
  hardLimitKg: 20,
  carryLoad: 0,
  equipped: {},
  containers: { 1: { id: 1, kind: 'inventory', capacityKg: null, weightKg: 0, items } },
});

const state = (s: Partial<GameState> = {}, fatigue = 50): GameState => ({
  ...INITIAL_GAME_STATE,
  tick: 100,
  player: { ...INITIAL_GAME_STATE.player, alive: true, stats: { fatigue } },
  ...s,
});

/** A locked door as the sim sends it (protocol 26, `furniture/menu.ts`). */
const lockedDoor: FurnitureView = {
  furnitureId: 4242,
  typeId: 'door',
  x: 12,
  y: 10.5,
  z: 0,
  actions: [
    {
      id: 'open',
      labelPl: 'Otwórz',
      enabled: false,
      reason: 'locked',
      reasonPl: 'Zamknięte na klucz',
    },
    { id: 'unlock-key', labelPl: 'Otwórz kluczem', enabled: false, reason: 'no-key' },
    {
      id: 'lockpick:31',
      labelPl: 'Użyj wytrycha',
      enabled: true,
      durationMin: 0.5,
      chancePct: 40,
      breakChancePct: 18,
      noiseTiles: 2,
      item: { id: 31, def: 'base:lockpick' },
    },
    {
      id: 'lockpick:32',
      labelPl: 'Użyj wytrycha',
      enabled: true,
      durationMin: 0.5,
      chancePct: 40,
      breakChancePct: 18,
      noiseTiles: 2,
      item: { id: 32, def: 'base:bobby-pin' },
    },
    {
      id: 'force-pry',
      labelPl: 'Wyważ łomem',
      enabled: false,
      reason: 'missing-tool',
      reasonPl: 'Brak łomu',
    },
    {
      id: 'force-kick',
      labelPl: 'Wyważ kopniakiem',
      enabled: true,
      durationMin: 0.1,
      chancePct: 25,
      noiseTiles: 18,
    },
    { id: 'knock', labelPl: 'Zapukaj', enabled: true, noiseTiles: 6 },
    {
      id: 'barricade',
      labelPl: 'Zabarykaduj',
      enabled: false,
      reason: 'missing-tool',
      reasonPl: 'Brak młotka',
    },
  ],
};

const fridge: FurnitureView = {
  furnitureId: 2 ** 42 + 100,
  typeId: 'fridge',
  contentId: 'base:fridge-freezer',
  x: 14.5,
  y: 10.5,
  z: 0,
  actions: [
    { id: 'open-storage', labelPl: 'Przeszukaj', enabled: true, durationMin: 0.05 },
    { id: 'open-storage:88', labelPl: 'Przeszukaj: zamrażarka', enabled: true, durationMin: 0.05 },
  ],
};

describe('feature flags', () => {
  it('hides freezer, radio, sleep length and generator while the sim lacks them', () => {
    expect(FURNITURE_FEATURES).toEqual({
      freezer: false,
      radio: false,
      sleepDuration: false,
      generator: false,
    });
    for (const id of [
      'open-freezer',
      'Otwórz: zamrażarka',
      'listen-radio',
      'sleep-8h',
      'sleep-until-morning',
      'start-generator',
    ])
      expect(hiddenByFeature(id)).toBe(true);
    for (const id of ['open', 'open-storage', 'sleep', 'watch', 'insert-tape:5', 'knock'])
      expect(hiddenByFeature(id)).toBe(false);
    expect(hiddenByFeature('listen-radio', { ...FURNITURE_FEATURES, radio: true })).toBe(false);
  });
});

describe('menu model (sim data, generic over typeId)', () => {
  it('names from content (FURNITURE_TYPES_PL), else the object name, icons by type', () => {
    expect(furnitureName('fridge', 'base:fridge-freezer')).toBe('Lodówka');
    expect(furnitureName('door')).toBe('Drzwi');
    expect(furnitureName('window')).toBe('Okno');
    expect(furnitureName('gate')).toBe('Furtka');
    expect(furnitureName('sofa', 'base:sofa')).toBe('Kanapa');
    expect(furnitureName('garden-hose')).toBe('Garden hose');
    expect(furnitureIcon('window')).toBe('window');
    expect(furnitureIcon('gate')).toBe('door');
    expect(furnitureIcon('bath')).toBe('water');
    expect(furnitureIcon('base:mystery')).toBe('box');
  });

  it('locked door: lockpicks grouped in a submenu with odds, greyed rows with reasons', () => {
    const vm = furnitureMenuVM(lockedDoor, {
      state: state(),
      content,
      player: { x: 12.5, y: 11.7 },
    });
    expect(vm.title).toBe('Drzwi');
    expect(vm.dist).toBe('1,3 m');
    expect(vm.rows.map((r) => [r.id, r.enabled, r.right])).toEqual([
      ['open', false, 'Zamknięte na klucz'],
      ['unlock-key', false, 'Brak klucza do tego budynku'],
      ['lockpick', true, '2 ›'],
      ['force-pry', false, 'Brak łomu'],
      ['force-kick', true, '6 s'],
      ['knock', true, ''],
      ['barricade', false, 'Brak młotka'],
    ]);
    const pick = vm.rows[2]!;
    expect(pick).toMatchObject({
      label: 'Użyj wytrycha',
      submenu: true,
      subTitle: 'UŻYJ WYTRYCHA',
    });
    expect(pick.extras.map((e) => e.text)).toEqual(['szansa 40%', 'złamanie 18%', 'hałas 2 m']);
    expect(pick.children!.map((c) => [c.actionId, c.def, c.detail])).toEqual([
      ['lockpick:31', 'base:lockpick', 'szansa 40% · złamanie 18% · hałas 2 m · 30 s'],
      ['lockpick:32', 'base:bobby-pin', 'szansa 40% · złamanie 18% · hałas 2 m · 30 s'],
    ]);
    expect(vm.rows[0]!.reasonIcon).toBe('lock');
    expect(vm.rows[1]!.reasonIcon).toBe('key');
    expect(vm.rows[3]!.reasonIcon).toBe('tool');
    expect(vm.pills.map((p) => p.text)).toEqual(['ZAMKNIĘTE']);
  });

  it('window: injury chance shown like the other odds', () => {
    const vm = furnitureMenuVM(
      {
        furnitureId: 77,
        typeId: 'window',
        x: 3,
        y: 4.5,
        z: 0,
        actions: [
          {
            id: 'smash',
            labelPl: 'Rozbij',
            enabled: true,
            durationMin: 0.05,
            noiseTiles: 20,
            injuryChancePct: 30,
          },
          {
            id: 'climb-through',
            labelPl: 'Wejdź przez okno',
            enabled: false,
            reason: 'invalid-state',
          },
        ],
      },
      { state: state(), content },
    );
    expect(vm.rows[0]!.extras.map((e) => [e.text, e.tone])).toEqual([
      ['zranienie 30%', 'warn'],
      ['hałas 20 m', 'warn'],
    ]);
    expect(vm.rows[1]!.right).toBe('Niedostępne teraz');
  });

  it('storage: sim label as is, freezer compartment hidden; BRAK PRĄDU from utilities', () => {
    const vm = furnitureMenuVM(fridge, {
      state: state(),
      content,
      utilities: { power: false, water: true, powerSource: null },
    });
    expect(vm.rows.map((r) => r.label)).toEqual(['Przeszukaj']);
    expect(vm.pills).toEqual([{ icon: 'bolt', text: 'BRAK PRĄDU', tone: 'bad' }]);
    expect(
      furnitureMenuVM(fridge, {
        state: state(),
        content,
        utilities: { power: true, water: true, powerSource: 'grid' },
      }).pills,
    ).toEqual([]);
    expect(
      furnitureMenuVM(lockedDoor, {
        state: state(),
        content,
        utilities: { power: false, water: false, powerSource: null },
      }).pills.map((p) => p.text),
    ).toEqual(['ZAMKNIĘTE']);
  });

  it('TV: tapes from the sim (insert-tape:<id>) in the VHS submenu with skill XP', () => {
    const tv: FurnitureView = {
      furnitureId: 2 ** 42 + 5,
      typeId: 'tv',
      contentId: 'base:tv',
      x: 11.5,
      y: 11.5,
      z: 0,
      actions: [
        { id: 'watch', labelPl: 'Oglądaj', enabled: true, durationMin: 30 },
        {
          id: 'insert-tape:42',
          labelPl: 'insert-tape',
          enabled: true,
          durationMin: 0.5,
          item: { id: 42, def: 'base:vhs-cooking' },
        },
      ],
    };
    const vm = furnitureMenuVM(tv, { state: state(), content });
    expect(vm.title).toBe('Telewizor');
    expect(vm.rows[1]).toMatchObject({
      id: 'insert-tape',
      label: 'Włóż kasetę',
      submenu: true,
      right: '1 w ekwipunku ›',
      subTitle: 'KASETY VHS',
    });
    expect(vm.rows[1]!.children![0]).toMatchObject({
      actionId: 'insert-tape:42',
      detail: 'Gotowanie +75 XP · 30 s',
      watched: false,
    });
    const seen = furnitureMenuVM(tv, {
      state: state(),
      content,
      watched: new Set(['base:vhs-cooking']),
    });
    expect(seen.rows[1]!.children![0]!.detail).toBe('obejrzane · bez XP · 30 s');
  });

  it('durations: real seconds (durationSec) for short actions, game time only for long ones', () => {
    // Window smash 0.4 game min = 1 s real (old bug: 0.4 × 60 = 24 s), kick 0.48 = 1,2 s.
    expect(actionDurationLabel({ durationMin: 0.4, durationSec: 1 })).toBe('1 s');
    expect(actionDurationLabel({ durationMin: 0.48, durationSec: 1.2 })).toBe('1,2 s');
    expect(actionDurationLabel({ durationMin: 3, durationSec: 7.5 })).toBe('7,5 s');
    // TV / sleep: game time.
    expect(actionDurationLabel({ durationMin: 30, durationSec: 75 })).toBe('30 min');
    expect(actionDurationLabel({ durationMin: 480, durationSec: 1200 })).toBe('8 h');
    // Older sims without durationSec; instant actions.
    expect(actionDurationLabel({ durationMin: 30 })).toBe('30 min');
    expect(actionDurationLabel({})).toBe('');
    const win = furnitureMenuVM(
      {
        furnitureId: 7,
        typeId: 'window',
        x: 1,
        y: 1,
        actions: [
          { id: 'smash', labelPl: 'Rozbij', enabled: true, durationMin: 0.4, durationSec: 1 },
          {
            id: 'force-kick',
            labelPl: 'Wyważ kopniakiem',
            enabled: true,
            durationMin: 0.48,
            durationSec: 1.2,
          },
        ],
      } as never,
      { state: state(), content },
    );
    expect(win.rows.map((r) => r.right)).toEqual(['1 s', '1,2 s']);
  });

  it('keyboard selection skips disabled rows and wraps', () => {
    const rows = [{ enabled: true }, { enabled: false }, { enabled: true }];
    expect(stepSelection(rows, 0, 1)).toBe(2);
    expect(stepSelection(rows, 2, 1)).toBe(0);
    expect(stepSelection(rows, 0, -1)).toBe(2);
    expect(stepSelection([{ enabled: false }], 0, 1)).toBe(-1);
  });

  it('helpers: durations, every reason code has an icon and a content text', () => {
    expect(durationLabel(30)).toBe('30 min');
    expect(durationLabel(120)).toBe('2 h');
    expect(durationLabel(0.025)).toBe('1,5 s');
    expect(reasonIcon('threat')).toBe('zombie');
    expect(reasonIcon('no-key')).toBe('key');
    expect(reasonIcon('whatever')).toBe('ban');
    expect(reasonText({ reason: 'no-water' })).toBe('Brak wody w sieci');
    expect(reasonText({ reason: 'threat', reasonPl: 'Zombie 5 m' })).toBe('Zombie 5 m');
  });
});

describe('sim source', () => {
  const sofa = { contentId: 'base:sofa', tx: 10, ty: 10, z: 0 };
  function source(list: FurnitureView[], s = state(), sent: unknown[] = []) {
    return new SimFurnitureSource({
      list: () => list,
      useFurniture: (...a) => sent.push(a),
      local: sleepEntries({
        state: () => s,
        content: () => content,
        objects: () => [sofa, { contentId: 'base:bed', tx: 40, ty: 10, z: 0 }],
        player: () => ({ x: 11.5, y: 10.5, z: 0 }),
        send: (c: CommandBody) => sent.push(c),
      }),
    });
  }

  it('picks the entry under the cursor: edge centre or object tile, nothing elsewhere', () => {
    const src = source([lockedDoor, fridge]);
    expect(src.at(12.1, 10.3, 0)?.furnitureId).toBe(4242);
    expect(src.at(14.4, 10.9, 0)?.furnitureId).toBe(fridge.furnitureId);
    expect(src.at(13.2, 12.5, 0)).toBeUndefined();
    expect(src.at(12.1, 10.3, 1)).toBeUndefined();
    expect(src.byId(4242)).toBe(lockedDoor);
  });

  it('footprint: a 2×1 object is picked on its second tile too', () => {
    const wide = { ...fridge, furnitureId: 5, x: 20.5, y: 5.5 };
    const plain = new SimFurnitureSource({ list: () => [wide], useFurniture: () => {} });
    expect(plain.at(21.6, 5.5, 0)).toBeUndefined();
    const fp = new SimFurnitureSource({
      list: () => [wide],
      useFurniture: () => {},
      footprint: () => [
        { x: 20, y: 5 },
        { x: 21, y: 5 },
      ],
    });
    expect(fp.at(21.6, 5.5, 0)?.furnitureId).toBe(5);
  });

  it('runs sim entries with useFurniture, beds / sofas with the sleep command', () => {
    const sent: unknown[] = [];
    const src = source([lockedDoor], state(), sent);
    src.use(lockedDoor, 'lockpick:31');
    const bed = src.at(10.5, 10.5, 0)!;
    expect(bed).toMatchObject({ typeId: 'sofa', contentId: 'base:sofa' });
    expect(bed.actions[0]).toMatchObject({ id: 'sleep', enabled: true });
    src.use(bed, 'sleep');
    expect(sent).toEqual([[4242, 'lockpick:31'], { type: 'sleep' }]);
    // The far bed is not listed (out of reach).
    expect(src.at(40.5, 10.5, 0)).toBeUndefined();
  });

  it('sleep entry: greyed with content reasons (not tired, threat)', () => {
    expect(source([], state({}, 10)).at(10.5, 10.5, 0)!.actions[0]).toMatchObject({
      enabled: false,
      reason: 'not-tired',
      reasonPl: 'Nie jesteś zmęczony',
    });
    expect(source([], state({ threat: 40 })).at(10.5, 10.5, 0)!.actions[0]).toMatchObject({
      enabled: false,
      reason: 'threat',
      reasonPl: 'Zombie w pobliżu',
    });
  });
});

describe('fridge, watch and sleep models', () => {
  it('fridge: freshness bars, rotten list, capacity', () => {
    const c: ContainerView = {
      id: 7,
      kind: 'world',
      type: 'base:fridge',
      x: 12,
      y: 10,
      z: 0,
      capacityKg: 35,
      weightKg: 3.4,
      items: [
        { id: 1, def: 'base:milk', count: 1, weightKg: 1, freshness: 'stale' },
        { id: 2, def: 'base:apple', count: 3, weightKg: 0.6, freshness: 'rotten' },
        { id: 3, def: 'base:canned-beans', count: 2, weightKg: 0.9 },
        { id: 4, def: 'base:meat', count: 1, weightKg: 0.5, frozen: true, freshness: 'fresh' },
        { id: 5, def: 'base:fish', count: 1, weightKg: 0.4, frozen: true, thawMin: 80 },
      ],
    };
    const f = fridgeVM(c, { power: false });
    expect(f.section).toBe('CHŁODZIARKA');
    expect(f.rows.map((r) => r.fresh?.label)).toEqual([
      'Nieświeże',
      'Zepsute',
      undefined,
      'Zamrożone',
      'Rozmraża się · 1 h 20 min',
    ]);
    expect(f.rows[4]!.fresh!.tone).toBe('ice');
    expect(f.rotten).toEqual([2]);
    expect(f.capacity.label).toBe('3,4 / 35,0 kg');
    expect(f.pills[0]!.text).toBe('BRAK PRĄDU');
    expect(f.spoilNote).toBe('Psucie teraz ×1,0 / z prądem ×0,3');
    expect(fridgeVM(c, {}).pills).toEqual([]);
  });

  it('watch panel: tape title, progress, XP and the vhs effects', () => {
    const s = state({
      tick: 300,
      inventory: inv([{ id: 42, def: 'base:vhs-cooking', count: 1, weightKg: 0.25 }]),
      action: { kind: 'watch', startTick: 0, endTick: 600, item: 42, queued: 0 },
    });
    const w = watchVM(s, content, { tick: 300, tickMs: 50, surface: 'sofa', watched: new Set() })!;
    expect(w.kicker).toBe('OGLĄDANIE · KANAPA');
    expect(w.elapsed).toBe('0:15');
    expect(w.total).toBe('0:30');
    expect(w.skills[0]).toMatchObject({ name: 'Gotowanie', xp: '+75 XP' });
    expect(w.effects.map((e) => e.value)).toEqual(['+8', '−30', '−15']);
    expect(
      watchVM(state(), content, { tick: 0, tickMs: 50, surface: 'sofa', watched: new Set() }),
    ).toBeUndefined();
  });

  it('sleep choice: cards, estimate, blocked by threat or low fatigue', () => {
    const cfg = DEFAULT_SLEEP_SETTINGS;
    const clock = {
      day: 12,
      minuteOfDay: 22 * 60 + 50,
      ticksPerGameMinute: 50,
      minuteStartTick: 0,
      fastForwardBlocked: false,
    };
    const ok = sleepChoiceVM(state({ clock }, 64), cfg, { here: 'bed', nearby: new Set(['bed']) });
    expect(ok.title).toBe('ŚPIJ · ŁÓŻKO');
    expect(ok.cards.map((c) => [c.name, Math.round(c.quality * 100), c.cap, c.note])).toEqual([
      ['Łóżko', 100, 50, 'TERAZ'],
      ['Kanapa', 75, 35, 'brak'],
      ['Podłoga', 50, 25, 'zawsze'],
    ]);
    expect(ok.rows[0]!.value).toBe('64 → 14');
    expect(ok.canSleep).toBe(true);
    const threat = sleepChoiceVM(state({ clock, threat: 30 }, 64), cfg, {
      here: 'bed',
      nearby: new Set(),
    });
    expect(threat).toMatchObject({
      canSleep: false,
      blocked: 'Nie możesz spać · zombie w pobliżu',
    });
    expect(
      sleepChoiceVM(state({ clock }, 10), cfg, { here: 'sofa', nearby: new Set() }).canSleep,
    ).toBe(false);
  });
});
