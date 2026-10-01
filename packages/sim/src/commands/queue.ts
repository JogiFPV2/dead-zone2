import type { Command, CommandRejectReason, PlayerId } from '@deadzone/protocol';
import { parseCommand } from '@deadzone/protocol/schema';

/**
 * Host/system commands that bypass the per-player `seq` ordering: they neither need a seq above
 * the player's last one nor advance it. `setTimeScale` comes from the worker client
 * (`client.setSpeed`) with its own seq counter, independent of the game's command stamper, and it
 * is idempotent (sets a value), so a duplicate is harmless. Within a tick it is still applied in
 * deterministic `(playerId, seq)` order, so replays and saves reproduce the same result.
 */
const SEQ_EXEMPT: ReadonlySet<Command['type']> = new Set<Command['type']>(['setTimeScale']);

export type EnqueueResult =
  { ok: true; tick: number } | { ok: false; reason: CommandRejectReason; error?: string };

/**
 * Per-tick command queue. Commands are validated structurally (zod), deduplicated by `seq`,
 * retargeted to the current tick when late (singleplayer policy) and applied in
 * `(playerId, seq)` order. Commands in `SEQ_EXEMPT` skip the seq check.
 */
export class CommandQueue {
  private readonly byTick = new Map<number, Command[]>();
  private readonly lastSeq = new Map<PlayerId, number>();

  constructor(private readonly windowTicks: number) {}

  enqueue(input: unknown, currentTick: number): EnqueueResult {
    const parsed = parseCommand(input);
    if (!parsed.ok) return { ok: false, reason: 'invalid', error: parsed.error };
    const cmd = parsed.command;
    const exempt = SEQ_EXEMPT.has(cmd.type);
    const last = this.lastSeq.get(cmd.playerId);
    if (!exempt && last !== undefined && cmd.seq <= last) return { ok: false, reason: 'stale-seq' };
    if (cmd.tick > currentTick + this.windowTicks)
      return { ok: false, reason: 'too-far-in-future' };
    const tick = Math.max(cmd.tick, currentTick);
    if (!exempt) this.lastSeq.set(cmd.playerId, cmd.seq);
    const list = this.byTick.get(tick);
    const stored = tick === cmd.tick ? cmd : { ...cmd, tick };
    if (list) list.push(stored);
    else this.byTick.set(tick, [stored]);
    return { ok: true, tick };
  }

  /** Removes and returns the commands of `tick`, sorted by (playerId, seq). */
  take(tick: number): Command[] {
    const list = this.byTick.get(tick);
    if (!list) return [];
    this.byTick.delete(tick);
    return list.sort((a, b) => a.playerId - b.playerId || a.seq - b.seq);
  }

  get pendingCount(): number {
    let n = 0;
    for (const l of this.byTick.values()) n += l.length;
    return n;
  }

  /** Last accepted seq per player, sorted by playerId (for the state hash). */
  seqState(): [PlayerId, number][] {
    return [...this.lastSeq.entries()].sort((a, b) => a[0] - b[0]);
  }

  /** Pending commands and last seqs (save games). */
  exportState(): { byTick: [number, Command[]][]; lastSeq: [PlayerId, number][] } {
    return {
      byTick: [...this.byTick.entries()].map(([t, l]) => [t, l.map((c) => ({ ...c }))]),
      lastSeq: [...this.lastSeq.entries()],
    };
  }

  importState(s: { byTick: [number, Command[]][]; lastSeq: [PlayerId, number][] }): void {
    this.byTick.clear();
    this.lastSeq.clear();
    for (const [t, l] of s.byTick) this.byTick.set(t, l);
    for (const [p, q] of s.lastSeq) this.lastSeq.set(p, q);
  }
}
