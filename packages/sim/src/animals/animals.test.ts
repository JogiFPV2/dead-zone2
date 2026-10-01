import {
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotEntityKind,
  SnapshotField,
  decodeSnapshot,
  type SimEvent,
} from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { createSim, type Sim } from '../sim.js';
import { eventsOf, runTicks, runUntil } from '../test/ai-fixtures.js';
import { animal, animalContent, animalSim, dist } from '../test/animal-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { animalTypeIds } from './state.js';

const DEAF_ZOMBIES = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    out.push(...sim.drainEvents());
  }
  return out;
}

const snapAnimal = (sim: Sim, sid: number) =>
  decodeSnapshot(sim.snapshot()).find((e) => e.stableId === sid);

describe('animals: content and spawn', () => {
  it('types sorted by id; spawn list → getAnimals, animalSpawned, snapshot kind / variant / anim', () => {
    const sim = animalSim({ animals: [{ x: 40.5, y: 40.5, type: 'fixture:rabbit' }] });
    expect(animalTypeIds(sim.world)).toEqual([
      'fixture:bird',
      'fixture:cat',
      'fixture:dog',
      'fixture:rabbit',
      'fixture:tortoise',
    ]);
    const a = animal(sim);
    expect(a).toMatchObject({ type: 'fixture:rabbit', x: 40.5, y: 40.5, state: 'graze', hp: 6 });
    expect(eventsOf(sim.drainEvents(), 'animalSpawned')).toEqual([
      expect.objectContaining({
        animal: a.stableId,
        animalType: 'fixture:rabbit',
        x: 40.5,
        y: 40.5,
        z: 0,
      }),
    ]);
    const s = snapAnimal(sim, a.stableId)!;
    expect(s.kind).toBe(SnapshotEntityKind.animal);
    expect(s.variant).toBe(3);
    expect(s.anim).toBe(SnapshotAnim.idle);
    expect(s.hpPct).toBe(1);
    expect(SnapshotField.variant).toBe(SNAPSHOT_ENTITY_STRIDE - 1);
  });

  it('debugSpawnAnimal: count on free tiles, unknown type and non-dev rejected', () => {
    const sim = animalSim();
    send(sim, { type: 'debugSpawnAnimal', x: 30.5, y: 30.5, count: 3, animalType: 'fixture:cat' });
    send(sim, { type: 'debugSpawnAnimal', x: 30.5, y: 30.5, animalType: 'fixture:nope' });
    sim.step();
    expect(sim.getAnimals().map((a) => a.type)).toEqual([
      'fixture:cat',
      'fixture:cat',
      'fixture:cat',
    ]);
    expect(eventsOf(sim.drainEvents(), 'commandRejected').map((e) => e.reason)).toEqual([
      'unknown-item',
    ]);
    const prod = animalSim({ dev: false });
    send(prod, { type: 'debugSpawnAnimal', x: 30.5, y: 30.5 });
    prod.step();
    expect(eventsOf(prod.drainEvents(), 'commandRejected')[0]?.reason).toBe('dev-only');
  });

  it('populateAnimals: deterministic, outdoors, habitat by chunk, away from the player', () => {
    // Chunk (0, 0) has houses (rooms) → town; the other three chunks are wild.
    const map = {
      room: (x: number, y: number) => (x < 32 && y < 32 && x % 8 < 3 && y % 8 < 3 ? 1 : 0),
      rooms: { '1': 'fixture:room-house' },
    };
    const make = (seed: number) => animalSim({ seed, map, populateAnimals: 60 });
    const a = make(4).getAnimals();
    expect(a.length).toBeGreaterThan(40);
    expect(make(4).getAnimals()).toEqual(a);
    expect(make(5).getAnimals()).not.toEqual(a);
    const town = (p: { x: number; y: number }) => p.x < 32 && p.y < 32;
    for (const p of a) {
      expect(dist(p, { x: 10.5, y: 10.5 })).toBeGreaterThanOrEqual(12);
      expect(p.x % 8 < 3 && p.y % 8 < 3 && town(p)).toBe(false); // never on a room tile
      if (p.type === 'fixture:dog' || p.type === 'fixture:cat') expect(town(p)).toBe(true);
      if (p.type === 'fixture:rabbit') expect(town(p)).toBe(false);
      expect(p.type).not.toBe('fixture:tortoise'); // spawnWeight 0
    }
    expect(new Set(a.map((p) => p.type)).size).toBe(4);
  });
});

