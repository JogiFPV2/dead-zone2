import type { CharacterSpec } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { createSim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { compileContent } from '../content/adapter.js';
import { checkCharacter, skillCost } from './character.js';

const content = await baseContent();
const index = compileContent(content);

function sim(opts: { load?: Uint8Array; character?: CharacterSpec } = {}): Sim {
  return createSim({
    seed: 9,
    map: buildMap({ width: 32, height: 32 }),
    spawn: { x: 10.5, y: 10.5 },
    content,
    dev: true,
    clockStart: { day: 1, hour: 12, minute: 0 },
    ...opts,
  });
}

const look = (): CharacterSpec['appearance'] => ({
  skin: 'olive',
  parts: {
    face: { part: 'base:face-b' },
    hair: { part: 'base:hair-long', colors: { primary: 'ginger' } },
    top: { part: 'base:top-hoodie', colors: { primary: 'navy' } },
    bottom: { part: 'base:bottom-jeans' },
    shoes: { part: 'base:shoes-boots', colors: { primary: 'charcoal' } },
  },
});

const carpenter = (over: Partial<CharacterSpec> = {}): CharacterSpec => ({
  firstName: 'Anna',
  lastName: 'Nowak',
  appearance: look(),
  profession: 'base:carpenter',
  traits: ['base:strong'],
  skills: { 'base:aiming': 2 },
  ...over,
});

const errorsOf = (spec: CharacterSpec): string[] => {
  const r = checkCharacter(index, spec);
  return r.ok ? [] : r.errors;
};

describe('character creator: validation', () => {
  it('budget: start 8 + profession 2 − strong 6 − aiming 2 levels (1+2) = 1 left', () => {
    expect(skillCost([1, 2, 3], 2)).toBe(3);
    const r = checkCharacter(index, carpenter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pointsLeft).toBe(1);
    // Missing tint colors are filled (default appearance for that part, else palette first).
    expect(r.state.appearance.parts.top).toEqual({
      part: 'base:top-hoodie',
      colors: { primary: 'navy', secondary: 'charcoal' },
    });
    expect(r.state.appearance.parts.bottom!.colors).toEqual({ primary: 'denim' });
    expect(r.state.appearance.parts.face!.colors).toEqual({});
  });

  it('flaws give points; over budget is rejected', () => {
    expect(errorsOf(carpenter({ skills: { 'base:aiming': 3 } }))).toEqual(['over-budget:-2']);
    const r = checkCharacter(
      index,
      carpenter({ traits: ['base:strong', 'base:weak-back'], skills: { 'base:aiming': 3 } }),
    );
    expect(r.ok && r.state.pointsLeft).toBe(1);
  });

  it('surname is optional (empty or blank is a valid character)', () => {
    for (const lastName of ['', '   ']) {
      const r = checkCharacter(index, carpenter({ lastName }));
      expect(r.ok && r.state.lastName).toBe('');
    }
  });

  it('rejects bad names, slots, parts, colors, traits and skills', () => {
    expect(errorsOf(carpenter({ firstName: ' A ' }))).toEqual(['name:first']);
    expect(errorsOf(carpenter({ lastName: 'K' }))).toEqual(['name:last']);
    expect(errorsOf(carpenter({ firstName: '' }))).toEqual(['name:first']);
    const a = look();
    delete (a.parts as Record<string, unknown>).shoes;
    expect(errorsOf(carpenter({ appearance: a }))).toEqual(['missing-slot:shoes']);
    const b = look();
    b.parts.top = { part: 'base:bottom-jeans' };
    expect(errorsOf(carpenter({ appearance: b }))).toEqual(['part-slot:top']);
    const c = look();
    c.parts.hair = { part: 'base:hair-long', colors: { primary: 'navy' } };
    expect(errorsOf(carpenter({ appearance: c }))).toEqual(['color:hair.primary']);
    const d = look();
    d.parts.face = { part: 'base:face-a', colors: { primary: 'brown' } };
    expect(errorsOf(carpenter({ appearance: d }))).toEqual(['color:face.primary']);
    expect(errorsOf(carpenter({ appearance: { ...look(), skin: 'blue' } }))).toEqual(['skin:blue']);
    expect(errorsOf(carpenter({ profession: 'base:astronaut' }))[0]).toBe(
      'profession:base:astronaut',
    );
    expect(errorsOf(carpenter({ traits: ['base:strong', 'base:weak'] }))).toEqual([
      'trait-conflict:base:strong/base:weak',
    ]);
    expect(errorsOf(carpenter({ traits: ['base:hardened'] }))).toEqual([
      'trait-not-selectable:base:hardened',
    ]);
    expect(errorsOf(carpenter({ skills: { 'base:aiming': 4 } }))).toContain(
      'skill-max:base:aiming',
    );
    expect(errorsOf(carpenter({ traits: [], skills: { 'base:strength': 1 } }))).toEqual([
      'skill-passive:base:strength',
    ]);
  });
});

describe('character creator: in the sim', () => {
  it('newCharacter applies skills, recipes, items, modifiers; view + event; once only', () => {
    const s = sim();
    s.step();
    const cap0 = s.getInventory()!.capacityKg;
    s.drainEvents();
    s.drainView();
    send(s, { type: 'newCharacter', character: carpenter() });
    s.step();
    const ev = eventsOf(s.drainEvents(), 'characterCreated');
    expect(ev[0]!.character).toMatchObject({
      firstName: 'Anna',
      profession: 'base:carpenter',
      traits: ['base:strong'],
      skills: { 'base:aiming': 2 },
      pointsLeft: 1,
    });
    const view = s.drainView()!;
    expect(view.characterProfile?.lastName).toBe('Nowak');
    const lvl = (id: string) => view.skills!.find((k) => k.id === id)!.level;
    expect(lvl('base:carpentry')).toBe(3);
    expect(lvl('base:blunt')).toBe(1);
    expect(lvl('base:aiming')).toBe(2);
    expect(lvl('base:strength')).toBe(7);
    expect(findItem(s, 'base:hammer')).toBeDefined();
    const st = s.world.items!;
    const known = st.progress.get(s.world.c.StableId.value[s.world.players.get(0)!]!)!.known;
    expect(known.map((i) => st.content.recipes[i]!.id)).toEqual(
      expect.arrayContaining(['base:wooden-crate', 'base:build-workbench']),
    );
    expect(s.getInventory()!.capacityKg).toBeCloseTo(cap0 + 3);
    send(s, { type: 'newCharacter', character: carpenter() });
    s.step();
    expect(eventsOf(s.drainEvents(), 'commandRejected')[0]).toMatchObject({
      reason: 'invalid-state',
    });
  });

  it('invalid character: invalid-character with detail', () => {
    const s = sim();
    send(s, { type: 'newCharacter', character: carpenter({ skills: { 'base:aiming': 3 } }) });
    s.step();
    expect(eventsOf(s.drainEvents(), 'commandRejected')[0]).toMatchObject({
      reason: 'invalid-character',
      detail: 'over-budget:-2',
    });
    expect(() => sim({ character: carpenter({ lastName: 'K' }) })).toThrow('name:last');
  });

  it('createSim({ character }) + save/load keeps the character (same hash)', () => {
    const s = sim({ character: carpenter() });
    s.step();
    const b = sim({ load: s.save() });
    s.step();
    b.step();
    expect(b.hash()).toBe(s.hash());
    expect(b.drainView()?.characterProfile).toMatchObject({ firstName: 'Anna', pointsLeft: 1 });
  });
});
