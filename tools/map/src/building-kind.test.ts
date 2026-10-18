// SimChunk.roomBuildings / buildingKinds (#216 keys and locks, #224 lock chance per building kind):
// every content map and the world generator give each room a building and each building a kind.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_PACK_DIR } from '@deadzone/content/node';
import { describe, expect, it } from 'vitest';
import { LOCK_BUILDING_KINDS, LOCK_KIND_OF, kindFromRooms, lockKindOf } from './building-kind.js';
import { BUILDING_KINDS } from './osm/types.js';
import { PlanChunkGenerator, plan4Plan } from './world-source/index.js';

const MAPS = join(BASE_PACK_DIR, 'maps');

describe('rodzaje budynków (buildingKinds)', () => {
  it('każdy rodzaj generatora ma rodzaj zamka (kościół: brak, sim bierze domyślną szansę)', () => {
    for (const k of BUILDING_KINDS) {
      expect(Object.hasOwn(LOCK_KIND_OF, k), k).toBe(true);
      const v = LOCK_KIND_OF[k];
      if (k === 'church') expect(v).toBeUndefined();
      else expect(LOCK_BUILDING_KINDS).toContain(v);
    }
    expect(kindFromRooms(['base:room-bedroom', 'base:room-shop'])).toBe('shop');
    expect(kindFromRooms(['base:room-garage', 'base:room-kitchen'])).toBe('house');
    expect(kindFromRooms(['base:room-hall'])).toBeUndefined();
    expect(lockKindOf('block', [])).toBe('house');
    expect(lockKindOf('church', ['base:room-office'])).toBeUndefined();
  });

  for (const id of readdirSync(MAPS)) {
    it(`${id}: każdy pokój ma budynek, każdy budynek ma rodzaj`, () => {
      const dir = join(MAPS, id, 'chunks');
      for (const f of readdirSync(dir)) {
        const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
          rooms?: Record<string, { buildingId: number }>;
          buildingKinds?: Record<string, string>;
        };
        for (const r of Object.values(c.rooms ?? {})) {
          expect(r.buildingId, f).toBeGreaterThan(0);
          expect(LOCK_BUILDING_KINDS, `${f} ${r.buildingId}`).toContain(
            c.buildingKinds?.[String(r.buildingId)],
          );
        }
      }
    });
  }

  it(
    'generator (plan-4, próbka): rodzaj dla budynków pokojów każdego poziomu',
    { timeout: 180_000 },
    () => {
      const gen = new PlanChunkGenerator(plan4Plan(1993, 4096));
      const s = gen.start();
      let rooms = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const c = gen.column(Math.floor(s.x / 32) + dx, Math.floor(s.y / 32) + dy);
          for (const l of c?.levels ?? []) {
            const kinds = new Map(l.buildingKinds ?? []);
            for (const [, , gid] of l.rooms) {
              rooms++;
              expect(gid).toBeGreaterThan(0);
              const meta = c!.buildings.find((b) => b.id === gid);
              if (meta?.kind === 'church') continue;
              expect(LOCK_BUILDING_KINDS, `building ${gid} (${meta?.kind})`).toContain(
                kinds.get(gid),
              );
            }
            for (const g of kinds.keys()) expect(l.rooms.some((r) => r[2] === g)).toBe(true);
          }
        }
      expect(rooms).toBeGreaterThan(20);
    },
  );
});