describe('animals: AI', () => {
  it('grazes and wanders around its home (walk / idle anims)', () => {
    const sim = animalSim({ animals: [{ x: 40.5, y: 40.5, type: 'fixture:rabbit' }] });
    const sid = animal(sim).stableId;
    const anims = new Set<number>();
    let far = 0;
    let moved = 0;
    for (let i = 0; i < 600; i++) {
      sim.step();
      const a = animal(sim);
      far = Math.max(far, dist(a, { x: 40.5, y: 40.5 }));
      if (a.state === 'wander') moved++;
      anims.add(snapAnimal(sim, sid)!.anim!);
    }
    expect(moved).toBeGreaterThan(20);
    expect(far).toBeGreaterThan(0.5);
    expect(far).toBeLessThan(6.5);
    expect([...anims].sort()).toEqual([SnapshotAnim.idle, SnapshotAnim.walk]);
    expect(eventsOf(sim.drainEvents(), 'animalFled')).toEqual([]);
  });

  it('flees from a visible player, runs (anim flee), then calms down beyond safeDistance', () => {
    const sim = animalSim({ animals: [{ x: 16.5, y: 10.5, type: 'fixture:rabbit' }] });
    const sid = animal(sim).stableId;
    const ev = collect(sim, 8);
    expect(eventsOf(ev, 'animalFled')).toEqual([
      expect.objectContaining({
        animal: sid,
        reason: 'player',
        fromX: 10.5,
        fromY: 10.5,
        noise: false,
      }),
    ]);
    expect(animal(sim).state).toBe('flee');
    runTicks(sim, 20);
    expect(snapAnimal(sim, sid)!.anim).toBe(SnapshotAnim.flee);
    expect(dist(animal(sim), { x: 10.5, y: 10.5 })).toBeGreaterThan(9);
    expect(runUntil(sim, () => animal(sim).state !== 'flee', 600)).toBeGreaterThan(0);
    expect(dist(animal(sim), { x: 10.5, y: 10.5 })).toBeGreaterThanOrEqual(16);
  });

  it('sneaking: seen from fleeDistance × sneakVisibilityMul only (6 tiles: walk spooks, sneak not)', () => {
    const fled = (gait: 'walk' | 'sneak') => {
      const sim = animalSim({ animals: [{ x: 16.5, y: 10.5, type: 'fixture:rabbit' }] });
      send(sim, { type: 'move', dx: 0, dy: 0, gait });
      return eventsOf(collect(sim, 8), 'animalFled').length;
    };
    expect(fled('walk')).toBe(1);
    expect(fled('sneak')).toBe(0);
  });

  it('hears noises (footsteps, shots, debugNoise) and runs away from the source', () => {
    const sim = animalSim({ animals: [{ x: 40.5, y: 40.5, type: 'fixture:rabbit' }] });
    send(sim, { type: 'debugNoise', x: 35.5, y: 40.5, radiusTiles: 10 });
    const ev = collect(sim, 8);
    expect(eventsOf(ev, 'animalFled')).toEqual([
      expect.objectContaining({ reason: 'noise', fromX: 35.5, fromY: 40.5 }),
    ]);
    runTicks(sim, 20);
    expect(animal(sim).x).toBeGreaterThan(41.5);
  });

  it('is scared off by a zombie in sight', () => {
    const sim = animalSim({
      animals: [{ x: 40.5, y: 40.5, type: 'fixture:rabbit' }],
      spawnZombies: [{ x: 45.5, y: 40.5 }],
      aiConfig: DEAF_ZOMBIES,
    });
    expect(eventsOf(collect(sim, 8), 'animalFled')[0]?.reason).toBe('zombie');
    runTicks(sim, 20);
    expect(animal(sim).x).toBeLessThan(39);
  });

  it('a fleeing dog barks once (source animal): zombies hear it, the dog does not re-trigger', () => {
    const sim = animalSim({
      animals: [{ x: 40.5, y: 40.5, type: 'fixture:dog' }],
      spawnZombies: [{ x: 40.5, y: 56.5 }],
      aiConfig: DEAF_ZOMBIES,
    });
    sim.drainEvents();
    send(sim, { type: 'debugNoise', x: 37.5, y: 40.5, radiusTiles: 6 });
    const ev = collect(sim, 200);
    const fled = eventsOf(ev, 'animalFled');
    expect(fled).toEqual([expect.objectContaining({ reason: 'noise', noise: true })]);
    const bark = eventsOf(ev, 'noise').filter((n) => n.source === 'animal');
    expect(bark).toHaveLength(1);
    expect(bark[0]).toMatchObject({ radiusTiles: 25, volume: Math.fround(0.8) });
    const alert = eventsOf(ev, 'zombieAlerted');
    expect(alert).toEqual([
      expect.objectContaining({ reason: 'noise', x: fled[0]!.x, y: fled[0]!.y }),
    ]);
  });

  it('birds fly off and leave the world (animalDespawned, gone from the snapshot)', () => {
    const sim = animalSim({ animals: [{ x: 14.5, y: 10.5, type: 'fixture:bird' }] });
    const sid = animal(sim).stableId;
    const ev = collect(sim, 40);
    expect(eventsOf(ev, 'animalFled')[0]?.animal).toBe(sid);
    expect(eventsOf(ev, 'animalDespawned')).toEqual([
      expect.objectContaining({ animal: sid, animalType: 'fixture:bird', reason: 'fled' }),
    ]);
    expect(sim.getAnimals()).toEqual([]);
    expect(decodeSnapshot(sim.snapshot()).map((e) => e.kind)).toEqual([SnapshotEntityKind.player]);
    runTicks(sim, 20); // still stable
    expect(sim.world.ai?.animalCount).toBe(0);
  });
});

