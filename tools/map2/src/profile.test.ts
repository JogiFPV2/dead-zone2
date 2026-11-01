import { describe, expect, it } from 'vitest';
import { parseWidth, roadProfile } from './profile.js';

describe('roadProfile', () => {
  it('width tag wins, then lanes × lane width, then class default', () => {
    expect(roadProfile({ highway: 'primary', width: '9.5' })).toMatchObject({
      width: 9.5,
      widthFrom: 'width',
    });
    expect(roadProfile({ highway: 'primary', lanes: '4' })).toMatchObject({
      width: 14,
      lanes: 4,
      widthFrom: 'lanes',
    });
    expect(roadProfile({ highway: 'residential' })).toMatchObject({
      width: 5.5,
      lanes: 2,
      widthFrom: 'default',
    });
  });
  it('one-way: one lane by default, reverse, roundabout implied', () => {
    expect(roadProfile({ highway: 'secondary', oneway: 'yes' })).toMatchObject({
      oneway: 1,
      lanes: 1,
      width: 3.25,
    });
    expect(roadProfile({ highway: 'secondary', oneway: '-1' })?.oneway).toBe(-1);
    const r = roadProfile({ highway: 'tertiary', junction: 'roundabout' });
    expect(r).toMatchObject({ oneway: 1, roundabout: true, sidewalk: [0, 0] });
  });
  it('dual carriageway half: two lanes one way → lane lines, no centre line', () => {
    const p = roadProfile({ highway: 'primary', oneway: 'yes', lanes: '2' });
    expect(p).toMatchObject({ width: 7, laneLines: true, centreLine: false });
    expect(roadProfile({ highway: 'tertiary' })?.centreLine).toBe(true);
  });
  it('sidewalk tags', () => {
    expect(roadProfile({ highway: 'residential' })?.sidewalk).toEqual([1.5, 1.5]);
    expect(roadProfile({ highway: 'residential', sidewalk: 'no' })?.sidewalk).toEqual([0, 0]);
    expect(roadProfile({ highway: 'residential', sidewalk: 'right' })?.sidewalk).toEqual([0, 1.5]);
    expect(roadProfile({ highway: 'primary', 'sidewalk:both': 'separate' })?.sidewalk).toEqual([
      0, 0,
    ]);
    expect(roadProfile({ highway: 'service', sidewalk: 'both' })?.sidewalk).toEqual([1.5, 1.5]);
  });
  it('links and non-roads', () => {
    expect(roadProfile({ highway: 'primary_link' })).toMatchObject({
      cls: 'primary',
      link: true,
      lanes: 1,
    });
    expect(roadProfile({ highway: 'proposed' })).toBeUndefined();
    expect(roadProfile({ highway: 'pedestrian', area: 'yes' })).toBeUndefined();
  });
  it('parseWidth', () => {
    expect(parseWidth('7 m')).toBe(7);
    expect(parseWidth('5,5')).toBe(5.5);
    expect(parseWidth('wide')).toBeUndefined();
    expect(parseWidth('120')).toBeUndefined();
  });
});
