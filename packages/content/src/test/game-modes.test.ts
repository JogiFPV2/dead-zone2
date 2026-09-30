import { describe, expect, it } from 'vitest';
import { GameModeSchema } from '../schemas/game-mode/game-mode.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { miniBase } from './helpers.js';

const mode = (extra: Record<string, unknown> = {}) => ({
  id: 'base:m',
  name: 'game-mode.base.m.name',
  objective: { lose: [{ type: 'playerDead' }] },
  world: { start: { hour: 8 }, zombies: { maxActive: 100 } },
  score: { terms: [{ metric: 'days-survived', weight: 1 }], headline: 'days-survived' },
  ...extra,
});

describe('tryby gry (gameMode)', () => {
  it('schemat: minimalny tryb, warunki deklaratywne, role spoza requiredZones i NPC są błędem', () => {
    expect(GameModeSchema.parse(mode()).player.professions).toEqual([]);
    const win = { type: 'extractNpc', npcId: 'npc', targetZone: { role: 'exit' } };
    expect(GameModeSchema.safeParse(mode({ objective: { win, lose: [] } })).success).toBe(false);
    const withWin = mode({ objective: { win, lose: [{ type: 'playerDead' }] } });
    const issues = GameModeSchema.safeParse(withWin).error?.issues.map((i) => i.message);
    expect(issues).toEqual(['rola „exit” nie jest w requiredZones', 'nieznany NPC „npc”']);
    const ok = {
      ...withWin,
      requiredZones: ['exit', 'home'],
      npcs: [{ id: 'npc', name: 'npc.base.npc.name', zone: { role: 'home' }, locked: true }],
    };
    expect(GameModeSchema.safeParse(ok).success).toBe(true);
    const code = mode({ objective: { lose: [{ type: 'script', code: 'x()' }] } });
    expect(GameModeSchema.safeParse(code).success).toBe(false);
  });

  it('schemat: horda z pierścieniem min ≤ max i limit zombie', () => {
    const horde = {
      zone: { role: 'z' },
      count: { min: 1, max: 2 },
      minRadiusTiles: 9,
      maxRadiusTiles: 3,
    };
    const bad = mode({
      requiredZones: ['z'],
      world: { start: { hour: 1 }, zombies: { maxActive: 5, hordes: [horde] } },
    });
    expect(GameModeSchema.safeParse(bad).success).toBe(false);
    expect(
      GameModeSchema.safeParse(mode({ world: { start: { hour: 1 }, zombies: {} } })).success,
    ).toBe(false);
  });

  it('walidator: zawody i zestaw startowy muszą istnieć', () => {
    const m = mode({
      player: { professions: ['base:nope'], startingKit: [{ item: 'base:nope' }] },
    });
    const r = validatePacks([miniBase({ 'game-modes/m.json': m })]);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([
      ['missing_ref', '$.player.professions[0]'],
      ['missing_ref', '$.player.startingKit[0].item'],
    ]);
  });

  it('base: „Przetrwaj” liczy przeżyte dni, bez wygranej', async () => {
    const m = (await baseBundle()).gameModes['base:survival']!;
    expect(m.objective.win).toBeUndefined();
    expect(m.objective.lose).toEqual([{ type: 'playerDead' }]);
    expect(m.score.headline).toBe('days-survived');
    expect(m.score.terms).toEqual([{ metric: 'days-survived', weight: 1 }]);
    expect(m.tags).toContain('base:demo');
    expect(m.requiredZones).toEqual(['start']);
    expect(m.player.spawnZone).toEqual({ role: 'start' });
  });

  it('base: „Ratunek” — NPC zamknięty w willi, horda pilnuje, limit 300, ewakuacja', async () => {
    const m = (await baseBundle()).gameModes['base:rescue']!;
    expect(m.objective.win).toEqual({
      type: 'extractNpc',
      npcId: 'survivor',
      targetZone: { role: 'extraction' },
    });
    expect(m.requiredZones).toEqual(['start', 'villa', 'extraction']);
    expect(m.map).toBeUndefined();
    expect(m.objective.lose).toContainEqual({ type: 'npcDead', npcId: 'survivor' });
    expect(m.world.zombies.maxActive).toBe(300);
    const horde = m.world.zombies.hordes[0]!;
    expect(horde).toMatchObject({ zone: { role: 'villa' }, behavior: 'guard' });
    expect(horde.count.max).toBeLessThanOrEqual(m.world.zombies.maxActive);
    expect(m.npcs[0]).toMatchObject({ id: 'survivor', zone: { role: 'villa' }, locked: true });
    expect(m.world.zombies.respawn.enabled).toBe(false);
    expect(m.player.startingKit.map((s) => s.item)).toContain('base:lure-electronic');
    expect(m.tags).toContain('base:demo');
  });
});
