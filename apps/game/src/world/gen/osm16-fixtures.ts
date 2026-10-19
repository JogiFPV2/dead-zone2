// Test helpers of the tiled OSM map (node only: reads the game's public folder).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../public/', import.meta.url));

/** `fetch` over the game's public folder; counts the files read. */
export function publicFetch(log: string[] = []): typeof fetch {
  return (async (url: string) => {
    log.push(url);
    const buf = await readFile(DIR + url);
    return new Response(buf);
  }) as unknown as typeof fetch;
}

/** Screenshot / perf spot „centrum”: a sidewalk in a centrum chunk (not the park next to it). */
export const CENTRUM_SPOT = { x: 9904.5, y: 11744.5 } as const;
