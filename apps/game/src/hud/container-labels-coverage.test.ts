import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTAINER_LABELS, containerName, humanizeId } from './labels.js';

const CONTAINERS_DIR = new URL(
  '../../../../packages/content/data/base/containers/',
  import.meta.url,
);

const json = <T>(u: URL): T => JSON.parse(readFileSync(u, 'utf8')) as T;
const containerIds = readdirSync(CONTAINERS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => json<{ id: string }[]>(new URL(f, CONTAINERS_DIR)).map((c) => c.id))
  .sort();

describe('każdy typ mebla/schowka z paczki bazowej ma polską etykietę (labels.ts)', () => {
  it('czyta typy schowków z packages/content', () => {
    expect(containerIds.length).toBeGreaterThan(20);
    expect(containerIds).toContain('base:fridge-freezer');
    expect(containerIds).toContain('base:freezer');
  });

  it('CONTAINER_LABELS ma wpis dla każdego typu schowka (i nic zbędnego)', () => {
    expect(Object.keys(CONTAINER_LABELS).sort()).toEqual(containerIds);
  });

  it('containerName zwraca polską nazwę, nie humanizeId', () => {
    for (const id of containerIds) {
      const name = containerName(id, 'world');
      expect(name, id).toBe(CONTAINER_LABELS[id]);
      expect(name, id).not.toBe(humanizeId(id));
      expect(name.length, id).toBeGreaterThan(0);
    }
  });

  it('nowe meble z #204 mają ustalone nazwy', () => {
    expect(containerName('base:oven', 'world')).toBe('Piekarnik');
    expect(containerName('base:gas-stove', 'world')).toBe('Kuchenka gazowa');
    expect(containerName('base:fridge-freezer', 'world')).toBe('Lodówka z zamrażarką');
    expect(containerName('base:freezer', 'world')).toBe('Zamrażarka');
    expect(containerName('base:desk', 'world')).toBe('Biurko');
    expect(containerName('base:tv-stand', 'world')).toBe('Szafka RTV');
    expect(containerName('base:bathroom-cabinet', 'world')).toBe('Szafka łazienkowa');
    expect(containerName('base:shop-counter', 'world')).toBe('Lada sklepowa');
  });

  it('zlewy i kuchenka z piekarnikiem mają ustalone nazwy', () => {
    expect(containerName('base:kitchen-sink', 'world')).toBe('Zlew kuchenny');
    expect(containerName('base:bathroom-sink', 'world')).toBe('Umywalka');
    expect(containerName('base:range', 'world')).toBe('Kuchenka z piekarnikiem');
  });
});
