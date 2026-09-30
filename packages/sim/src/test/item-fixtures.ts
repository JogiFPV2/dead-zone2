import type { ContainerView, ItemView } from '@deadzone/protocol';
import type { ContentBundle } from '@deadzone/content';
import type { Sim, SimOptions } from '../sim.js';
import { fixtureContent, survivalSim } from './content-fixtures.js';
import { buildMap } from './fixtures.js';

/**
 * Items test map: a kitchen (room 1, x/y 5..15) with a cabinet next to the spawn (10.5, 10.5),
 * a fridge on the other side, a crate out of reach and a cabinet outside far away.
 */
export const OBJECTS = [
  { contentId: 'fixture:cabinet', x: 11, y: 10 },
  { contentId: 'fixture:fridge', x: 9, y: 10 },
  { contentId: 'fixture:crate', x: 10, y: 13 },
  { contentId: 'fixture:cabinet', x: 40, y: 40 },
];

export function itemsSim(
  content: ContentBundle = fixtureContent(),
  opts: Partial<SimOptions> = {},
): Sim {
  return survivalSim(content, {
    map: buildMap({
      objects: OBJECTS,
      room: (x, y) => (x >= 5 && x <= 15 && y >= 5 && y <= 15 ? 1 : 0),
      rooms: { '1': 'fixture:room-kitchen' },
    }),
    ...opts,
  });
}

export const mainItems = (sim: Sim): ItemView[] => {
  const inv = sim.getInventory()!;
  return inv.containers!.find((c) => c.id === inv.container)!.items;
};

export const findItem = (sim: Sim, def: string): ItemView | undefined => {
  for (const c of sim.getInventory()!.containers ?? []) {
    const hit = c.items.find((i) => i.def === def);
    if (hit) return hit;
  }
  return undefined;
};

/** World storage by map order (ids of world containers are 2, 3, … after nothing else). */
export function worldContainer(sim: Sim, x: number, y: number): ContainerView {
  for (let id = 1; id < 100; id++) {
    const c = sim.getContainer(id);
    if (c?.kind === 'world' && c.x === x && c.y === y) return c;
  }
  throw new Error(`no storage at ${x},${y}`);
}

export const rejectedReasons = (sim: Sim): string[] =>
  sim.drainEvents().flatMap((e) => (e.type === 'commandRejected' ? [e.reason] : []));
