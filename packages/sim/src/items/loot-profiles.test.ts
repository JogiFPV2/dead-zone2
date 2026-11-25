import { describe, expect, it } from 'vitest';
import { baseContent, fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { compileContent } from '../content/adapter.js';
import { buildingProfile, createWorldContainers, generateLoot, previewLootWeight } from './loot.js';
import { createItemStore, maxCondition, type ItemStore } from './store.js';

/** Two cabinets in room 1 (building `bld`) and one in room 2 (building `bld + 1`). */
function store(loot: object | undefined, seed: number, bld = 7): ItemStore {
  const st = createItemStore(compileContent(fixtureContent(loot ? { loot } : {})));
  createWorldContainers(
    st,
    buildMap({
      objects: [
        { contentId: 'fixture:cabinet', x: 1, y: 1 },
        { contentId: 'fixture:cabinet', x: 1, y: 2 },
        { contentId: 'fixture:cabinet', x: 4, y: 1 },
      ],
      room: (x) => (x < 3 ? 1 : 2),
      rooms: { '1': 'fixture:room-kitchen', '2': 'fixture:room-kitchen' },
      roomBuildings: { '1': bld, '2': bld + 1 },
    }),
    seed,
  );
  return st;
}

const ids = (st: ItemStore, cid: number) =>
  st.containers.get(cid)!.items.map((i) => st.content.items[st.items.get(i)!.def]!.id);

describe('charakter budynku (worldSettings.loot.buildingProfiles)', () => {
  it('jeden profil na budynek, z seeda i id budynku; bez profili w contencie — brak', () => {
    const profiles = [
      { id: 'fixture:a', weight: 1 },
      { id: 'fixture:b', weight: 1 },
      { id: 'fixture:c', weight: 1 },
    ];
    const st = store({ buildingProfiles: profiles }, 3);
    const [a, b] = [...st.containers.values()];
    expect(a!.profile).toBe(b!.profile);
    expect(a!.profile).toBe(buildingProfile(st, 3, 7));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => buildingProfile(st, 3, 100 + i)));
    expect(seen.size).toBe(3);
    expect(buildingProfile(st, 3, 0)).toBeUndefined();
    expect([...store(undefined, 3).containers.values()][0]!.profile).toBeUndefined();
  });

  it('splądrowany (chancePct 0) jest pusty, dodatek profilu dokłada swoją tabelę', () => {
    for (let seed = 0; seed < 10; seed++) {
      const looted = store(
        { buildingProfiles: [{ id: 'fixture:looted', weight: 1, chancePct: 0 }] },
        seed,
      );
      for (const c of looted.containers.values()) {
        generateLoot(looted, c, 0);
        expect(c.items).toEqual([]);
        expect(previewLootWeight(looted, c)).toBe(0);
      }
      const extra = store(
        {
          buildingProfiles: [
            {
              id: 'fixture:bricks',
              weight: 1,
              chancePct: 0,
              extra: [{ table: 'fixture:default', containers: ['fixture:cabinet'] }],
            },
          ],
        },
        seed,
      );
      for (const c of extra.containers.values()) {
        const kg = previewLootWeight(extra, c);
        generateLoot(extra, c, 0);
        expect(new Set(ids(extra, c.id))).toEqual(new Set(['fixture:brick']));
        expect(kg).toBeGreaterThan(0);
      }
    }
  });

  it('zwykły profil (100 %, +0) nie zmienia łupu', () => {
    for (let seed = 0; seed < 10; seed++) {
      const plain = store(undefined, seed);
      const normal = store({ buildingProfiles: [{ id: 'fixture:normal', weight: 1 }] }, seed);
      const a = [...plain.containers.values()];
      const b = [...normal.containers.values()];
      a.forEach((c, i) => {
        generateLoot(plain, c, 0);
        generateLoot(normal, b[i]!, 0);
        expect(ids(normal, b[i]!.id)).toEqual(ids(plain, c.id));
      });
    }
  });
});

describe('zużycie łupu (worldSettings.loot.wear) w paczce bazowej', () => {
  it('część narzędzi i leków jest używana, nic nie jest zepsute do zera', async () => {
    const st = createItemStore(compileContent(await baseContent()));
    let worn = 0;
    let fresh = 0;
    for (let seed = 0; seed < 60; seed++) {
      createWorldContainers(
        st,
        buildMap({
          objects: [
            { contentId: 'base:tool-chest', x: 1 + (seed % 10), y: 1 + Math.floor(seed / 10) },
            { contentId: 'base:bathroom-cabinet', x: 1 + (seed % 10), y: 9 },
          ],
          room: (_x, y) => (y < 9 ? 1 : 2),
          rooms: { '1': 'base:room-garage', '2': 'base:room-bathroom' },
        }),
        seed,
      );
    }
    for (const c of st.containers.values()) {
      if (c.kind !== 'world') continue;
      generateLoot(st, c, 0);
      for (const id of c.items) {
        const it = st.items.get(id)!;
        const max = maxCondition(st.content.items[it.def]!);
        if (max <= 0) continue;
        expect(it.condition).toBeGreaterThanOrEqual(1);
        expect(it.condition).toBeLessThanOrEqual(max);
        if (it.condition < max) worn++;
        else fresh++;
      }
    }
    expect(worn).toBeGreaterThan(0);
    expect(fresh).toBeGreaterThan(0);
  });
});
