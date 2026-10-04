import { describe, expect, it } from 'vitest';
import { GAITS, SnapshotEntityKind } from '@deadzone/protocol';
import { PhysAdapter } from './phys-adapter.js';
import { ENTITY_PHYS_STATES, LOCO_SNAPSHOT_STRIDE, PhysField } from './phys-layout.js';

/** One player record in the v13 layout (stride 20: speed, accel, gait after the physics). */
function snap20(speed: number, accel: number, gait: number): Float32Array {
  const f = new Float32Array(LOCO_SNAPSHOT_STRIDE);
  f[0] = 1;
  f[5] = SnapshotEntityKind.player;
  f[7] = 1;
  f[PhysField.state] = ENTITY_PHYS_STATES.indexOf('run');
  f[PhysField.speed] = speed;
  f[PhysField.accel] = accel;
  f[PhysField.gait] = gait;
  return f;
}

describe('PhysAdapter locomotion fields (#126, v13)', () => {
  it('reads speed, accel and gait at fields 17–19', () => {
    expect([PhysField.speed, PhysField.accel, PhysField.gait]).toEqual([17, 18, 19]);
    const a = new PhysAdapter({ stride: LOCO_SNAPSHOT_STRIDE });
    a.pushSnapshot(5, snap20(4.875, -2.5, GAITS.indexOf('sprint')));
    const p = a.get(1)!;
    expect(p.speed).toBeCloseTo(4.875, 5);
    expect(p.accel).toBeCloseTo(-2.5, 5);
    expect(p.gait).toBe('sprint');
  });

  it('leaves them unset on older strides and maps a bad gait index to walk', () => {
    const old = new PhysAdapter({ stride: 16 });
    old.pushSnapshot(5, snap20(3, 0, 2).subarray(0, 16));
    expect(old.get(1)?.speed).toBeUndefined();
    const a = new PhysAdapter({ stride: LOCO_SNAPSHOT_STRIDE });
    a.pushSnapshot(5, snap20(1, 0, 9));
    expect(a.get(1)?.gait).toBe('walk');
  });
});
