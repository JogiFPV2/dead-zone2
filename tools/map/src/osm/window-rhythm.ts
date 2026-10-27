/**
 * Window rhythm of a facade: outer edges grouped into straight wall runs (same side, same wall
 * line, consecutive tiles), then one window every `every` tiles (fractional: 2.5 → 2, 3, 2…) centred on each run. Corner tiles
 * of a run and the tiles next to a door stay solid; runs shorter than 2 m get no window.
 */

export type Side = 'n' | 's' | 'e' | 'w';
export interface OuterEdge {
  x: number;
  y: number;
  side: Side;
  along: number;
}

const key = (x: number, y: number, side: string) => `${x},${y},${side}`;
/** Grid steps per metre of a wall at ~45° (√2 ≈ 1.41; 1.3 leaves a little margin). */
const STEP_PER_M = 1.3;

function nearDoor(e: OuterEdge, doors: ReadonlySet<string>): boolean {
  for (const d of [-1, 0, 1]) {
    const x = e.side === 'n' || e.side === 's' ? e.x + d : e.x;
    const y = e.side === 'n' || e.side === 's' ? e.y : e.y + d;
    if (doors.has(key(x, y, e.side))) return true;
  }
  return false;
}

/** Keys (`x,y,side`) of the edges that get a window. `doors`: keys of door edges on this storey. */
export function windowEdges(
  ext: readonly OuterEdge[],
  every: number,
  doors: ReadonlySet<string>,
): Set<string> {
  const runs = new Map<string, OuterEdge[]>();
  for (const e of ext) {
    const line = e.side === 'n' || e.side === 's' ? e.y : e.x;
    const k = `${e.side}:${line}`;
    let list = runs.get(k);
    if (!list) runs.set(k, (list = []));
    list.push(e);
  }
  const out = new Set<string>();
  // Single-tile steps of a staircase wall (outline at an angle to the grid), per side.
  const steps = new Map<Side, OuterEdge[]>();
  for (const list of runs.values()) {
    list.sort((a, b) => a.along - b.along);
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i]!.along === list[i - 1]!.along + 1) continue;
      if (i - start === 1) {
        const e = list[start]!;
        let l = steps.get(e.side);
        if (!l) steps.set(e.side, (l = []));
        l.push(e);
      } else place(list.slice(start, i), every, doors, out);
      start = i;
    }
  }
  // A slanted wall is all 1-tile steps (≈1.3–1.4 steps per metre of real wall): a window on
  // every STEP_EVERY-th step keeps about the same rhythm as a straight wall.
  const stepEvery = Math.max(2, Math.round(every * STEP_PER_M));
  for (const [side, all] of steps) {
    const vert = side === 'e' || side === 'w';
    // Only real staircases: a step with a diagonal neighbour step on the same side.
    const at = new Set(all.map((e) => `${e.x},${e.y}`));
    const list = all.filter((e) =>
      [-1, 1].some((dx) => [-1, 1].some((dy) => at.has(`${e.x + dx},${e.y + dy}`))),
    );
    list.sort((a, b) => (vert ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y));
    let since = stepEvery - 1;
    for (const e of list) {
      since++;
      if (since < stepEvery || nearDoor(e, doors)) continue;
      out.add(key(e.x, e.y, e.side));
      since = 0;
    }
  }
  return out;
}

function place(
  run: OuterEdge[],
  every: number,
  doors: ReadonlySet<string>,
  out: Set<string>,
): void {
  const n = run.length;
  if (n < 2) return;
  // Inner tiles only (corners solid) for runs of 3+; slots centred on the run.
  const lo = n >= 3 ? 1 : 0;
  const hi = n >= 3 ? n - 2 : n - 1;
  const span = hi - lo;
  const count = Math.floor(span / every + 1e-9) + 1;
  const first = lo + Math.floor((span - (count - 1) * every) / 2);
  const isDoor = (i: number) => {
    const e = run[i];
    return e !== undefined && doors.has(key(e.x, e.y, e.side));
  };
  for (let c = 0; c < count; c++) {
    const i = first + Math.round(c * every);
    if (isDoor(i) || isDoor(i - 1) || isDoor(i + 1)) continue;
    const e = run[i]!;
    out.add(key(e.x, e.y, e.side));
  }
}

/**
 * One window per room with an outer wall: a room (plan char) whose outer edges got none gets one
 * on the middle of its longest outer run (not next to a door). Mutates `win`.
 */
export function windowPerRoom(
  ext: readonly OuterEdge[],
  roomOf: (x: number, y: number) => string,
  win: Set<string>,
  doors: ReadonlySet<string>,
): void {
  const has = new Set<string>();
  const byRoom = new Map<string, OuterEdge[]>();
  for (const e of ext) {
    const r = roomOf(e.x, e.y);
    if (win.has(key(e.x, e.y, e.side))) has.add(r);
    let l = byRoom.get(r);
    if (!l) byRoom.set(r, (l = []));
    l.push(e);
  }
  for (const [r, list] of byRoom) {
    if (has.has(r)) continue;
    const ok = list.filter((e) => !nearDoor(e, doors));
    const e = ok[Math.floor(ok.length / 2)];
    if (e) win.add(key(e.x, e.y, e.side));
  }
}
