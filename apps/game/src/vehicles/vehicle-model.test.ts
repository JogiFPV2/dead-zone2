import type { ItemView, SnapshotVehicle, VehicleStateView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { buildHudContentIndex } from '../hud/content-index.js';
import {
  carPanelVM,
  damageCount,
  defaultItem,
  distToBody,
  tapHitsCar,
  doorPoint,
  fullTankPlan,
  fuelVM,
  hotwireChance,
  menuItems,
  nextFullStep,
  nextRepairable,
  partHp,
  pickTarget,
  pumpSource,
  rejectToast,
  repairRows,
  sectionSummary,
  speedLabel,
  trunkPoint,
  vehicleTypeName,
  type MenuCtx,
} from './vehicle-model.js';

const content = buildHudContentIndex([
  {
    path: 'world-settings/vehicles.json',
    json: {
      vehicles: {
        enterSec: 1.5,
        exitSec: 1,
        keyItem: 'base:car-key',
        trunkReachTiles: 1.5,
        hotwire: {
          sec: 6,
          electricalSkill: 'base:electrical',
          mechanicsSkill: 'base:mechanics',
          minElectrical: 1,
          minMechanics: 0,
          baseChance: 0.2,
          chancePerElectrical: 0.1,
          chancePerMechanics: 0.05,
          maxChance: 0.95,
        },
        fuel: {
          canItem: 'base:gas-can',
          hoseTag: 'base:tool-hose',
          refuelLps: 1,
          siphonLps: 0.25,
          pumpPoweredLps: 1.5,
          pumpManualLps: 0.3,
          reachTiles: 1.5,
        },
        repair: {
          skill: 'base:mechanics',
          reachTiles: 1.5,
          engine: {
            sec: 20,
            tools: ['base:tool-wrench'],
            parts: [{ item: 'base:engine-parts', count: 1 }],
            minSkill: 2,
            hpBase: 20,
            hpPerLevel: 8,
            xp: 10,
          },
          tire: {
            sec: 10,
            tools: ['base:tool-wrench'],
            parts: [{ item: 'base:car-tire', count: 1 }],
            minSkill: 0,
            hpBase: 100,
            xp: 4,
          },
          window: {
            sec: 12,
            tools: [],
            parts: [{ item: 'base:car-window', count: 1 }],
            minSkill: 1,
          },
          body: {
            sec: 15,
            tools: ['base:tool-hammer'],
            parts: [{ item: 'base:scrap-metal', count: 2 }],
            minSkill: 1,
            hpBase: 15,
            hpPerLevel: 6,
            xp: 6,
          },
        },
      },
    },
  },
  {
    path: 'vehicle-types/sedan.json',
    json: {
      id: 'base:sedan',
      length: 4.6,
      width: 1.8,
      fuelMax: 50,
      seats: [
        { id: 'driver', doorSide: 'left', offset: { x: 0.1, y: -0.4 } },
        { id: 'front-passenger', doorSide: 'right', offset: { x: 0.1, y: 0.4 } },
        { id: 'rear-left', doorSide: 'left', offset: { x: -0.8, y: -0.4 } },
        { id: 'rear-right', doorSide: 'right', offset: { x: -0.8, y: 0.4 } },
      ],
      trunkCapacity: 60,
      gloveboxCapacity: 3,
    },
  },
  {
    path: 'items/x.json',
    json: [
      { id: 'base:pipe-wrench', kind: 'weapon_melee', tags: ['base:tool-wrench'] },
      { id: 'base:rubber-hose', kind: 'tool', tags: ['base:tool-hose'] },
      { id: 'base:gas-can', kind: 'tool' },
    ],
  },
] as never);
const S = content.vehicles!;
const T = content.vehicleTypes!.get('base:sedan')!;

const car = (o: Partial<SnapshotVehicle> = {}): SnapshotVehicle => ({
  stableId: 7,
  variant: 0,
  x: 10,
  y: 10,
  z: 0,
  facingRad: 0,
  speed: 0,
  steer: 0,
  brakeLight: false,
  headlights: false,
  doorsOpen: 0,
  driverId: 0,
  slip: 0,
  wheelsSpin: 0,
  suspension: [0, 0, 0, 0],
  damage: { front: 1, rear: 1, left: 1, right: 1 },
  tires: [1, 1, 1, 1],
  engine: 1,
  windowsBroken: 0,
  ...o,
});
const view = (o: Partial<VehicleStateView> = {}): VehicleStateView => ({
  vehicleId: 7,
  type: 'base:sedan',
  locked: false,
  keyInIgnition: false,
  hasKey: false,
  hotwired: false,
  engineOn: false,
  fuel: 18,
  fuelMax: 50,
  trunk: 30,
  glovebox: 31,
  ...o,
});
const item = (id: number, def: string, o: Partial<ItemView> = {}): ItemView =>
  ({ id, def, count: 1, ...o }) as ItemView;
const ctx = (o: Partial<MenuCtx> = {}): MenuCtx => ({
  view: view(),
  car: car(),
  type: T,
  settings: S,
  carried: [],
  content,
  skills: [],
  px: 10,
  py: 8.5,
  pump: false,
  ...o,
});

describe('vehicle geometry', () => {
  it('doors on the sides, trunk behind, distance to the body', () => {
    // Facing +x: left side is −y (sim `doorPoint`).
    expect(doorPoint(car(), T, 0)).toEqual({ x: 10.1, y: 8.7 });
    expect(doorPoint(car(), T, 1)).toEqual({ x: 10.1, y: 11.3 });
    expect(trunkPoint(car(), T)).toEqual({ x: 7.4, y: 10 });
    expect(distToBody(car(), T, 10, 10)).toBe(0);
    expect(distToBody(car(), T, 10, 8)).toBeCloseTo(1.1);
    const r = car({ facingRad: Math.PI / 2 });
    expect(trunkPoint(r, T).y).toBeCloseTo(7.4);
  });

  it('touch tap hits the car body with finger slop', () => {
    expect(tapHitsCar(car(), T, 10, 10)).toBe(true);
    expect(tapHitsCar(car(), T, 10, 8.5)).toBe(true);
    expect(tapHitsCar(car(), T, 10, 8)).toBe(false);
  });

  it('targets the closest car on the same floor within reach', () => {
    const a = car();
    const b = car({ stableId: 8, x: 20 });
    const t = pickTarget([a, b], () => T, 19, 8.5, 0);
    expect(t?.car.stableId).toBe(8);
    expect(pickTarget([a], () => T, 10, 5, 0)).toBeUndefined();
    expect(pickTarget([a], () => T, 10, 8.5, 1)).toBeUndefined();
  });
});

describe('car panel', () => {
  it('type, seat, ignition, speed and fuel', () => {
    const vm = carPanelVM(view({ keyInIgnition: true, engineOn: true }), car({ speed: 13.1 }), 0);
    expect(vm).toMatchObject({
      type: 'SEDAN',
      seat: 'kierowca',
      ignition: 'key',
      speed: { value: '47', reverse: false },
      engine: { text: 'SILNIK WŁ.', tone: 'on' },
    });
    expect(vm.fuel).toMatchObject({ text: '18 / 50 l', low: false });
    expect(carPanelVM(view({ hotwired: true }), undefined, 1)).toMatchObject({
      seat: 'pasażer',
      ignition: 'hotwired',
    });
    expect(carPanelVM(view({ fuel: 0 }), undefined, 0).engine.tone).toBe('bad');
    expect(carPanelVM(view(), undefined, 0).ignition).toBe('none');
  });

  it('speed reverse, low fuel, names', () => {
    expect(speedLabel(-3.4)).toEqual({ value: 'R 12', reverse: true });
    expect(fuelVM(7, 50).low).toBe(true);
    expect(fuelVM(7.5, 50).low).toBe(false);
    expect(vehicleTypeName('base:sedan')).toBe('Sedan');
    expect(vehicleTypeName('mod:pickup-truck')).toBe('Pickup truck');
  });
});

describe('F menu', () => {
  it('locked car without a key: enter and lock greyed with reasons', () => {
    const items = menuItems(ctx({ view: view({ locked: true }) }));
    const by = (id: string) => items.find((i) => i.id === id);
    expect(by('enter-driver')).toMatchObject({
      label: 'Wsiądź · kierowca',
      hint: '1,5 s',
      reason: 'zamknięte',
    });
    expect(by('lock')).toMatchObject({ label: 'Otwórz auto', reason: 'brak kluczyka' });
    expect(by('trunk')?.reason).toBe('zamknięte');
    expect(by('refuel')?.reason).toBe('brak kanistra');
    expect(by('siphon')?.reason).toBe('brak węża');
    expect(by('hotwire')).toMatchObject({ hint: '1,5 + 6 s · 20%', reason: 'Elektronika 1' });
    expect(defaultItem(items, 0)).toBeUndefined();
  });

  it('broken driver window: the door opens; carried can and hose enable fuel rows', () => {
    const items = menuItems(
      ctx({
        view: view({ locked: true }),
        car: car({ windowsBroken: 1 << 2 }),
        carried: [
          item(1, 'base:gas-can', { fuelL: 6.2, fuelMaxL: 10 }),
          item(2, 'base:rubber-hose'),
        ],
        skills: [{ id: 'base:electrical', level: 2, xp: 0, next: 10 }],
      }),
    );
    const by = (id: string) => items.find((i) => i.id === id);
    expect(by('enter-driver')?.reason).toBeUndefined();
    expect(by('enter-passenger')?.reason).toBe('zamknięte');
    expect(by('refuel')).toMatchObject({ hint: '6,2 l · 1 l/s' });
    expect(by('refuel')?.reason).toBeUndefined();
    expect(by('siphon')?.reason).toBeUndefined();
    // Atlas icons: the can and the carried hose.
    expect(by('refuel')?.item).toBe('base:gas-can');
    expect(by('siphon')?.item).toBe('base:rubber-hose');
    expect(by('hotwire')).toMatchObject({ hint: '1,5 + 6 s · 40%' });
    expect(defaultItem(items, 0)?.id).toBe('enter-driver');
  });

  it('pump in reach adds „Do pełna”; repair counts damaged parts', () => {
    const items = menuItems(
      ctx({
        pump: true,
        carried: [item(1, 'base:gas-can', { fuelL: 0, fuelMaxL: 10 })],
        car: car({ tires: [0, 1, 0.3, 1], windowsBroken: 1 }),
      }),
    );
    expect(items.find((i) => i.id === 'fill-full')).toMatchObject({ hint: '32 l · ok. 53 s' });
    expect(items.find((i) => i.id === 'repair')?.hint).toBe('3 uszkodzenia');
    expect(damageCount(1)).toBe('1 uszkodzenie');
    expect(damageCount(10)).toBe('10 uszkodzeń');
  });
});

describe('rejections', () => {
  it('Polish titles and context', () => {
    expect(rejectToast('no-key', 'lockVehicle')).toEqual({
      title: 'BRAK KLUCZYKA',
      text: 'nie zamkniesz auta z zewnątrz',
    });
    expect(rejectToast('no-space', 'exitVehicle').text).toBe('Nie ma jak wysiąść');
    expect(rejectToast('no-space', 'fillFuelCan').title).toBe('KANISTER PEŁNY');
    expect(rejectToast('missing-tool', 'repairVehicle', 'Klucz').title).toBe(
      'BRAK NARZĘDZIA: KLUCZ',
    );
    expect(rejectToast('missing-parts', 'repairVehicle', 'Złom 1/2').title).toBe(
      'BRAK CZĘŚCI: ZŁOM 1/2',
    );
    expect(rejectToast('no-station', 'fillFuelCan').title).toBe('BRAK DYSTRYBUTORA');
    expect(rejectToast('out-of-range', 'repairVehicle').title).toBe('ZA DALEKO');
    expect(rejectToast('invalid-target', 'horn').title).toBe('NIE MOŻNA');
  });
});

describe('repair', () => {
  it('hp from the snapshot, requirements, result, sections', () => {
    const c = car({
      engine: 0.38,
      tires: [1, 0, 0.74, 0.31],
      damage: { front: 0.46, rear: 0.82, left: 0.63, right: 0.9 },
      windowsBroken: 1 << 2,
    });
    expect(partHp(c, 'windowLeft')).toBe(0);
    expect(partHp(c, 'windowFront')).toBe(100);
    const carried = [
      item(1, 'base:pipe-wrench'),
      item(2, 'base:car-tire'),
      item(3, 'base:scrap-metal'),
    ];
    const skills = [{ id: 'base:mechanics', level: 1, xp: 0, next: 10 }];
    const rows = repairRows(c, S, carried, content, skills, view());
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by('engine')).toMatchObject({
      hp: 38,
      state: 'blocked',
      status: 'brak: Części silnika',
    });
    expect(by('tireFR')).toMatchObject({
      hp: 0,
      note: 'kapeć',
      state: 'ready',
      status: 'wymiana · 10 s',
      after: 100,
    });
    expect(by('tireRR').note).toBe('uchodzi');
    expect(by('tireFR').reqs.map((q) => q.item)).toEqual([
      'base:pipe-wrench',
      'base:car-tire',
      undefined,
    ]);
    expect(by('bodyFront')).toMatchObject({ state: 'blocked', status: 'brak: Młotek' });
    expect(by('windowLeft')).toMatchObject({ note: 'zbita', state: 'blocked' });
    expect(by('battery')).toMatchObject({ state: 'na' });
    expect(by('fuelTank').status).toBe('paliwo 18 / 50 l');
    expect(sectionSummary(rows, 'tires')).toBe('1 kapeć · 1 uchodzi');
    expect(sectionSummary(rows, 'body')).toBe('średnio 70%');
    expect(sectionSummary(rows, 'engine')).toBe('dymi poniżej 50%');
    const i = rows.findIndex((r) => r.key === 'tireFR');
    expect(rows[nextRepairable(rows, 0)!]!.key).toBe('tireFR');
    expect(nextRepairable(rows, i)).not.toBe(i);
    const withHammer = repairRows(
      c,
      S,
      [...carried, item(4, 'base:hammer'), item(5, 'base:scrap-metal')],
      buildHudContentIndex([
        {
          path: 'items/h.json',
          json: [{ id: 'base:hammer', kind: 'tool', tags: ['base:tool-hammer'] }],
        },
        { path: 'world-settings/vehicles.json', json: { vehicles: {} } },
      ] as never),
      skills,
      view(),
    );
    expect(withHammer.find((r) => r.key === 'bodyFront')).toMatchObject({
      state: 'ready',
      after: 67,
    });
  });
});

describe('refuel', () => {
  it('„Do pełna” plan and steps, pump source from the action length', () => {
    expect(fullTankPlan(18, 50, 0, 10, 1.5, 1)).toMatchObject({ needL: 32, rounds: 4 });
    expect(Math.round(fullTankPlan(18, 50, 0, 10, 1.5, 1).etaSec)).toBe(53);
    expect(fullTankPlan(50, 50, 3, 10, 1.5, 1).needL).toBe(0);
    expect(nextFullStep(18, 50, 0)).toBe('fill');
    expect(nextFullStep(18, 50, 4)).toBe('pour');
    expect(nextFullStep(49.99, 50, 4)).toBe('done');
    expect(pumpSource(10, 10 / 1.5, S)).toBe('powered');
    expect(pumpSource(10, 10 / 0.3, S)).toBe('manual');
    expect(hotwireChance(S, [{ id: 'base:electrical', level: 9, xp: 0, next: null }])).toBe(0.95);
  });
});
