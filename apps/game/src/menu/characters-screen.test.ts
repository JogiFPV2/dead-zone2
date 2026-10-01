// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { CharacterStore } from '../characters/character-store.js';
import { createMemoryBackend } from '../characters/memory-backend.js';
import { createCharactersScreen } from './characters-screen.js';

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
});