describe('animals: hunting', () => {
  it('melee: hits (hit events), kills, corpse with anim dead, loot in a ground pile to take', () => {
    const sim = animalSim({ animals: [{ x: 11.3, y: 10.5, type: 'fixture:tortoise' }] });
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    sim.step();
    const sid = animal(sim).stableId;
    const all: SimEvent[] = [];
    for (let i = 0; i < 400 && animal(sim).state !== 'dead'; i++) {
      send(sim, { type: 'attack' });
      sim.step();
      all.push(...sim.drainEvents());
    }
    const hits = eventsOf(all, 'hit');
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((h) => h.target === sid && h.source === 'melee' && h.damage > 0)).toBe(true);
    expect(hits.at(-1)?.killed).toBe(true);
    expect(eventsOf(all, 'animalFled')[0]?.reason).toBe('hit');
    const killed = eventsOf(all, 'animalKilled');
    expect(killed).toHaveLength(1);
    const k = killed[0]!;
    expect(k).toMatchObject({ animal: sid, animalType: 'fixture:tortoise', playerId: 0 });
    expect(k.container).toBeGreaterThan(0);
    expect(k.loot).toHaveLength(1);
    expect(k.loot[0]!.def).toBe('fixture:meat');
    const s = snapAnimal(sim, sid)!;
    expect(s.anim).toBe(SnapshotAnim.dead);
    expect(s.hpPct).toBe(0);
    expect(animal(sim).state).toBe('dead');
    expect(sim.getZombies()).toEqual([]);
    // maxStack 1: one item per piece of meat.
    const pile = sim.getContainer(k.container)!.items;
    expect(pile.every((i) => i.def === 'fixture:meat')).toBe(true);
    expect(pile.reduce((n, i) => n + i.count, 0)).toBe(k.loot[0]!.count);
    send(sim, { type: 'takeAll', container: k.container });
    sim.step();
    const carried = (sim.getInventory()!.containers ?? []).flatMap((c) => c.items);
    expect(carried.filter((i) => i.def === 'fixture:meat')).toHaveLength(k.loot[0]!.count);
    // Corpses are not hit again.
    send(sim, { type: 'attack' });
    runTicks(sim, 30);
    expect(eventsOf(sim.drainEvents(), 'hit')).toEqual([]);
  });

  it('a hurt animal flees from the attacker; loot rolls for a rabbit: 2 meat + hide', () => {
    const sim = animalSim({ animals: [{ x: 11.3, y: 10.5, type: 'fixture:rabbit' }] });
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:bat' });
    sim.step();
    send(sim, { type: 'equip', item: findItem(sim, 'fixture:bat')!.id, slot: 'hand_primary' });
    sim.step();
    sim.drainEvents();
    send(sim, { type: 'attack' });
    const ev = collect(sim, 2);
    const hit = eventsOf(ev, 'hit')[0];
    expect(hit?.target).toBe(animal(sim).stableId);
    if (!hit!.killed) {
      expect(animal(sim).state).toBe('flee');
    } else {
      expect(eventsOf(ev, 'animalKilled')[0]?.loot).toEqual([
        { def: 'fixture:meat', count: 2 },
        { def: 'fixture:hide', count: 1 },
      ]);
    }
  });

  it('firearm (base content): a shot hits a rabbit; a kill leaves a rabbit carcass', async () => {
    const content = await baseContent();
    const sim = createSim({
      seed: 3,
      map: buildMap({ width: 64, height: 64 }),
      spawn: { x: 10.5, y: 10.5 },
      content,
      dev: true,
      clockStart: { day: 1, hour: 12, minute: 0 },
    });
    send(sim, { type: 'debugGiveItem', itemId: 'base:pump-shotgun' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:shotgun-shell', count: 10 });
    sim.step();
    send(sim, {
      type: 'equip',
      item: findItem(sim, 'base:pump-shotgun')!.id,
      slot: 'hand_primary',
    });
    send(sim, { type: 'aim', x: 20, y: 10.5 });
    send(sim, { type: 'reload' });
    runTicks(sim, 200);
    sim.drainEvents();
    send(sim, { type: 'debugSpawnAnimal', x: 13.5, y: 10.5, animalType: 'base:rabbit' });
    send(sim, { type: 'attack' });
    const ev = collect(sim, 3);
    const sid = eventsOf(ev, 'animalSpawned')[0]!.animal;
    const shot = eventsOf(ev, 'shot')[0]!;
    expect(shot.rays.some((r) => r.hit === sid)).toBe(true);
    const hits = eventsOf(ev, 'hit').filter((h) => h.target === sid);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'shot')).toBe(true);
    const killed = eventsOf(ev, 'animalKilled');
    if (hits.some((h) => h.killed)) {
      expect(killed[0]?.loot).toEqual([{ def: 'base:rabbit-carcass', count: 1 }]);
    } else expect(killed).toEqual([]);
  });
});

