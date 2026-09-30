import type { PackFile } from '@deadzone/content';

/** What the HUD needs from content (names are i18n keys; texts come from labels.ts for now). */
export interface HudMoodleDef {
  id: string;
  polarity: 'negative' | 'positive';
}

export interface HudItemDef {
  id: string;
  kind: string;
  maxStack: number;
  /** Melee category (`blade_short`, `improvised`, …) for the icon. */
  meleeCategory?: string;
}

export interface HudContentIndex {
  moodles: ReadonlyMap<string, HudMoodleDef>;
  items: ReadonlyMap<string, HudItemDef>;
}

export const EMPTY_HUD_CONTENT: HudContentIndex = { moodles: new Map(), items: new Map() };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v : [v]).filter(isObj);

/**
 * Reads moodle polarity and item kinds straight from raw pack files (already validated by the
 * sim worker; here only the fields the HUD shows, without pulling zod into the main thread).
 */
export function buildHudContentIndex(files: readonly PackFile[]): HudContentIndex {
  const moodles = new Map<string, HudMoodleDef>();
  const items = new Map<string, HudItemDef>();
  for (const f of files) {
    if (!('json' in f)) continue;
    if (f.path.startsWith('moodles/')) {
      for (const m of list(f.json)) {
        if (typeof m.id !== 'string') continue;
        moodles.set(m.id, {
          id: m.id,
          polarity: m.polarity === 'positive' ? 'positive' : 'negative',
        });
      }
    } else if (f.path.startsWith('items/')) {
      for (const i of list(f.json)) {
        if (typeof i.id !== 'string') continue;
        const melee =
          isObj(i.melee) && typeof i.melee.category === 'string' ? i.melee.category : '';
        items.set(i.id, {
          id: i.id,
          kind: typeof i.kind === 'string' ? i.kind : 'misc',
          maxStack: typeof i.maxStack === 'number' ? i.maxStack : 1,
          ...(melee ? { meleeCategory: melee } : {}),
        });
      }
    }
  }
  return { moodles, items };
}
