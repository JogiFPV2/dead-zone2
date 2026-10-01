import { describe, expect, it } from 'vitest';
import { createRng, Rng, rngFor } from '../core/rng.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import {
  enduranceLevel,
  inertiaMul,
  loadLevel,
  movementModifiers,
  physicsAccelMul,
  physicsSpeedMul,
} from './modifiers.js';
import { hitImpulse, isFromBehind, resolveHit, startAttack } from './reactions.js';
import { addBody, createPhysicsWorld, physicsHash, physicsStep, toSnapshotFields } from './step.js';
import type { PhysicsEvent, PhysicsHit, PhysicsIntent, PhysicsWorld } from './types.js';

const PI = Math.PI;

function cfgWith(patch: (c: PhysicsConfig) => void): PhysicsConfig {
  const c = JSON.parse(JSON.stringify(DEFAULT_PHYSICS_CONFIG)) as PhysicsConfig;
  patch(c);
  return c;
}

/** Steps `pw` from `from` to `to` (exclusive), collecting events. */
function run(
  pw: PhysicsWorld,
  from: number,
  to: number,
  extra: (tick: number) => {
    hits?: PhysicsHit[];
    intents?: Map<number, PhysicsIntent>;
  } = () => ({}),
): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (let t = from; t < to; t++) events.push(...physicsStep(pw, { tick: t, ...extra(t) }));
  return events;
}

