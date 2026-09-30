import { describe, expect, it } from 'vitest';
import type { VhsItem } from '../schemas/item/vhs.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { miniBase } from './helpers.js';

const tape = (skills: { skill: string; xp: number }[]) => ({
  id: 'base:vhs-t',
  name: 'item.base.vhs-t.name',
  kind: 'vhs',
  weightKg: 0.25,
  vhs: { skills },
});
const tv = (power: boolean) => ({
  id: 'base:tv',
  name: 'item.base.tv.name',
  kind: 'placeable',
  weightKg: 12,
  tags: ['base:station-tv'],
  placeable: power ? { power: { consumesW: 120 } } : {},
});
const run = (files: Record<string, unknown>) =>
  validatePacks([miniBase(files)]).errors.map((e) => [e.code, e.path]);

describe('kasety VHS i zasilanie', () => {
  it('kaseta domyślnie: 30 s, raz na postać, telewizor base:station-tv', () => {
    const r = validatePacks([
      miniBase({ 'items/v.json': [tape([{ skill: 'base:carpentry', xp: 50 }]), tv(true)] }),
    ]);
    expect(r.errors).toEqual([]);
  });

  it('bez zasilanego telewizora, powtórzona i nieznana umiejętność to błędy', () => {
    const skills = [
      { skill: 'base:carpentry', xp: 50 },
      { skill: 'base:carpentry', xp: 10 },
      { skill: 'base:nope', xp: 10 },
    ];
    expect(run({ 'items/v.json': [tape(skills), tv(false)] })).toEqual(
      expect.arrayContaining([
        ['missing_ref', '$[0].vhs.skills[2].skill'],
        ['vhs_no_tv', '$[0].vhs.tvTag'],
        ['vhs_duplicate_skill', '$[0].vhs.skills[1].skill'],
      ]),
    );
    expect(run({ 'items/v.json': [tape([]), tv(true)] })).toEqual([['schema', '$[0].vhs.skills']]);
  });

  it('base: 15 kaset z 1–3 umiejętnościami, telewizor, generator na paliwo', async () => {
    const b = await baseBundle();
    const tapes = Object.values(b.items).filter((i): i is VhsItem => i.kind === 'vhs');
    expect(tapes.length).toBe(15);
    for (const t of tapes) {
      expect(t.vhs).toMatchObject({
        watchSec: 30,
        oncePerCharacter: true,
        tvTag: 'base:station-tv',
      });
      expect(t.vhs.skills.length).toBeGreaterThanOrEqual(1);
    }
    const skills = new Set(tapes.flatMap((t) => t.vhs.skills.map((s) => s.skill)));
    for (const s of ['fitness', 'cooking', 'carpentry', 'first-aid', 'mechanics'])
      expect(skills.has(`base:${s}`), s).toBe(true);
    const gen = b.items['base:generator'];
    expect(gen?.kind === 'placeable' && gen.placeable.powerSource?.fuelTag).toBe('base:fuel');
    expect(b.items['base:tv']?.tags).toContain('base:station-tv');
    expect(b.lootTables['base:video-rental']?.rooms).toEqual(['base:room-video-store']);
    for (const id of ['base:living-room', 'base:bedroom', 'base:bookstore'])
      expect(
        b.lootTables[id]?.entries.some((e) => 'table' in e && e.table === 'base:vhs-tapes'),
      ).toBe(true);
  });
});
