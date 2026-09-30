import { describe, expect, it } from 'vitest';
import { GameModeSchema } from '../schemas/game-mode/game-mode.js';
import { BASE_PACK_DIR, validatePackDirs } from '../node/index.js';
import { validatePacks } from '../validate/validate-packs.js';
import { formatError } from '../validate/format.js';
import { manifest, mapPack } from './map-fixtures.js';

const M = 'maps/house/manifest.json';
const G = 'game-modes/m.json';
const rect = [{ x: 0, y: 0, w: 1, h: 1 }];
const zones = [
  { id: 'start', role: 'start', z: 0, rects: rect },
  { id: 'villa-east', role: 'villa', z: 0, rects: rect },
];
const mode = (extra: Record<string, unknown> = {}) => ({
  id: 'base:m',
  name: 'game-mode.base.m.name',
  requiredZones: ['start', 'villa'],
  objective: { lose: [{ type: 'playerDead' }] },
  world: {
    start: { hour: 8 },
    zombies: {
      maxActive: 10,
      hordes: [{ zone: { role: 'villa' }, count: { min: 1, max: 2 }, maxRadiusTiles: 5 }],
    },
  },
  player: { spawnZone: { role: 'start' } },
  score: { terms: [{ metric: 'days-survived', weight: 1 }], headline: 'days-survived' },
  ...extra,
});
const run = (m: unknown, z: unknown[] = zones) =>
  validatePacks([mapPack({ [M]: { ...manifest(), zones: z }, [G]: m })]).errors.map((e) => [
    e.code,
    e.file,
    e.path,
  ]);

describe('tryb gry a strefy mapy', () => {
  it('schemat bez map: odwołania po roli muszą być w requiredZones, po id wymagają map', () => {
    expect(GameModeSchema.safeParse(mode()).success).toBe(true);
    const noRole = GameModeSchema.safeParse(mode({ requiredZones: ['start'] }));
    expect(noRole.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'world.zombies.hordes.0.zone',
    ]);
    const byId = mode({ player: { spawnZone: { zone: 'start' } } });
    expect(GameModeSchema.safeParse(byId).error?.issues[0]?.message).toMatch(/wymaga pola map/);
    expect(GameModeSchema.safeParse({ ...byId, map: 'base:house' }).success).toBe(true);
    const both = mode({ player: { spawnZone: { role: 'start', zone: 'start' } } });
    expect(GameModeSchema.safeParse(both).success).toBe(false);
  });

  it('tryb bez map nie jest sprawdzany względem map; z poprawną mapą przechodzi', () => {
    expect(run(mode(), [])).toEqual([]);
    const m = mode({ map: 'base:house', player: { spawnZone: { zone: 'start' } } });
    expect(run(m)).toEqual([]);
  });

  it('błędy: brak mapy, brak roli, nieznane id strefy', () => {
    expect(run(mode({ map: 'base:nope' }))).toEqual([['mode_map_missing', G, '$.map']]);
    expect(
      run(mode({ map: 'base:house', requiredZones: ['start', 'villa', 'extraction'] })),
    ).toEqual([['mode_zone_role_missing', G, '$.requiredZones[2]']]);
    const win = { type: 'extractNpc', npcId: 'npc', targetZone: { zone: 'exit-1' } };
    const npcs = [{ id: 'npc', name: 'npc.base.npc.name', zone: { zone: 'villa-west' } }];
    expect(
      run(mode({ map: 'base:house', objective: { win, lose: [{ type: 'playerDead' }] }, npcs })),
    ).toEqual([
      ['mode_zone_id_missing', G, '$.objective.win.targetZone'],
      ['mode_zone_id_missing', G, '$.npcs[0].zone'],
    ]);
  });

  it('base: oba tryby demo na base:test-town, mapa ma wszystkie wymagane strefy', async () => {
    const r = await validatePackDirs([BASE_PACK_DIR]);
    expect(r.errors.map(formatError)).toEqual([]);
    const town = r.maps.find((m) => m.id === 'base:test-town');
    const roles = new Set(town?.manifest.zones?.map((z) => z.role));
    for (const id of ['base:survival', 'base:rescue']) {
      const m = r.content.get('gameMode', id)!.data;
      expect(m.map).toBe('base:test-town');
      for (const role of m.requiredZones) expect(roles.has(role), `${id}: ${role}`).toBe(true);
    }
  });
});