describe('load and endurance thresholds (PZ)', () => {
  it('load levels at > 100 / 125 / 150 / 175 % of capacity', () => {
    expect(loadLevel(0, 12)).toBe(0);
    expect(loadLevel(12, 12)).toBe(0);
    expect(loadLevel(12.01, 12)).toBe(1);
    expect(loadLevel(15, 12)).toBe(1);
    expect(loadLevel(15.01, 12)).toBe(2);
    expect(loadLevel(18.01, 12)).toBe(3);
    expect(loadLevel(21, 12)).toBe(3);
    expect(loadLevel(21.01, 12)).toBe(4);
    expect(loadLevel(1, 0)).toBe(4);
  });

  it('endurance levels below 75 / 50 / 25 / 10', () => {
    expect([100, 75, 74.9, 50, 49.9, 25, 24.9, 10, 9.9, 0].map(enduranceLevel)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('load and endurance scale maxSpeed and accel, exhaustion forbids running', () => {
    const base = { bodyMassKg: 80, carriedKg: 0, capacityKg: 12, endurance: 100 };
    expect(movementModifiers(base)).toEqual({
      loadLevel: 0,
      enduranceLevel: 0,
      speedMul: 1,
      accelMul: 1,
      canRun: true,
    });
    const heavy = movementModifiers({ ...base, carriedKg: 19 }); // 158 % → level 3
    expect(heavy.loadLevel).toBe(3);
    expect(heavy.speedMul).toBeCloseTo(0.65, 6);
    expect(heavy.accelMul).toBeCloseTo((80 / 99) * 0.55, 5);
    const tired = movementModifiers({ ...base, endurance: 20 });
    expect(tired.enduranceLevel).toBe(3);
    expect(tired.speedMul).toBeCloseTo(0.7, 6);
    expect(tired.canRun).toBe(true);
    const both = movementModifiers({ ...base, carriedKg: 13, endurance: 5 });
    expect(both.speedMul).toBeCloseTo(0.9 * 0.55, 6);
    expect(both.canRun).toBe(false);
  });

  it('inertia: heavier bodies accelerate and brake slower', () => {
    expect(inertiaMul(80)).toBe(1);
    expect(inertiaMul(100)).toBeCloseTo(0.8, 6);
    expect(inertiaMul(10_000)).toBeCloseTo(DEFAULT_PHYSICS_CONFIG.inertiaMul.min, 6);

    const pw = createPhysicsWorld(createRng(1));
    const light = addBody(pw, { id: 1, kind: 'player', x: 0, y: 0 });
    const heavy = addBody(pw, { id: 2, kind: 'player', x: 0, y: 5, carriedKg: 16, capacityKg: 12 });
    const go = new Map<number, PhysicsIntent>([
      [1, { dx: 1, dy: 0 }],
      [2, { dx: 1, dy: 0 }],
    ]);
    const ticksTo = (pred: () => boolean, intents: Map<number, PhysicsIntent>, start: number) => {
      let t = start;
      while (!pred()) physicsStep(pw, { tick: t++, intents });
      return t - start;
    };
    const lightMax = light.maxSpeed;
    let t0 = 0;
    const lightUp = ticksTo(() => light.vel.x >= lightMax, go, t0);
    t0 += lightUp;
    const heavyUp = lightUp + ticksTo(() => heavy.vel.x >= heavy.maxSpeed, go, t0);
    expect(lightUp).toBe(DEFAULT_PHYSICS_CONFIG.accelTicks);
    expect(heavyUp).toBeGreaterThan(lightUp);
    expect(heavy.maxSpeed).toBeLessThan(lightMax); // load level 2

    const stop = new Map<number, PhysicsIntent>([
      [1, { dx: 0, dy: 0 }],
      [2, { dx: 0, dy: 0 }],
    ]);
    t0 = 100;
    let lightStop = -1;
    let heavyStop = -1;
    for (let i = 1; i < 40 && (lightStop < 0 || heavyStop < 0); i++) {
      physicsStep(pw, { tick: t0++, intents: stop });
      if (lightStop < 0 && light.vel.x === 0) lightStop = i;
      if (heavyStop < 0 && heavy.vel.x === 0) heavyStop = i;
    }
    expect(lightStop).toBe(DEFAULT_PHYSICS_CONFIG.brakeTicks);
    expect(heavyStop).toBeGreaterThan(lightStop);
    expect(light.state).toBe('idle');
  });
});

describe('hits: impulse, stagger, knockdown, getup', () => {
  it('impulse grows with strength and weapon, shrinks with target mass', () => {
    expect(hitImpulse(0.5, 5, 80)).toBeCloseTo(0.5, 6);
    expect(hitImpulse(0.5, 10, 80)).toBeGreaterThan(hitImpulse(0.5, 5, 80));
    expect(hitImpulse(0.5, 5, 120)).toBeLessThan(hitImpulse(0.5, 5, 80));
    expect(hitImpulse(0.8, 5, 80)).toBeGreaterThan(hitImpulse(0.5, 5, 80));
    expect(hitImpulse(5, 10, 30)).toBe(1);
  });

  it('rear cone counts as from behind', () => {
    // Facing +x; the attacker is behind when it stands towards −x (hitFromDir ≈ π).
    expect(isFromBehind(0, PI)).toBe(true);
    expect(isFromBehind(0, PI - 0.9)).toBe(true);
    expect(isFromBehind(0, PI / 2)).toBe(false);
    expect(isFromBehind(0, 0)).toBe(false);
    expect(isFromBehind(1.5 * PI, 0.5 * PI)).toBe(true);
  });

  it('hits from behind knock down more often', () => {
    const count = (behind: boolean): number => {
      const rng = createRng(7);
      const pw = createPhysicsWorld(createRng(0));
      const a = addBody(pw, { id: 1, kind: 'player', x: 0, y: 0 });
      // Zombie at +x of the player; facing towards the player = front, away = behind.
      const z = addBody(pw, { id: 2, kind: 'zombie', x: 1, y: 0, facing: behind ? 0 : PI });
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        const o = resolveHit(a, z, { attackerId: 1, targetId: 2, kind: 'melee', force: 0.5 }, rng);
        if (o.reaction === 'knockdown') n++;
        expect(o.behind).toBe(behind);
      }
      return n;
    };
    const front = count(false);
    const back = count(true);
    expect(back).toBeGreaterThan(front + 400);
  });

  it('uses exactly 2 RNG draws per hit', () => {
    const pw = createPhysicsWorld(createRng(0));
    const a = addBody(pw, { id: 1, kind: 'player', x: 0, y: 0 });
    const z = addBody(pw, { id: 2, kind: 'zombie', x: 1, y: 0 });
    for (const force of [0, 0.3, 1]) {
      const rng = createRng(99);
      const ref = createRng(99);
      resolveHit(a, z, { attackerId: 1, targetId: 2, kind: 'melee', force }, rng);
      ref.nextU32();
      ref.nextU32();
      expect(rng.state()).toEqual(ref.state());
    }
  });

  it('zombie: hit → knockdown → getup → idle with exact tick lengths', () => {
    const cfg = cfgWith((c) => {
      c.chance.behindKnockdownBonus = 1;
      c.durations.knockdownZombie = { min: 60, max: 60 };
    });
    const pw = createPhysicsWorld(createRng(3), cfg);
    addBody(pw, { id: 1, kind: 'player', x: 0, y: 0 });
    const z = addBody(pw, { id: 2, kind: 'zombie', x: 1, y: 0, facing: 0 });
    run(pw, 0, 10);
    const shove: PhysicsHit = { attackerId: 1, targetId: 2, kind: 'shove' };
    const ev = run(pw, 10, 11, () => ({ hits: [shove] }));
    expect(ev.map((e) => e.type)).toEqual(['hitLanded', 'fellDown']);
    expect(ev[0]).toEqual({ type: 'hitLanded', entityId: 2, tick: 10, sourceId: 1 });
    expect(z.state).toBe('knockdown');
    expect(z.stateStartTick).toBe(10);
    expect(z.stateDuration).toBe(60);
    expect(z.lastHitTick).toBe(10);
    expect(z.hitFromDir).toBeCloseTo(PI, 5);
    expect(z.knockback.dirX).toBeCloseTo(1, 6);
    expect(z.knockback.strength).toBeGreaterThan(0);
    // Pushed away from the attacker, sliding to a stop.
    const x0 = z.x;
    expect(x0).toBeGreaterThan(1);
    run(pw, 11, 30);
    expect(z.x).toBeGreaterThan(x0);
    expect(z.vel).toEqual({ x: 0, y: 0 });

    // No control while down: cannot attack, intent ignored, maxSpeed 0.
    const evs: PhysicsEvent[] = [];
    expect(startAttack(z, 30, evs)).toBe(false);
    const xDown = z.x;
    run(pw, 30, 70, () => ({ intents: new Map([[2, { dx: -1, dy: 0, run: true }]]) }));
    expect(z.x).toBe(xDown);
    expect(z.maxSpeed).toBe(0);
    expect(physicsSpeedMul(z)).toBe(0);
    expect(physicsAccelMul(z)).toBe(0);

    // tick 69 is the last knockdown tick; 70 starts getup (zombie: 30 ticks).
    expect(z.state).toBe('knockdown');
    run(pw, 70, 71);
    expect(z.state).toBe('getup');
    expect(z.stateStartTick).toBe(70);
    expect(z.stateDuration).toBe(cfg.durations.getupZombie);
    expect(cfg.durations.getupZombie).toBe(30);
    const up = run(pw, 71, 100);
    expect(up).toEqual([]);
    expect(z.state).toBe('getup');
    expect(startAttack(z, 99, evs)).toBe(false);
    const last = run(pw, 100, 101);
    expect(last).toEqual([{ type: 'gotUp', entityId: 2, tick: 100 }]);
    expect(z.state).toBe('idle');
    expect(z.knockback.strength).toBe(0);
    expect(z.maxSpeed).toBeGreaterThan(0);
    expect(startAttack(z, 101, evs)).toBe(true);
    expect(evs).toEqual([{ type: 'attackStart', entityId: 2, tick: 101 }]);
  });

  it('knockdown length is rolled in the configured range, getup has its own', () => {
    for (let seed = 0; seed < 20; seed++) {
      const cfg = cfgWith((c) => (c.chance.behindKnockdownBonus = 1));
      const pw = createPhysicsWorld(createRng(seed), cfg);
      addBody(pw, { id: 1, kind: 'player', x: 0, y: 0 });
      const z = addBody(pw, { id: 2, kind: 'zombie', x: 1, y: 0 });
      physicsStep(pw, { tick: 5, hits: [{ attackerId: 1, targetId: 2, kind: 'shove' }] });
      const d = z.stateDuration;
      expect(d).toBeGreaterThanOrEqual(cfg.durations.knockdownZombie.min);
      expect(d).toBeLessThanOrEqual(cfg.durations.knockdownZombie.max);
      run(pw, 6, 5 + d);
      expect(z.state).toBe('knockdown');
      run(pw, 5 + d, 6 + d);
      expect(z.state).toBe('getup');
      run(pw, 6 + d, 5 + d + cfg.durations.getupZombie + 1);
      expect(z.state).toBe('idle');
    }
  });

  it('player: stagger → idle with stagger length from the impulse', () => {
    const cfg = cfgWith((c) => {
      c.chance.knockdownPerImpulse = 0;
      c.chance.behindKnockdownBonus = 0;
      c.chance.behindShoveBonus = 0;
      c.chance.staggerBase = 1;
    });
    const pw = createPhysicsWorld(createRng(5), cfg);
    addBody(pw, { id: 1, kind: 'zombie', x: 0, y: 0 });
    const p = addBody(pw, { id: 2, kind: 'player', x: 0, y: 1, facing: 1.5 * PI });
    const ev = run(pw, 20, 21, () => ({ hits: [{ attackerId: 1, targetId: 2, kind: 'zombie' }] }));
    expect(ev.map((e) => e.type)).toEqual(['hitLanded', 'staggered']);
    const impulse = hitImpulse(cfg.impulse.zombieForce, 5, 80, cfg);
    const len = cfg.durations.staggerBase + Math.round(impulse * cfg.durations.staggerPerImpulse);
    expect(p.state).toBe('stagger');
    expect(p.stateDuration).toBe(len);
    expect(p.knockback.dirY).toBeCloseTo(1, 6);
    run(pw, 21, 20 + len);
    expect(p.state).toBe('stagger');
    run(pw, 20 + len, 21 + len);
    expect(p.state).toBe('idle');
  });

  it('player knockdown uses player lengths', () => {
    const cfg = cfgWith((c) => {
      c.chance.behindZombieBonus = 1;
      c.durations.knockdownPlayer = { min: 30, max: 30 };
    });
    const pw = createPhysicsWorld(createRng(5), cfg);
    addBody(pw, { id: 1, kind: 'zombie', x: 0, y: 0 });
    const p = addBody(pw, { id: 2, kind: 'player', x: 1, y: 0, facing: 0 });
    run(pw, 0, 1, () => ({ hits: [{ attackerId: 1, targetId: 2, kind: 'zombie' }] }));
    expect(p.state).toBe('knockdown');
    run(pw, 1, 31);
    expect(p.state).toBe('getup');
    expect(p.stateDuration).toBe(cfg.durations.getupPlayer);
    run(pw, 31, 31 + cfg.durations.getupPlayer);
    expect(p.state).toBe('idle');
  });

  it('weak hits only flinch; lethal hits kill; dead bodies ignore hits', () => {
    const pw = createPhysicsWorld(createRng(1));
    addBody(pw, { id: 1, kind: 'player', x: 0, y: 0, strength: 0 });
    const z = addBody(pw, { id: 2, kind: 'zombie', x: 1, y: 0, facing: PI });
    run(pw, 0, 1, () => ({ hits: [{ attackerId: 1, targetId: 2, kind: 'melee', force: 0.01 }] }));
    expect(z.state).toBe('hit');
    expect(z.stateDuration).toBe(DEFAULT_PHYSICS_CONFIG.durations.hit);
    run(pw, 1, 1 + DEFAULT_PHYSICS_CONFIG.durations.hit);
    expect(z.state).toBe('idle');
    const ev = run(pw, 10, 11, () => ({
      hits: [{ attackerId: 1, targetId: 2, kind: 'melee', force: 0.5, lethal: true }],
    }));
    expect(ev.map((e) => e.type)).toEqual(['hitLanded', 'died']);
    expect(z.state).toBe('dead');
    expect(
      run(pw, 11, 12, () => ({ hits: [{ attackerId: 1, targetId: 2, kind: 'melee' }] })),
    ).toEqual([]);
    expect(toSnapshotFields(z).state).toBe('dead');
  });

  it('attack and push are timed states that end in idle; a new attack restarts', () => {
    const pw = createPhysicsWorld(createRng(1));
    const p = addBody(pw, { id: 1, kind: 'player', x: 0, y: 0 });
    const ev: PhysicsEvent[] = [];
    expect(startAttack(p, 3, ev, true)).toBe(true);
    expect(p.state).toBe('push');
    const push = DEFAULT_PHYSICS_CONFIG.pushTicks;
    run(pw, 4, 3 + push);
    expect(p.state).toBe('push');
    run(pw, 3 + push, 4 + push);
    expect(p.state).toBe('idle');
    expect(startAttack(p, 20, ev)).toBe(true);
    expect(startAttack(p, 22, ev)).toBe(true);
    expect(p.state).toBe('attack');
    expect(p.stateStartTick).toBe(22);
    expect(ev.map((e) => e.tick)).toEqual([3, 20, 22]);
  });
});

describe('determinism', () => {
  /** Random but scripted scenario: 1 player + 30 zombies, movement and hits every tick. */
  function scenario(seed: number, ticks: number): { hashes: number[]; events: PhysicsEvent[] } {
    const pw = createPhysicsWorld(rngFor(seed, 'physics'));
    const script = new Rng([seed, 11, 22, 33]);
    addBody(pw, { id: 1, kind: 'player', x: 16, y: 16, carriedKg: 14, endurance: 60 });
    for (let i = 0; i < 30; i++) {
      addBody(pw, {
        id: 2 + i,
        kind: 'zombie',
        x: script.nextFloat() * 32,
        y: script.nextFloat() * 32,
        facing: script.nextFloat() * 2 * PI,
      });
    }
    const hashes: number[] = [];
    const events: PhysicsEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      const intents = new Map<number, PhysicsIntent>();
      for (let id = 1; id <= 31; id++) {
        if (script.chance(0.6)) {
          intents.set(id, {
            dx: script.nextFloat() * 2 - 1,
            dy: script.nextFloat() * 2 - 1,
            run: script.chance(0.3),
          });
        }
      }
      const hits: PhysicsHit[] = [];
      if (script.chance(0.3)) {
        const kinds = ['melee', 'shove', 'zombie'] as const;
        hits.push({
          attackerId: script.int(1, 31),
          targetId: script.int(1, 31),
          kind: kinds[script.int(0, 2)]!,
          lethal: script.chance(0.02),
        });
      }
      events.push(...physicsStep(pw, { tick: t, intents, hits }));
      hashes.push(physicsHash(pw));
    }
    return { hashes, events };
  }

  it('same seed and inputs give identical state and events', () => {
    const a = scenario(42, 600);
    const b = scenario(42, 600);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.events).toEqual(b.events);
    expect(a.events.some((e) => e.type === 'fellDown')).toBe(true);
    expect(a.events.some((e) => e.type === 'gotUp')).toBe(true);
  });

  it('different seeds diverge (gait seeds and rolls)', () => {
    expect(scenario(1, 50).hashes).not.toEqual(scenario(2, 50).hashes);
    const g = (seed: number) => {
      const pw = createPhysicsWorld(rngFor(seed, 'physics'));
      return [1, 2, 3].map((id) => addBody(pw, { id, kind: 'zombie', x: 0, y: 0 }).gaitSeed);
    };
    expect(g(9)).toEqual(g(9));
    expect(g(9)).not.toEqual(g(10));
    expect(new Set(g(9)).size).toBe(3);
  });
});
