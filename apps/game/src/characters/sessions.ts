import type { CreatorResult } from '../creator/creator-screen.js';
import type { GameSession } from '../session.js';
import type { CharacterStore } from './character-store.js';
import { portraitOf } from './portrait.js';
import type { CharacterRecord, WorldSettings } from './schema.js';

/** Graj / Kontynuuj: the character with its save; marks it as just played. */
export async function sessionOf(store: CharacterStore, c: CharacterRecord): Promise<GameSession> {
  const save = await store.loadSave(c.id);
  await store.touch(c.id);
  return { character: c, save };
}

/** New game: the creator's character and a fresh world of its own. */
export async function newSession(
  store: CharacterStore,
  created: CreatorResult,
  world: WorldSettings,
): Promise<GameSession> {
  const { firstName, lastName } = created.spec;
  const character = await store.create({
    name: `${firstName} ${lastName}`.trim(),
    appearance: { portrait: portraitOf(created.look), spec: created.spec, look: created.look },
    worldSettings: world,
  });
  return { character, created };
}
