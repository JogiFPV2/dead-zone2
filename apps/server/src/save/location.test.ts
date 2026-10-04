import { MAP_SIZE_M } from '@deadzone/protocol';
import { SAVE_VERSION } from '@deadzone/sim';
import { describe, expect, it, vi } from 'vitest';
import { envelope } from '../test/fixtures.js';
import { SaveError } from '@deadzone/sim/save-summary';
import { MAX_PLACE_CHARS, sanitizeLocation, summarizeLocation } from './location.js';
import { validateEnvelope } from './validate.js';

const ID = '33333333-3333-4333-8333-333333333333';
const OPTS = { saveFormatVersion: SAVE_VERSION, maxStateBytes: 8 * 1024 * 1024 };

describe('sanitizeLocation', () => {
  it('keeps a good summary', () => {
    expect(sanitizeLocation({ x: 200.5, y: 310.25, z: 1, place: 'Lipowiec', day: 4 })).toEqual({
      place: 'Lipowiec',
      x: 200.5,
      y: 310.25,
      z: 1,
      day: 4,
    });
  });

  it('rejects non-finite or non-numeric coordinates and day', () => {
    for (const bad of [
      null,
      undefined,
      'Lipowiec',
      [1, 2, 0],
      { y: 1, z: 0, day: 1 },
      { x: Number.NaN, y: 1, z: 0, day: 1 },
      { x: 1, y: Number.POSITIVE_INFINITY, z: 0, day: 1 },
      { x: '1', y: 1, z: 0, day: 1 },
      { x: 1, y: 1, z: 'up', day: 1 },
      { x: 1, y: 1, z: 0, day: Number.NaN },
      { x: 1, y: 1, z: 0 },
    ]) {
      expect(sanitizeLocation(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('clamps coordinates, floor and day; missing z is the ground floor', () => {
    expect(sanitizeLocation({ x: -5, y: 1e12, z: 999.6, place: 'A', day: -3 })).toEqual({
      place: 'A',
      x: 0,
      y: MAP_SIZE_M,
      z: 127,
      day: 0,
    });
    expect(sanitizeLocation({ x: 1, y: 2, z: -500, day: 7.9 })).toMatchObject({ z: -128, day: 7 });
    expect(sanitizeLocation({ x: 1, y: 2, day: 1e15 })).toMatchObject({ z: 0, day: 0x7fff_ffff });
    // real column: stored as float32.
    expect(sanitizeLocation({ x: 0.1, y: 0.2, z: 0, day: 0 })).toMatchObject({
      x: Math.fround(0.1),
      y: Math.fround(0.2),
    });
  });

  it('trims, cleans and limits the place name', () => {
    const at = (place: unknown) => sanitizeLocation({ x: 1, y: 1, z: 0, day: 1, place })?.place;
    expect(at('  Stare   Miasto \n')).toBe('Stare Miasto');
    expect(at('Lipo\u202ewiec\u0000')).toBe('Lipowiec');
    expect(at('x'.repeat(200))).toBe('x'.repeat(MAX_PLACE_CHARS));
    expect([...at('ż'.repeat(70) + '🍞'.repeat(5))!]).toHaveLength(MAX_PLACE_CHARS);
    expect(at('   ')).toBeNull();
    expect(at(42)).toBeNull();
    expect(at(undefined)).toBeNull();
    expect(at({ name: 'x' })).toBeNull();
  });
});

describe('summarizeLocation', () => {
  it('a SaveError, another throw or a bad result give null with a failure for the log', () => {
    expect(
      summarizeLocation({}, () => {
        throw new SaveError('corrupt', 'no player');
      }),
    ).toEqual({ location: null, failure: { kind: 'save-error', code: 'corrupt' } });
    expect(
      summarizeLocation({}, () => {
        throw new Error('boom');
      }),
    ).toEqual({ location: null, failure: { kind: 'error' } });
    expect(summarizeLocation({}, () => ({ x: 'a' }))).toEqual({
      location: null,
      failure: { kind: 'invalid-summary' },
    });
  });

  it('uses the real sim saveSummary by default (#155)', () => {
    expect(summarizeLocation({ hello: 1 })).toEqual({
      location: null,
      failure: { kind: 'save-error', code: 'not-a-save' },
    });
  });

  it('passes the day length to the sim', () => {
    const fn = vi.fn(() => ({ x: 1, y: 1, z: 0, place: null, day: 1 }));
    summarizeLocation({ a: 1 }, fn, { dayLengthMinutes: 90 });
    expect(fn).toHaveBeenCalledWith({ a: 1 }, { dayLengthMinutes: 90 });
  });
});

describe('validateEnvelope + saveSummary', () => {
  it('runs the summary on the validated state only', () => {
    const summary = vi.fn((state: unknown) => ({
      x: 12,
      y: 34,
      z: 0,
      place: 'Lipowiec',
      day: (state as { seed: number }).seed,
    }));
    const ok = validateEnvelope(envelope(ID, 5), OPTS, summary);
    expect(ok.location).toEqual({ place: 'Lipowiec', x: 12, y: 34, z: 0, day: 5 });
    expect(summary).toHaveBeenCalledTimes(1);

    expect(() =>
      validateEnvelope(envelope(ID, 5, { state: { hello: 1 } }), OPTS, summary),
    ).toThrow();
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it('the real summary reads the position of the validated save', () => {
    const r = validateEnvelope(envelope(ID, 5), OPTS);
    expect(r.summaryFailure).toBeUndefined();
    expect(r.location).toMatchObject({ place: null, z: 0 });
  });
});
