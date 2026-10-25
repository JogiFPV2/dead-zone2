import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** One icon: rendered from `src` (relative to `icons/src`) and saved for every item id. */
export interface IconJob {
  items: string[];
  src: string;
  /** Model-space normalisation (degrees, XYZ); camera and lights are fixed by the rig. */
  rot?: [number, number, number];
}

/** Content id → icon file name (`base:kitchen-knife` → `kitchen-knife.png`). */
export const iconFile = (itemId: string): string => `${itemId.replace(/^[a-z0-9-]+:/, '')}.png`;

/**
 * `icons/index.json`: item id → file (the game falls back to vector icons for the rest).
 * `prerendered`: ids whose PNG the Designer renders outside this tool (`icons/prerendered.json`,
 * partie 4/4b) — kept in the index, never re-rendered here.
 */
export function iconIndex(
  jobs: readonly IconJob[],
  prerendered: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const j of jobs) for (const id of [...j.items].sort()) out[id] = iconFile(id);
  for (const id of prerendered) out[id] = iconFile(id);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Jobs the pipeline actually renders: ids listed in `prerendered` keep the Designer's PNG
 * (e.g. batch 7 swaps of pistols / ammo / bandages that still need their model in `items.json`
 * for the weapon in hand), jobs left without ids are skipped.
 */
export function jobsToRender(
  jobs: readonly IconJob[],
  prerendered: readonly string[] = [],
): IconJob[] {
  const pre = new Set(prerendered);
  return jobs
    .map((j) => ({ ...j, items: j.items.filter((id) => !pre.has(id)) }))
    .filter((j) => j.items.length > 0);
}

interface Page {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: string): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  on(event: 'pageerror', cb: (e: Error) => void): void;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(o: { executablePath: string; args: string[] }): Promise<Browser> };
}

/**
 * Renders item icons with the Designer's fixed rig (`icons/rig.html`: ortho camera 30°/35°,
 * key / fill / rim + hemisphere light, 2× supersampling, 2 px outline + glow) in headless
 * Chrome (SwiftShader). Offline tool: needs Chrome and playwright-core (`PLAYWRIGHT_CORE`).
 */
export async function renderIcons(opts: {
  toolDir: string;
  outDir: string;
  size: number;
}): Promise<void> {
  const iconsDir = join(opts.toolDir, 'icons');
  const jobs = JSON.parse(await readFile(join(iconsDir, 'items.json'), 'utf8')) as IconJob[];
  const prerendered = JSON.parse(
    await readFile(join(iconsDir, 'prerendered.json'), 'utf8'),
  ) as string[];
  const mod = (await import(
    process.env.PLAYWRIGHT_CORE ??
      '/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.js'
  )) as Partial<Playwright> & { default?: Playwright };
  const pw = mod.chromium ? (mod as Playwright) : mod.default;
  if (!pw) throw new Error('playwright-core not found (set PLAYWRIGHT_CORE)');
  const browser = await pw.chromium.launch({
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--allow-file-access-from-files',
    ],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('rig:', e.message));
    await page.goto(pathToFileURL(join(iconsDir, 'rig.html')).href);
    await page.waitForFunction('window.__ready');
    await mkdir(opts.outDir, { recursive: true });
    for (const job of jobsToRender(jobs, prerendered)) {
      const file = pathToFileURL(resolve(iconsDir, 'src', job.src)).href;
      const dataUrl = await page.evaluate(
        ([f, rot, size]) =>
          (
            globalThis as unknown as {
              renderItem(it: { file: string; rot: readonly number[] }, s: number): Promise<string>;
            }
          ).renderItem({ file: f, rot }, size),
        [file, job.rot ?? [0, 0, 0], opts.size] as const,
      );
      const png = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
      for (const id of job.items) await writeFile(join(opts.outDir, iconFile(id)), png);
      console.log(`${job.items.join(', ')} ← ${job.src}`);
    }
    await writeFile(
      join(opts.outDir, 'index.json'),
      `${JSON.stringify(iconIndex(jobs, prerendered), null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
}
