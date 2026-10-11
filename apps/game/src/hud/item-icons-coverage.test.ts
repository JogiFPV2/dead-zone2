import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MISSING_ICONS_ALLOWLIST } from './missing-icons-allowlist.js';

const ITEMS_DIR = new URL('../../../../packages/content/data/base/items/', import.meta.url);
const ICONS_DIR = new URL('../../public/icons/', import.meta.url);

const json = <T>(u: URL): T => JSON.parse(readFileSync(u, 'utf8')) as T;
const itemIds = readdirSync(ITEMS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => json<{ id: string }[]>(new URL(f, ITEMS_DIR)).map((i) => i.id));
const icons = json<Record<string, string>>(new URL('index.json', ICONS_DIR));
const hasIcon = (id: string): boolean => {
  const file = icons[id];
  return typeof file === 'string' && existsSync(new URL(file, ICONS_DIR));
};

describe('każdy przedmiot z paczki bazowej ma ikonę (public/icons)', () => {
  it('czyta przedmioty i indeks ikon', () => {
    expect(itemIds.length).toBeGreaterThan(100);
    expect(Object.keys(icons).length).toBeGreaterThan(50);
  });

  it('przedmiot bez ikony musi być na MISSING_ICONS_ALLOWLIST', () => {
    const missing = itemIds.filter((id) => !hasIcon(id) && !MISSING_ICONS_ALLOWLIST.has(id));
    expect(missing, 'nowy przedmiot bez ikony: dodaj ikonę (Designer)').toEqual([]);
  });

  it('allowlista tylko maleje: przedmiot z ikoną albo nieistniejący trzeba z niej usunąć', () => {
    const ids = new Set(itemIds);
    const stale = [...MISSING_ICONS_ALLOWLIST].filter((id) => hasIcon(id) || !ids.has(id));
    expect(stale, 'usuń z MISSING_ICONS_ALLOWLIST').toEqual([]);
  });
});
