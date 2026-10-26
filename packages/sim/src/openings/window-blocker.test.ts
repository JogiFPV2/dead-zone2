import type { SimEdgeKind, SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { objectFurnitureId } from '../furniture/menu.js';
import { DEFAULT_PHYSICS_CONFIG } from '../physics/constants.js';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { eventsOf, NOON } from '../test/ai-fixtures.js';
import { baseContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';

/** Room x/y ∈ [20, 30) (base content) with a window on the west wall at (20, 22) (edge id 3). */
const WINDOW = { tx: 20, ty: 22, side: 'w' } as const;
const room = (objects: { contentId: string; x: number; y: number; rot?: number }[]) =>
  buildMap({
    wallW: (x, y) => (x === 20 || x === 30) && y >= 20 && y < 30,
    wallN: (x, y) => (y === 20 || y === 30) && x >= 20 && x < 30,
    edgeId: (x, y) => (x === 20 && y === 22 ? 3 : 1),
    edgeKinds: [null, 'wall', 'door', 'window'] as (SimEdgeKind | null)[],
    objects,
  });

async function sim(
  objects: { contentId: string; x: number; y: number; rot?: number }[],
  spawn: { x: number; y: number },
  opts: Partial<SimOptions> = {},
): Promise<Sim> {
  const s = createSim({
    seed: 3,
    map: room(objects),
    spawn,
    content: await baseContent(),
    dev: true,
    clockStart: NOON,
    ...opts,
  });
  cmd(s, { type: 'debugOpening', ...WINDOW, state: 'open' });
  run(s, 1);
  return s;
}

let seq = 0;
function cmd(s: Sim, c: Record<string, unknown>): void {
  const r = s.enqueue({ ...c, tick: s.tick, playerId: 0, seq: seq++ } as never);
  if (!r.ok) throw new Error(`rejected ${r.reason}`);
}
function run(s: Sim, n: number, until?: () => boolean): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < n && !until?.(); i++) {
    s.step();
    ev.push(...s.drainEvents());
  }
  return ev;
}
const rejected = (ev: readonly SimEvent[]) => eventsOf(ev, 'commandRejected').map((e) => e.reason);
const climb = (s: Sim) => {
  cmd(s, { type: 'climbThrough', ...WINDOW });
  return run(s, 60);
};

describe('window blocked by furniture (docs 9.75, protocol 45)', () => {
  it('a crate in front: climb refused with blocked-by-furniture; push it aside, then climb', async () => {
    const s = await sim([{ contentId: 'base:crate', x: 20, y: 22 }], { x: 20.5, y: 23.5 });
    const b = s.windowBlocker(WINDOW)!;
    expect(b).toMatchObject({
      furnitureId: objectFurnitureId(20, 22, 0, 0),
      contentId: 'base:crate',
      side: 'near',
      canMove: true,
    });
    expect(rejected(climb(s))).toEqual(['blocked-by-furniture']);
    // From the south the push goes north, off the window tile.
    expect(s.pushFurniture(b.furnitureId)).toBeUndefined();
    const moved = eventsOf(
      run(s, 400, () => !s.getAction()),
      'furnitureMoved',
    );
    expect(moved).toMatchObject([{ cause: 'push', contentId: 'base:crate', x: 20, y: 21 }]);
    expect(s.windowBlocker(WINDOW)).toBeUndefined();
    // Step up to the window and climb out.
    cmd(s, { type: 'move', dx: 0, dy: -1 });
    run(s, 40, () => s.getPlayer()!.y < 22.6);
    cmd(s, { type: 'move', dx: 0, dy: 0 });
    run(s, 10);
    const ev = climb(s);
    expect(rejected(ev)).toEqual([]);
    expect(eventsOf(ev, 'actionStarted')).toMatchObject([{ action: 'climbThrough' }]);
    run(s, 60);
    expect(s.getPlayer()!.x).toBeLessThan(20);
  });

  it('a piece outside is reported on the far side (movable from outside)', async () => {
    const s = await sim([{ contentId: 'base:crate', x: 19, y: 22 }], { x: 20.6, y: 22.5 });
    expect(s.windowBlocker(WINDOW)).toMatchObject({ side: 'far', canMove: true });
    expect(rejected(climb(s))).toEqual(['blocked-by-furniture']);
  });

  it('a fixture or a piece too heavy to push stays: canMove false with the reason', async () => {
    const sink = await sim([{ contentId: 'base:kitchen-sink', x: 20, y: 22 }], {
      x: 20.5,
      y: 23.5,
    });
    expect(sink.windowBlocker(WINDOW)).toMatchObject({ canMove: false, reason: 'fixed' });
    expect(rejected(climb(sink))).toEqual(['blocked-by-furniture']);
    expect(sink.pushFurniture(sink.windowBlocker(WINDOW)!.furnitureId)).toBe('fixed');

    const heavy = {
      physicsConfig: {
        ...DEFAULT_PHYSICS_CONFIG,
        furniture: { ...DEFAULT_PHYSICS_CONFIG.furniture, kgPerTile: 500, kgPerTileTall: 500 },
      },
    };
    const s = await sim([{ contentId: 'base:crate', x: 20, y: 22 }], { x: 20.5, y: 23.5 }, heavy);
    const b = s.windowBlocker(WINDOW)!;
    expect(b).toMatchObject({ canMove: false, reason: 'too-heavy' });
    expect(b.weightKg).toBeGreaterThan(b.strengthKg);
    expect(s.pushFurniture(b.furnitureId)).toBe('too-heavy');
  });

  it('a clear window has no blocker and climbs as before', async () => {
    const s = await sim([], { x: 20.6, y: 22.5 });
    expect(s.windowBlocker(WINDOW)).toBeUndefined();
    expect(rejected(climb(s))).toEqual([]);
  });
});
