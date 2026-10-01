import { describe, expect, it } from 'vitest';
import { iconFile, iconIndex } from './icons.js';

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
});
