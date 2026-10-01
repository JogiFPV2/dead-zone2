import { describe, expect, it } from 'vitest';
import {
  SnapshotAnim,
  SnapshotEntityKind,
  encodeSnapshot,
  type SimEvent,
} from '@deadzone/protocol';
import { GETUP_TICKS, KNOCKDOWN_FALL_TICKS } from './contract.js';
import { PhysAdapter, gaitSeedOf } from './phys-adapter.js';

const P = SnapshotEntityKind.player;
const Z = SnapshotEntityKind.zombie;
const ent = (stableId: number, x: number, kind: number, anim: number = SnapshotAnim.idle) => ({
  stableId,
  x,
  y: 0,
  z: 0,
  facingRad: 0,
  kind,
  anim,
  hpPct: 1,
});
/** Pre-#62 records (stride 8): the derived fallback. */
const snap = (...e: ReturnType<typeof ent>[]) => {
  const full = new Float32Array(encodeSnapshot(e));
  const out = new Float32Array(e.length * 8);
  for (let i = 0; i < e.length; i++) out.set(full.subarray(i * 16, i * 16 + 8), i * 8);
  return out;
};
const hit = (
  tick: number,
  attacker: number,
  target: number,
  source: 'melee' | 'shove' | 'zombie',
) =>
  ({
    type: 'hit',
    tick,
    source,
    attacker,
    target,
    damage: 5,
    x: 0,
    y: 0,
    killed: false,
  }) as SimEvent;

describe('PhysAdapter', () => {
  it('derives velocity, locomotion and the local player id from snapshots', () => {
    const a = new PhysAdapter({ stride: 8 });
    a.pushSnapshot(1, snap(ent(1, 0, P), ent(7, 5, Z, SnapshotAnim.walk)));
    a.pushSnapshot(2, snap(ent(1, 0.15, P, SnapshotAnim.walk), ent(7, 5.05, Z, SnapshotAnim.walk)));
    expect(a.localId).toBe(1);
    expect(a.get(1)?.state).toBe('walk');
    expect(a.get(1)?.vel.x).toBeCloseTo(0.15);
    expect(a.get(7)?.vel.x).toBeCloseTo(0.05);
    expect(a.get(7)?.gaitSeed).toBe(gaitSeedOf(7));
    expect(a.get(1)?.gaitSeed).toBe(0);
  });

  it('ignores teleports for velocity and drops entities missing from a snapshot', () => {
    const a = new PhysAdapter({ stride: 8 });
    a.pushSnapshot(1, snap(ent(1, 0, P), ent(7, 5, Z)));
    a.pushSnapshot(2, snap(ent(1, 30, P)));
    expect(a.get(1)?.vel.x).toBe(0);
    expect(a.get(7)).toBeUndefined();
  });

  it('turns a melee hit with knockback into a stagger away from the attacker', () => {
    const a = new PhysAdapter({ stride: 8, knockbackOf: () => 1 });
    a.pushSnapshot(1, snap(ent(1, 0, P), ent(7, 1, Z)));
    a.pushEvents([hit(1, 1, 7, 'melee')]);
    const z = a.get(7)!;
    expect(z.state).toBe('stagger');
    expect(z.knockback.dirX).toBeCloseTo(1);
    expect(z.knockback.strength).toBe(1);
    expect(Math.abs(z.hitFromDir)).toBeCloseTo(Math.PI);
    expect(z.stateDuration).toBe(12); // 0.6 s per knockback at 20 Hz
    expect(a.drainEvents().map((e) => e.type)).toEqual(['hitLanded', 'staggered']);
    // Stays staggered for its duration, then back to locomotion.
    a.pushSnapshot(10, snap(ent(1, 0, P), ent(7, 1, Z)));
    expect(a.get(7)?.state).toBe('stagger');
    a.pushSnapshot(14, snap(ent(1, 0, P), ent(7, 1, Z)));
    expect(a.get(7)?.state).toBe('idle');
  });

  it('knocks some shoved zombies down and gets them up inside the sim stagger time', () => {
    let downs = 0;
    for (let id = 2; id < 80; id++) {
      const a = new PhysAdapter({ stride: 8 });
      a.pushSnapshot(1, snap(ent(1, 0, P), ent(id, 1, Z)));
      a.pushEvents([hit(1, 1, id, 'shove')]);
      const z = a.get(id)!;
      if (z.state !== 'knockdown') {
        expect(z.state).toBe('stagger');
        continue;
      }
      downs++;
      const up = 1 + KNOCKDOWN_FALL_TICKS + z.stateDuration;
      a.pushSnapshot(up, snap(ent(1, 0, P), ent(id, 1, Z)));
      expect(a.get(id)?.state).toBe('getup');
      a.pushSnapshot(up + GETUP_TICKS, snap(ent(1, 0, P), ent(id, 1, Z)));
      expect(a.get(id)?.state).toBe('idle');
      // 1.2 s shove stagger at 20 Hz.
      expect(up + GETUP_TICKS - 1).toBeLessThanOrEqual(24);
      expect(a.drainEvents().map((e) => e.type)).toEqual(['hitLanded', 'fellDown', 'gotUp']);
    }
    expect(downs).toBeGreaterThan(10);
    expect(downs).toBeLessThan(50);
  });

  it('tells a local shove from a swing and reports deaths', () => {
    const a = new PhysAdapter({ stride: 8 });
    a.pushSnapshot(1, snap(ent(1, 0, P), ent(7, 1, Z)));
    a.noteLocalAction('shove', 1);
    a.pushSnapshot(2, snap(ent(1, 0, P, SnapshotAnim.attack), ent(7, 1, Z, SnapshotAnim.attack)));
    expect(a.get(1)?.state).toBe('push');
    expect(a.get(7)?.state).toBe('attack');
    a.pushSnapshot(3, snap(ent(1, 0, P), ent(7, 1, Z, SnapshotAnim.dead)));
    expect(a.get(7)?.state).toBe('dead');
    expect(a.drainEvents().map((e) => e.type)).toEqual(['attackStart', 'attackStart', 'died']);
  });

  it('shows corpses that were already dead when first seen without a fall', () => {
    const a = new PhysAdapter({ stride: 8 });
    a.pushSnapshot(100, snap(ent(1, 0, P), ent(7, 1, Z, SnapshotAnim.dead)));
    expect(a.get(7)?.state).toBe('dead');
    expect(a.get(7)!.stateStartTick).toBeLessThan(0);
  });
});
