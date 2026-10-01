// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { CharacterStore } from '../characters/character-store.js';
import { createMemoryBackend } from '../characters/memory-backend.js';
import { MAX_LIVING_CHARACTERS } from '../characters/schema.js';
import { createCharactersScreen, scrollFor } from './characters-screen.js';

const key = (code: string): KeyboardEvent => new KeyboardEvent('keydown', { code });
const flush = () => new Promise((r) => setTimeout(r, 0));
const world = { map: 'test-town', mode: 'survive' } as const;
const look = { portrait: { skin: '#c99a78', hair: '#3a2a20', shirt: '#4a5a48' } };

async function setup() {
  let t = 1000;
  const store = new CharacterStore(createMemoryBackend(), { now: () => (t += 1000) });
  const dead = await store.create({ name: 'Piotr Wrona', appearance: look, worldSettings: world });
  await store.markDead(dead.id, 0, { cause: 'bleeding', daysSurvived: 5 });
  const ewa = await store.create({ name: 'Ewa Nowak', appearance: look, worldSettings: world });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const on = { play: vi.fn(), new: vi.fn(), close: vi.fn() };
  const screen = createCharactersScreen({
    root,
    store,
    onPlay: on.play,
    onNew: on.new,
    onClose: on.close,
  });
  await flush();
  return { store, root, screen, on, ewa, dead };
}

describe('Postacie screen', () => {
  it('lists cards (most recent first, tombstone without Graj) and plays with Enter', async () => {
    const { root, screen, on, ewa } = await setup();
    const names = [...root.querySelectorAll('.dzo-card-name')].map((n) => n.textContent);
    expect(names).toEqual(['Ewa Nowak', 'Piotr Wrona']);
    const cards = root.querySelectorAll('.dzo-card:not(.dzo-card--empty)');
    expect(cards[1]?.querySelector('[data-act="play"]')).toBeNull();
    expect(cards[1]?.textContent).toContain('Wykrwawienie');
    expect(root.querySelectorAll('.dzo-card--empty')).toHaveLength(2);
    // Only living characters count toward the limit.
    expect(root.querySelector('.dzo-chars-slots')?.textContent).toBe('1 / 20 żywych postaci');
    expect(screen.onKey(key('Enter'))).toBe(true);
    expect(on.play).toHaveBeenCalledWith(expect.objectContaining({ id: ewa.id }));
  });

  it('Usuń asks first; Esc keeps the character, Enter deletes it', async () => {
    const { root, screen, store, dead } = await setup();
    screen.onKey(key('ArrowRight'));
    screen.onKey(key('Enter'));
    expect(root.querySelector('.dzo-confirm--danger')?.textContent).toContain('Piotr Wrona');
    screen.onKey(key('Escape'));
    expect(root.querySelector('.dzo-confirm')).toBeNull();
    expect(await store.get(dead.id)).toBeDefined();
    screen.onKey(key('Enter'));
    screen.onKey(key('Enter'));
    await flush();
    await flush();
    expect(await store.get(dead.id)).toBeUndefined();
    expect(root.querySelectorAll('.dzo-card-name')).toHaveLength(1);
  });

  it('Nowa postać below the cards; Esc goes back', async () => {
    const { screen, on } = await setup();
    screen.onKey(key('ArrowDown'));
    screen.onKey(key('ArrowDown'));
    screen.onKey(key('Enter'));
    expect(on.new).toHaveBeenCalled();
    const s2 = await setup();
    s2.screen.onKey(key('Escape'));
    expect(s2.on.close).toHaveBeenCalled();
  });

  it('at 20 living characters Nowa postać is disabled; tombstones are extra cards', async () => {
    const { store, root, screen, on } = await setup();
    for (let i = 1; i < MAX_LIVING_CHARACTERS; i++) {
      await store.create({ name: `P${i}`, appearance: look, worldSettings: world });
    }
    screen.dispose();
    root.innerHTML = '';
    const s2 = createCharactersScreen({
      root,
      store,
      onPlay: on.play,
      onNew: on.new,
      onClose: on.close,
    });
    await flush();
    expect(root.querySelectorAll('.dzo-card:not(.dzo-card--empty)')).toHaveLength(21);
    expect(root.querySelectorAll('.dzo-card--empty')).toHaveLength(0);
    const btn = root.querySelector('.dzo-chars-new');
    expect(btn?.getAttribute('aria-disabled')).toBe('true');
    expect(btn?.textContent).toContain('limit 20 żywych postaci');
    expect(root.querySelector('.dzo-chars-slots')?.textContent).toBe('20 / 20 żywych postaci');
    s2.onKey(key('ArrowDown'));
    s2.onKey(key('ArrowDown'));
    s2.onKey(key('Enter'));
    expect(on.new).not.toHaveBeenCalled();
  });

  it('scrolls the card row to keep the focused card in view', () => {
    expect(scrollFor(0, 0)).toBe(0);
    expect(scrollFor(3, 0)).toBe(0);
    expect(scrollFor(4, 0)).toBe(256);
    expect(scrollFor(10, 256)).toBe(7 * 256);
    expect(scrollFor(2, 7 * 256)).toBe(512);
    expect(scrollFor(-1, 300)).toBe(300);
  });
});
