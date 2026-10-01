import { describe, expect, it } from 'vitest';
import { SnapshotEntityKind } from '@deadzone/protocol';
import { KNOCKDOWN_FALL_TICKS } from './contract.js';
import { PhysAdapter } from './phys-adapter.js';
import { ENTITY_PHYS_STATES, PhysField } from './phys-layout.js';

/** Knockdown length used by the sim for a zombie (ticks, #62). */
const SIM_KNOCKDOWN_TICKS = 60;

type PhysName = (typeof ENTITY_PHYS_STATES)[number];
interface Rec {
  id: number;
  x: number;
  kind: number;
  state: PhysName;
  start: number;
  dur?: number;
  kb?: [number, number, number];
  from?: number;
  seed?: number;
}

/** Encodes records in the #62 layout (stride 16, u32 bits for start tick and gait seed). */
function snap16(...recs: Rec[]): Float32Array {
  const f = new Float32Array(recs.length * 16);
  const u = new Uint32Array(f.buffer);
  recs.forEach((r, i) => {
    const o = i * 16;
    f[o] = r.id;
    f[o + 1] = r.x;
    f[o + 5] = r.kind;
    f[o + 7] = 1;
    f[o + PhysField.state] = ENTITY_PHYS_STATES.indexOf(r.state);
    u[o + PhysField.stateStartTick] = r.start;
    f[o + PhysField.stateDuration] = r.dur ?? 0;
    const [kx, ky, ks] = r.kb ?? [0, 0, 0];
    f[o + PhysField.knockbackDirX] = kx;
    f[o + PhysField.knockbackDirY] = ky;
    f[o + PhysField.knockbackStrength] = ks;
    f[o + PhysField.hitFromDir] = r.from ?? 0;
    u[o + PhysField.gaitSeed] = r.seed ?? 0;
  });
  return f;
}

const P = SnapshotEntityKind.player;
const Z = SnapshotEntityKind.zombie;

describe('PhysAdapter with sim physics fields (#62 layout)', () => {
  it('reads state, timing, knockback, hit direction and the u32 gait seed', () => {
    const a = new PhysAdapter({ stride: 16 });
    expect(a.simPhysics).toBe(true);
    const seed = 0xdeadbeef;
    a.pushSnapshot(
      100,
      snap16(
        { id: 1, x: 0, kind: P, state: 'idle', start: 3 },
        {
          id: 7,
          x: 2,
          kind: Z,
          state: 'stagger',
          start: 99,
          dur: 24,
          kb: [1, 0, 0.6],
          from: Math.PI,
          seed,
        },
      ),
    );
    const z = a.get(7)!;
    expect(z.state).toBe('stagger');
    expect(z.stateStartTick).toBe(99);
    expect(z.stateDuration).toBe(24);
    expect(z.knockback.dirX).toBe(1);
    expect(z.knockback.dirY).toBe(0);
    expect(z.knockback.strength).toBeCloseTo(0.6, 5);
    expect(z.hitFromDir).toBeCloseTo(Math.PI);
    expect(z.gaitSeed).toBe(seed);
    expect(z.lastHitTick).toBe(99);
    expect(a.get(1)?.gaitSeed).toBe(0);
  });

  it('maps the knockdown length to lying time after the fall', () => {
    const a = new PhysAdapter({ stride: 16 });
    a.pushSnapshot(
      10,
      snap16({
        id: 7,
        x: 0,
        kind: Z,
        seed: 5,
        state: 'knockdown',
        start: 10,
        dur: SIM_KNOCKDOWN_TICKS,
      }),
    );
    expect(a.get(7)?.stateDuration).toBe(SIM_KNOCKDOWN_TICKS - KNOCKDOWN_FALL_TICKS);
  });

  it('ignores client hit heuristics and forwards physics events', () => {
    const a = new PhysAdapter({ stride: 16 });
    a.pushSnapshot(
      1,
      snap16(
        { id: 1, x: 0, kind: P, state: 'idle', start: 0 },
        { id: 7, x: 1, kind: Z, state: 'walk', start: 0, seed: 5 },
      ),
    );
    a.pushEvents([
      {
        type: 'hit',
        tick: 2,
        source: 'shove',
        attacker: 1,
        target: 7,
        damage: 0,
        x: 1,
        y: 0,
        killed: false,
      },
      { type: 'physics', tick: 2, kind: 'hitLanded', entity: 7, source: 1 },
      { type: 'physics', tick: 2, kind: 'fellDown', entity: 7 },
    ] as unknown as { type: string }[]);
    expect(a.get(7)?.state).toBe('walk');
    expect(a.get(7)?.lastHitTick).toBe(2);
    expect(a.drainEvents().map((e) => e.type)).toEqual(['hitLanded', 'fellDown']);
  });

  it('derives zombies without a gait seed (mock crowd: no physics body)', () => {
    const a = new PhysAdapter({ stride: 16 });
    const rec = (x: number) => snap16({ id: 9, x, kind: Z, state: 'idle', start: 0 });
    const walk = (b: Float32Array) => ((b[6] = 1), b);
    a.pushSnapshot(1, walk(rec(0)));
    a.pushSnapshot(2, walk(rec(0.05)));
    expect(a.get(9)?.state).toBe('walk');
    expect(a.get(9)?.gaitSeed).not.toBe(0);
  });

  it('falls back to derivation with the stride-8 layout', () => {
    const a = new PhysAdapter({ stride: 8 });
    expect(a.simPhysics).toBe(false);
  });
});
