import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iconFile, iconIndex, type IconJob } from './icons.js';

const ICONS_DIR = new URL('../icons/', import.meta.url);
const OUT = new URL('../../../apps/game/public/icons/', import.meta.url);
const json = <T>(u: URL): T => JSON.parse(readFileSync(u, 'utf8')) as T;

describe('icons', () => {
  it('names files after the content id without the pack prefix', () => {
    expect(iconFile('base:kitchen-knife')).toBe('kitchen-knife.png');
  });

  it('indexes every item of every job, sorted', () => {
    expect(
      iconIndex([
        { items: ['base:water-bottle', 'base:dirty-water-bottle'], src: 'a.glb' },
        { items: ['base:bandage'], src: 'b.glb' },
      ]),
    ).toEqual({
      'base:bandage': 'bandage.png',
      'base:dirty-water-bottle': 'dirty-water-bottle.png',
      'base:water-bottle': 'water-bottle.png',
    });
  });

  it('keeps pre-rendered icons (Designer, partie 4/4b) in the index', () => {
    expect(iconIndex([{ items: ['base:b'], src: 'b.glb' }], ['base:a'])).toEqual({
      'base:a': 'a.png',
      'base:b': 'b.png',
    });
  });

  it('the shipped index is exactly items.json + prerendered.json, every file present', () => {
    const jobs = json<IconJob[]>(new URL('items.json', ICONS_DIR));
    const pre = json<string[]>(new URL('prerendered.json', ICONS_DIR));
    const shipped = json<Record<string, string>>(new URL('index.json', OUT));
    expect(shipped).toEqual(iconIndex(jobs, pre));
    for (const f of Object.values(shipped)) expect(existsSync(new URL(f, OUT)), f).toBe(true);
  });
});
