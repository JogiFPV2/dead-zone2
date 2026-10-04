import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { buildMap } from '../test/fixtures.js';
import { utf8Decode } from './codec.js';
import { SaveError } from './format.js';
import { saveSummary } from './summary.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

/** Sources of the sim (Vite raw import), keyed `../core/clock.ts` … relative to this file. */
const SOURCES = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true });

const savedSim = () => {
  const sim = createSim({
    seed: 3,
    map: buildMap({ width: 48, height: 48 }),
    spawn: { x: 10.5, y: 12.5 },
  });
  for (let i = 0; i < 5; i++) sim.step();
  return sim;
};
const json = (bytes: Uint8Array) => JSON.parse(utf8Decode(bytes)) as Record<string, unknown>;

describe('saveSummary', () => {
  it('position, level, day of a real save (bytes, text or the parsed JSON alike)', () => {
    const sim = savedSim();
    const bytes = sim.save();
    const p = sim.getPlayer()!;
    const want = { x: p.x, y: p.y, z: 0, place: null, day: 1 };
    expect(saveSummary(json(bytes))).toEqual(want);
    expect(saveSummary(bytes)).toEqual(want);
    expect(saveSummary(utf8Decode(bytes))).toEqual(want);
  });

  it('`place` = nearest place of the world plan, null without one', () => {
    const f = json(savedSim().save());
    const places = [
      { name: 'Wolnogród', x: 500, y: 500 },
      { name: 'Lipowiec', x: 20, y: 0 },
      { name: 'Rudnik', x: -30, y: 12 },
    ];
    expect(saveSummary(f, { places }).place).toBe('Lipowiec');
    expect(saveSummary(f, { places: [] }).place).toBeNull();
  });

  it('day from the tick: clock start 09:00, `dayLengthMinutes` (72 000 ticks per day at 60)', () => {
    const f = json(savedSim().save());
    f.tick = 72_000 * 2;
    expect(saveSummary(f).day).toBe(3);
    // 15 h of game time to midnight from 09:00: day 2 after 15/24 of a day.
    f.tick = Math.ceil((72_000 * 15) / 24);
    expect(saveSummary(f).day).toBe(2);
    expect(saveSummary(f, { dayLengthMinutes: 120 }).day).toBe(1);
    expect(saveSummary(f, { clockStart: { day: 4, hour: 0, minute: 0 } }).day).toBe(4);
  });

  it('reads versions 1–3; refuses other files with SaveError codes', () => {
    const f = json(savedSim().save());
    for (const version of [1, 2, 3]) expect(saveSummary({ ...f, version }).day).toBe(1);
    const code = (v: unknown) => {
      try {
        saveSummary(v);
      } catch (e) {
        return e instanceof SaveError ? e.code : 'other';
      }
      return 'ok';
    };
    expect(code({ ...f, version: 9 })).toBe('unsupported-version');
    expect(code({ format: 'x' })).toBe('not-a-save');
    expect(code('{oops')).toBe('not-a-save');
    expect(code({ ...f, players: [] })).toBe('corrupt');
  });

  it('light entry: its imports reach no bitecs, content, worker or DOM code', () => {
    const seen = new Set<string>();
    const external: string[] = [];
    /** `../core/x.ts` / `./codec.ts` keys like the glob's (relative to `save/`). */
    const norm = (from: string, spec: string): string => {
      const parts = from.split('/').slice(0, -1);
      for (const seg of spec.replace(/\.js$/, '.ts').split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.') parts.push(seg);
      }
      return parts.join('/');
    };
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = SOURCES[file.startsWith('save/') ? `./${file.slice(5)}` : `../${file}`];
      expect(text, file).toBeTypeOf('string');
      for (const m of text!.matchAll(/^(?:import|export)[^'";]*?from\s+'([^']+)'/gm)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) walk(norm(file, spec));
        else external.push(spec);
      }
    };
    walk('save/summary.ts');
    expect(external).toEqual([]);
    expect([...seen].sort()).toEqual([
      'core/clock.ts',
      'core/constants.ts',
      'core/rng.ts',
      'save/codec.ts',
      'save/format.ts',
      'save/summary.ts',
    ]);
    for (const f of seen)
      expect(SOURCES[f.startsWith('save/') ? `./${f.slice(5)}` : `../${f}`]).not.toMatch(
        /\b(document|window|self)\./,
      );
  });
});
