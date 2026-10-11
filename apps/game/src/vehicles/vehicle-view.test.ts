import { describe, expect, it } from 'vitest';
import { InstancedMesh } from 'three';
import type { SnapshotVehicle } from '@deadzone/protocol';
import { VehicleView } from './vehicle-view.js';

const TYPE = { length: 4.2, width: 1.8 } as never;

function car(id: number, over: Partial<SnapshotVehicle> = {}): SnapshotVehicle {
  return {
    stableId: id,
    variant: 0,
    x: id * 5,
    y: 2,
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
    ...over,
  };
}

describe('VehicleView', () => {
  it('draws parked cars as instances (two batches per type), a moving car with its own group', () => {
    const view = new VehicleView(() => TYPE, 50);
    const cars = Array.from({ length: 20 }, (_, i) => car(i + 1));
    view.push(cars, 0);
    view.update(0, 16);
    const inst = () => view.root.children.filter((c) => c instanceof InstancedMesh);
    expect(inst()).toHaveLength(2);
    expect((inst()[0] as InstancedMesh).count).toBe(20);
    expect(view.drawnMeshes).toBe(2);
    // One car drives off: its own 11 meshes, the other 19 stay instanced.
    cars[3] = car(4, { speed: 3, driverId: 7 });
    view.push(cars, 50);
    view.update(60, 16);
    expect((inst()[0] as InstancedMesh).count).toBe(19);
    expect(view.drawnMeshes).toBe(2 + 11);
    // Removing every car frees the batches.
    view.push([], 100);
    view.update(100, 16);
    expect(inst()).toHaveLength(0);
  });
});
