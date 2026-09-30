import type { Command } from '@deadzone/protocol';
import type { Sim } from '../sim.js';

let seqCounter = 0;

export function move(sim: Sim, dx: number, dy: number, playerId = 0): void {
  const r = sim.enqueue({ type: 'move', dx, dy, tick: sim.tick, playerId, seq: seqCounter++ });
  if (!r.ok) throw new Error(`move rejected: ${r.reason}`);
}

export function aim(sim: Sim, x: number, y: number, playerId = 0): void {
  const r = sim.enqueue({ type: 'aim', x, y, tick: sim.tick, playerId, seq: seqCounter++ });
  if (!r.ok) throw new Error(`aim rejected: ${r.reason}`);
}

export function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

export type Scripted = Omit<Command, 'seq' | 'playerId'>;
