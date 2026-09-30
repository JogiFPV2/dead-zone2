import { describe, expect, it } from 'vitest';
import { MapChunkSchema } from '../schemas/map/chunk.js';
import { tileIndex } from '../schemas/map/constants.js';
import { paletteId, paletteValue } from '../schemas/map/palette.js';
import { chunk } from './map-fixtures.js';

const paths = (r: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.'));

describe('MapChunkSchema', () => {
  it('dekoduje warstwy do Uint16Array[1024] (RLE i base64)', () => {
    const c = MapChunkSchema.parse(chunk());
    expect(c.layers.floor).toBeInstanceOf(Uint16Array);
    expect(c.layers.floor).toHaveLength(1024);
    expect(c.layers.roof?.[tileIndex(0, 0)]).toBe(2);
    expect(c.layers.roof?.[tileIndex(1, 0)]).toBe(0);
    expect(c.layers.room?.[0]).toBe(1);
    expect(paletteId(c.palette, c.layers.floor[5]!)).toBe('base:grass');
    expect(paletteId(c.palette, 0)).toBeUndefined();
    expect(c.objects[0]).toEqual({ contentId: 'base:cabinet', x: 0, y: 0, rot: 1 });
  });

  it('warstwa o złej długości to błąd ze ścieżką', () => {
    const r = MapChunkSchema.safeParse(
      chunk(undefined, { layers: { floor: { rle: [[1, 1000]] } } }),
    );
    expect(paths(r)).toEqual(['layers.floor']);
    expect(r.error?.issues[0]?.message).toMatch(/1000.*1024/);
    const b64 = MapChunkSchema.safeParse(
      chunk(undefined, { layers: { floor: { base64: 'AQACAA==' } } }),
    );
    expect(paths(b64)).toEqual(['layers.floor']);
  });

  it('wartości warstw muszą mieścić się w palecie, a roomId w rooms', () => {
    const r = MapChunkSchema.safeParse(
      chunk(undefined, {
        palette: ['base:grass'],
        layers: {
          floor: {
            rle: [
              [1, 1023],
              [2, 1],
            ],
          },
          room: { rle: [[9, 1024]] },
        },
      }),
    );
    expect(paths(r)).toEqual(['layers.floor', 'layers.room']);
    expect(r.error?.issues[0]?.message).toMatch(/kafel \(31, 31\): wartość 2 poza paletą/);
  });

  it('rooms bez warstwy room, powtórzona krawędź i paleta z duplikatem to błędy', () => {
    const edge = { x: 1, y: 1, side: 'w', type: 'door', contentId: 'base:door' };
    const r = MapChunkSchema.safeParse(
      chunk(undefined, { layers: { floor: { rle: [[1, 1024]] } }, edges: [edge, edge] }),
    );
    expect(paths(r)).toEqual(['layers.room', 'edges.1']);
    const dup = MapChunkSchema.safeParse(
      chunk(undefined, { palette: ['base:grass', 'base:grass'] }),
    );
    expect(paths(dup)).toEqual(['palette']);
  });

  it('obiekt: rot 0–3, offset w ±0,5 kafla, kafel 0–31', () => {
    const obj = (o: Record<string, unknown>) =>
      MapChunkSchema.safeParse(
        chunk(undefined, { objects: [{ contentId: 'base:x', x: 0, y: 0, ...o }] }),
      );
    expect(obj({ rot: 3, offset: { x: 0.5, y: -0.25 } }).success).toBe(true);
    expect(obj({ rot: 4 }).success).toBe(false);
    expect(obj({ offset: { x: 0.6, y: 0 } }).success).toBe(false);
    expect(obj({ x: 32 }).success).toBe(false);
  });

  it('krawędź ma typ wall|window|door i stronę n|w; stanu dynamicznego nie ma w schemacie', () => {
    const e = { x: 0, y: 0, side: 'n', contentId: 'base:wall' };
    expect(
      MapChunkSchema.safeParse(chunk(undefined, { edges: [{ ...e, type: 'fence' }] })).success,
    ).toBe(false);
    expect(
      MapChunkSchema.safeParse(chunk(undefined, { edges: [{ ...e, type: 'door', side: 's' }] }))
        .success,
    ).toBe(false);
    expect(
      MapChunkSchema.safeParse(chunk(undefined, { edges: [{ ...e, type: 'door', open: true }] }))
        .success,
    ).toBe(false);
    expect(MapChunkSchema.safeParse({ ...chunk(), containers: {} }).success).toBe(false);
  });

  it('paletteValue dopisuje nowe id i zwraca wartość warstwy', () => {
    const p = ['base:a'];
    expect(paletteValue(p, 'base:a')).toBe(1);
    expect(paletteValue(p, 'base:b')).toBe(2);
    expect(p).toEqual(['base:a', 'base:b']);
  });
});
