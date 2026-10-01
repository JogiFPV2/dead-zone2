import type { ContentIndex } from '@deadzone/sim';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLOTH_OPTIONS,
  HEAD_PRESETS,
  lookFromAppearance,
  presetOfParts,
  type PartColors,
} from './appearance-map.js';
import { loadCreatorContent } from './creator-content.js';
import {
  budget,
  checkDraft,
  decSkill,
  defaultDraft,
  draftLook,
  incSkill,
  paletteHex,
  randomizeLook,
  setProfession,
  skillRows,
  splitName,
  toSpec,
  toggleTrait,
  traitRows,
} from './creator-model.js';
import { basePaletteHex } from './player-look.js';
import { tileWindow } from './step-look.js';

let c: ContentIndex;
beforeAll(async () => {
  c = await loadCreatorContent();
});

const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe('creator model (base pack)', () => {
  it('default draft is a valid character', () => {
    const d = defaultDraft(c);
    const r = checkDraft(c, d);
    expect(r.ok).toBe(true);
    expect(toSpec(c, d).firstName).toBe('Adam');
  });

  it('splits names on the first space and trims', () => {
    expect(splitName('  Jan Maria Kowalski ')).toEqual({
      firstName: 'Jan',
      lastName: 'Maria Kowalski',
    });
    expect(splitName('Ola').firstName).toBe('Ola');
  });

  it('every cloth option of the 3D map exists in content', () => {
    for (const slot of ['top', 'bottom', 'shoes'] as const)
      for (const o of CLOTH_OPTIONS[slot]) expect(c.appearanceParts.has(o.part), o.part).toBe(true);
  });

  it('skill points: inc spends from the pool, dec gives back, budget matches the sim', () => {
    let d = defaultDraft(c);
    const id = skillRows(c, d).find((r) => r.canInc)!.id;
    const before = budget(c, d).left;
    d = incSkill(c, d, id);
    expect(budget(c, d).left).toBeLessThan(before);
    const r = checkDraft(c, d);
    expect(r.ok && r.state.pointsLeft).toBe(budget(c, d).left);
    d = decSkill(d, id);
    expect(budget(c, d).left).toBe(before);
  });

  it('cannot overspend: inc stops at the start level cap or the pool', () => {
    let d = defaultDraft(c);
    const id = skillRows(c, d)[0]!.id;
    for (let i = 0; i < 30; i++) d = incSkill(c, d, id);
    expect(budget(c, d).left).toBeGreaterThanOrEqual(0);
    expect(checkDraft(c, d).ok).toBe(true);
  });

  it('conflicting traits block each other; toggling twice removes', () => {
    const d0 = defaultDraft(c);
    const conflict = [...c.traits.values()].find(
      (t) => t.selectable && t.conflicts.some((x) => c.traits.get(x)?.selectable),
    );
    if (!conflict) return;
    const other = conflict.conflicts.find((x) => c.traits.get(x)?.selectable)!;
    const d1 = toggleTrait(c, d0, conflict.id);
    expect(d1.traits).toContain(conflict.id);
    expect(toggleTrait(c, d1, other).traits).not.toContain(other);
    const rows = traitRows(c, d1);
    const row = [...rows.merits, ...rows.flaws].find((r) => r.id === other)!;
    expect(row.blockedBy?.id).toBe(conflict.id);
    expect(toggleTrait(c, d1, conflict.id).traits).not.toContain(conflict.id);
  });

  it('profession free traits show as selected and are not removable', () => {
    const prof = [...c.professions.values()].find((p) => p.freeTraits.length > 0);
    if (!prof) return;
    const d = setProfession(c, defaultDraft(c), prof.id);
    const rows = traitRows(c, d);
    const free = [...rows.merits, ...rows.flaws].find((r) => r.id === prof.freeTraits[0]);
    expect(free?.selected && free.fromProfession).toBe(true);
    expect(toggleTrait(c, d, prof.freeTraits[0]!).traits).toEqual(d.traits);
  });

  it('randomized looks stay valid and use content colors', () => {
    let d = defaultDraft(c);
    for (let i = 0; i < 10; i++) {
      d = randomizeLook(c, d, seq(0.1 * i, 0.73, 0.31, 0.97, 0.05));
      expect(checkDraft(c, d).ok).toBe(true);
      expect(paletteHex(c, 'base:skin', d.skin)).toMatch(/^#/);
    }
  });

  it('draft look and the sim profile appearance give the same render look', () => {
    const d = { ...defaultDraft(c), head: HEAD_PRESETS[2]!.id };
    const spec = toSpec(c, d);
    const parts: Record<string, { part: string; colors: PartColors }> = {};
    for (const [slot, p] of Object.entries(spec.appearance.parts)) {
      parts[slot] = { part: p.part, colors: { ...p.colors } as PartColors };
    }
    expect(presetOfParts(parts).id).toBe(d.head);
    const fromProfile = lookFromAppearance({ skin: spec.appearance.skin, parts }, basePaletteHex);
    const look = draftLook(c, d);
    expect(fromProfile.skin).toBe(look.skin);
    expect(fromProfile.parts.map((p) => p.ref.mesh)).toEqual(look.parts.map((p) => p.ref.mesh));
  });

  it('carousel shows three tiles around the selection', () => {
    expect(tileWindow(5, 0)).toEqual([0, 1, 2]);
    expect(tileWindow(5, 3)).toEqual([2, 3, 4]);
    expect(tileWindow(5, 4)).toEqual([2, 3, 4]);
    expect(tileWindow(2, 1)).toEqual([0, 1]);
  });
});
