import { describe, expect, it, vi } from 'vitest';
import type { SimSnapshotMessage, SimWorkerClient } from '@deadzone/sim/worker-client';
import { readEntity, writeEntities } from './snapshot.js';
import { WorkerSimClient } from './worker-sim-client.js';

function fakeClient() {
  let emit: (s: SimSnapshotMessage) => void = () => {};
  const client = {
    onSnapshot: (cb: (s: SimSnapshotMessage) => void) => {
      emit = cb;
      return () => {};
    },
    send: vi.fn(),
    release: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    client: client as unknown as SimWorkerClient,
    raw: client,
    emit: (s: SimSnapshotMessage) => emit(s),
  };
}

describe('WorkerSimClient', () => {
  it('fans snapshots out as Float32Array, then releases the buffer', () => {
    const { client, raw, emit } = fakeClient();
    const sim = new WorkerSimClient(client);
    const seen: number[] = [];
    sim.onSnapshot(({ tick, buf }) => {
      expect(raw.release).not.toHaveBeenCalled();
      seen.push(tick, readEntity(buf, 0)?.x ?? NaN);
    });
    const buf = writeEntities([{ id: 1, x: 2.5, y: 3, z: 0, facing: 0 }]).buffer;
    emit({ tick: 7, buf });
    expect(seen).toEqual([7, 2.5]);
    expect(raw.release).toHaveBeenCalledWith(buf);
  });

  it('forwards commands and disposes the worker client', () => {
    const { client, raw } = fakeClient();
    const sim = new WorkerSimClient(client);
    const cmd = { type: 'move', dx: 1, dy: 0, tick: 0, playerId: 0, seq: 1 } as const;
    sim.send(cmd);
    expect(raw.send).toHaveBeenCalledWith(cmd);
    sim.dispose();
    expect(raw.dispose).toHaveBeenCalled();
  });
});