describe('animals: determinism and saves', () => {
  const scenario = (seed: number, load?: Uint8Array) =>
    createSim({
      seed,
      map: buildMap({ width: 96, height: 96 }),
      spawn: { x: 48.5, y: 48.5 },
      content: animalContent(),
      dev: true,
      clockStart: { day: 1, hour: 12, minute: 0 },
      populateAnimals: 30,
      spawnZombies: [
        { x: 20.5, y: 20.5 },
        { x: 70.5, y: 30.5 },
      ],
      ...(load ? { load } : {}),
    });
  // Own seq per sim (the hash includes the last seq per player).
  const seqs = new WeakMap<Sim, number>();
  const cmd = (sim: Sim, payload: Parameters<typeof send>[1]) => {
    const seq = (seqs.get(sim) ?? 0) + 1;
    seqs.set(sim, seq);
    sim.enqueue({ ...payload, tick: sim.tick, playerId: 0, seq });
  };
  const script = (sim: Sim) => {
    const t = sim.tick;
    if (t % 60 === 0) {
      const d = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][(t / 60) % 4]!;
      cmd(sim, { type: 'move', dx: d[0]!, dy: d[1]!, gait: t % 120 === 0 ? 'run' : 'walk' });
    }
    if (t % 250 === 0) cmd(sim, { type: 'debugNoise', x: 48.5, y: 48.5, radiusTiles: 30 });
    sim.step();
  };

  it('two runs give identical hashes; animals change the hash only when present', () => {
    const a = scenario(9);
    const b = scenario(9);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 100; k++) {
        script(a);
        script(b);
      }
      expect(a.hash()).toBe(b.hash());
    }
    expect(a.getAnimals()).toEqual(b.getAnimals());
    expect(eventsOf(a.drainEvents(), 'animalFled').length).toBeGreaterThan(0);
    // No animals spawned: the animal stream and section stay out of the hash.
    const none = (rolls: boolean) => {
      const s = createSim({ seed: 9, map: buildMap(), content: animalContent() });
      if (rolls) s.world.rng.animals.nextU32();
      return s.hash();
    };
    expect(none(true)).toBe(none(false));
  });

  it('save → load → the same hash after more ticks', () => {
    const a = scenario(12);
    for (let i = 0; i < 300; i++) script(a);
    const b = scenario(12, a.save());
    seqs.set(b, seqs.get(a) ?? 0);
    expect(b.hash()).toBe(a.hash());
    expect(b.getAnimals()).toEqual(a.getAnimals());
    for (let i = 0; i < 300; i++) {
      script(a);
      script(b);
    }
    expect(b.hash()).toBe(a.hash());
  });
});
