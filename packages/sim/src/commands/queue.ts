import {
  parseCommand,
  type Command,
  type CommandRejectReason,
  type PlayerId,
} from '@deadzone/protocol';

export type EnqueueResult =
  { ok: true; tick: number } | { ok: false; reason: CommandRejectReason; error?: string };

/**
 * Per-tick command queue. Commands are validated structurally (zod), deduplicated by `seq`,
 * retargeted to the current tick when late (singleplayer policy) and applied in
 * `(playerId, seq)` order.
 */
export class CommandQueue {
  private readonly byTick = new Map<number, Command[]>();
  private readonly lastSeq = new Map<PlayerId, number>();

  constructor(private readonly windowTicks: number) {}

  enqueue(input: unknown, currentTick: number): EnqueueResult {
    const parsed = parseCommand(input);
    if (!parsed.ok) return { ok: false, reason: 'invalid', error: parsed.error };
    const cmd = parsed.command;
    const last = this.lastSeq.get(cmd.playerId);
    if (last !== undefined && cmd.seq <= last) return { ok: false, reason: 'stale-seq' };
    if (cmd.tick > currentTick + this.windowTicks)
      return { ok: false, reason: 'too-far-in-future' };
    const tick = Math.max(cmd.tick, currentTick);
    this.lastSeq.set(cmd.playerId, cmd.seq);
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
}
