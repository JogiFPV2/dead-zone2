/**
 * Static preview sheet: every component in every state (spec §3 tables), rendered with the real
 * components into plain HTML (no JS at view time), once per light mood.
 *
 *   pnpm --filter @deadzone/ui preview                       → dist/preview/preview-{night,day,dusk}.html
 *   pnpm --filter @deadzone/ui preview -- --png out.png      → also PNGs via headless Chrome
 *                                                               (out.png = day, out-night.png, out-dusk.png)
 * CHROME_BIN overrides the browser binary (default: google-chrome).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { pkgDir } from './token-files.js';
import { COMPONENT_CSS, FONTS_CSS, TOKENS_CSS } from '../src/styles/files.js';
import { copyFonts } from './build-css.js';
import { contrastRatio } from '../src/tokens/contrast.js';
import { tokens } from '../src/tokens/tokens.generated.js';
import type { Doc } from '../src/dom/h.js';
import {
  ACTION_STATES,
  ACTION_VARIANTS,
  POLARITIES,
  SLOT_STATES,
  STAT_IDS,
  VISIBLE_LEVELS,
  createActionButton,
  createInventorySlot,
  createKeyBadge,
  createMinimap,
  createMoodle,
  createMoodleList,
  createStatBar,
  createStatBars,
  createThreatBanner,
  createVignette,
  parseRgba,
  vignetteAt,
  type ActionState,
  type HudMood,
  type InventorySlotProps,
  type MinimapVM,
  type SlotItem,
  type SlotState,
  type StatBarProps,
} from '../src/index.js';

const HEIGHT = 1480;
const hm = (h: number, m = 0): number => h * 60 + m;
/** Scene colours behind the HUD per mood (spec §4: night background, dusk fog, day background). */
const MOOD_BG: Record<HudMood, string> = { night: '#0d1112', dusk: '#3b3a3f', day: '#7d8588' };
const MOODS: HudMood[] = ['night', 'day', 'dusk'];
const MOOD_LABEL: Record<HudMood, string> = {
  night: 'NOC (zatwierdzona)',
  day: 'DZIEŃ (chipy dzienne, do akceptacji)',
  dusk: 'ZMIERZCH (winieta nocy 60%)',
};

const css = async (): Promise<string> => {
  const read = (rel: string) => readFile(`${pkgDir}src/${rel}`, 'utf8');
  // Fonts live in dist/fonts; the preview HTML sits in dist/preview.
  const fonts = (await read(FONTS_CSS)).replaceAll("url('./fonts/", "url('../fonts/");
  const parts = [fonts, await read(TOKENS_CSS), ...(await Promise.all(COMPONENT_CSS.map(read)))];
  parts.push(await readFile(`${pkgDir}preview/preview.css`, 'utf8'));
  return parts.join('\n');
};

function buildSheet(doc: Doc, mood: HudMood): HTMLElement {
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const cell = (node: HTMLElement, caption: string) => {
    const c = h('div', 'pv-cell');
    c.append(node, h('span', 'pv-cap', caption));
    return c;
  };
  const section = (title: string, wide = false) => {
    const s = h('section', `pv-section${wide ? ' wide' : ''}`);
    s.append(h('h2', '', title));
    return s;
  };
  const grid = (cols: string) => {
    const g = h('div', 'pv-grid');
    g.style.gridTemplateColumns = cols;
    return g;
  };

  const root = h('main', 'pv');
  const header = h('header', 'pv-header');
  header.append(
    h('h1', '', 'Deadzone · HUD A · @deadzone/ui'),
    h(
      'p',
      '',
      `nastrój: ${MOOD_LABEL[mood]} · 1920 px · --ui-scale 1 · animacje zatrzymane · fonty lokalne (OFL)`,
    ),
  );
  root.append(header);

  // ---- Moodle ----
  const moodles = section('Moodle (StatusChip) · polaryzacja × poziom');
  const mg = grid('60px repeat(4, max-content) max-content');
  mg.append(h('span'), ...VISIBLE_LEVELS.map((l) => h('span', 'pv-cap', `poziom ${l}`)), h('span'));
  const names = {
    neg: ['Infekcja', 'Ból', 'Krwawienie', 'Gorączka'],
    pos: ['Najedzony', 'Wypoczęty', 'Szczęśliwy', 'Adrenalina'],
  };
  for (const polarity of POLARITIES) {
    mg.append(h('span', 'pv-rowhead', polarity));
    for (const level of VISIBLE_LEVELS) {
      const chip = createMoodle(
        { label: names[polarity][level - 1] ?? '', polarity, level, noEnter: true },
        doc,
      );
      const set = tokens.color.moodle[polarity][level];
      const bg = mood === 'day' ? set.bg.day : set.bg.$value;
      const k = contrastRatio(set.text, bg, MOOD_BG[mood]).toFixed(2);
      mg.append(
        cell(
          chip.el,
          `${polarity}.${level} · ${k}:1${polarity === 'neg' && level === 4 ? ' · puls' : ''}`,
        ),
      );
    }
    mg.append(h('span'));
  }
  moodles.append(
    mg,
    h(
      'p',
      'pv-note',
      mood === 'day'
        ? 'Dzień: tła bg.day (α 0.92) + obrys border.chip.day; kontrast tekstu na tle dnia.'
        : 'Noc i zmierzch: tła nocne (bez zmian); kontrast tekstu na tle tego nastroju.',
    ),
  );
  const mrow = h('div', 'pv-row');
  mrow.style.marginTop = '20px';
  const list = createMoodleList(
    [
      { id: 'fed', label: 'Najedzony', polarity: 'pos', level: 1, since: 1 },
      { id: 'pain', label: 'Ból', polarity: 'neg', level: 2, since: 2 },
      { id: 'inf', label: 'Infekcja', polarity: 'neg', level: 1, since: 0 },
      { id: 'hid', label: 'Ukryty', polarity: 'neg', level: 0, since: 0 },
      { id: 'fever', label: 'Gorączka', polarity: 'neg', level: 3, since: 3 },
      { id: 'calm', label: 'Spokój', polarity: 'pos', level: 2, since: 4 },
      { id: 'wet', label: 'Mokry', polarity: 'neg', level: 1, since: 5 },
    ],
    { maxVisible: 5 },
    doc,
  );
  mrow.append(
    cell(
      list.el,
      'lista: neg → pos, poziom malejąco, „+N” neutralny; poziom 0 nie jest renderowany',
    ),
  );
  const tipChip = createMoodle(
    {
      label: 'Ból',
      polarity: 'neg',
      level: 2,
      description: 'Ból 2: celność −10%, wolniejsze akcje.',
      noEnter: true,
    },
    doc,
  );
  tipChip.el.dataset.state = 'hover';
  const tipWrap = h('div');
  tipWrap.style.height = '84px';
  tipWrap.append(tipChip.el);
  mrow.append(cell(tipWrap, 'hover: mini-tooltip (250 ms)'));
  moodles.append(mrow);

  // ---- ActionButton ----
  const actions = section('ActionButton · wariant × stan', true);
  const ag = grid('90px repeat(6, max-content)');
  ag.style.columnGap = '40px';
  ag.append(
    h('span'),
    ...[...ACTION_STATES, 'focus-visible', 'przytrzymanie'].map((s) => h('span', 'pv-cap', s)),
  );
  for (const variant of ACTION_VARIANTS) {
    ag.append(h('span', 'pv-rowhead', variant));
    const label = variant === 'primary' ? 'Przeszukaj' : 'Upuść';
    const key = variant === 'primary' ? 'e' : 'g';
    for (const state of ACTION_STATES as readonly ActionState[]) {
      const btn = createActionButton(
        {
          label,
          icon: 'target',
          key,
          variant,
          enabled: state !== 'disabled',
          ...(state === 'hover' || state === 'pressed' ? { forced: state } : {}),
        },
        doc,
      );
      ag.append(btn.el);
    }
    ag.append(
      createActionButton(
        { label, icon: 'target', key, variant, enabled: true, forced: 'focus' },
        doc,
      ).el,
    );
    ag.append(
      createActionButton(
        { label, icon: 'target', key, variant, enabled: true, progress: 0.45 },
        doc,
      ).el,
    );
  }
  actions.append(ag);
  const keys = h('div', 'pv-row');
  keys.style.marginTop = '20px';
  keys.append(
    cell(createKeyBadge({ keyLabel: 'j' }, doc).el, 'KeyBadge light'),
    cell(
      (() => {
        const wrap = h('span');
        wrap.style.cssText =
          'display:inline-flex;padding:6px;border-radius:6px;background:var(--color-accent-base)';
        wrap.append(createKeyBadge({ keyLabel: 'e', variant: 'inverse' }, doc).el);
        return wrap;
      })(),
      'KeyBadge inverse (na primary)',
    ),
  );
  actions.append(keys);

  // ---- StatBar ----
  const stats = section('StatBar · stan × statystyka', true);
  const sg = grid('90px repeat(4, max-content)');
  sg.style.columnGap = '48px';
  const cases: { name: string; props: (stat: StatBarProps['stat']) => StatBarProps }[] = [
    { name: 'normal', props: (stat) => ({ stat, value: 72 }) },
    { name: 'low (≤30)', props: (stat) => ({ stat, value: 27 }) },
    { name: 'critical (≤15)', props: (stat) => ({ stat, value: 11 }) },
    { name: 'drain (72 → 48)', props: (stat) => ({ stat, value: 48, drainFrom: 72 }) },
  ];
  sg.append(h('span'), ...cases.map((c) => h('span', 'pv-cap', c.name)));
  for (const stat of STAT_IDS) {
    sg.append(h('span', 'pv-rowhead', stat));
    for (const c of cases) {
      const bar = createStatBar(
        { ...c.props(stat), value: c.props(stat).value },
        { now: () => 0 },
        doc,
      );
      sg.append(bar.el);
    }
  }
  stats.append(sg);
  const srow = h('div', 'pv-row');
  srow.style.marginTop = '20px';
  srow.append(
    cell(
      createStatBars({ health: 72, thirst: 41, hunger: 58, energy: 84 }, { now: () => 0 }, doc).el,
      'StatBars 842×40 (makieta)',
    ),
    cell(
      createStatBar({ stat: 'energy', value: 64, size: 'panel' }, { now: () => 0 }, doc).el,
      'wariant panelu (pasek 6 px)',
    ),
  );
  stats.append(srow);

  // ---- InventorySlot ----
  const slots = section('InventorySlot · stany');
  const knife: SlotItem = {
    id: 'knife',
    name: 'Nóż kuchenny',
    icon: 'knife',
    stackable: false,
    usable: true,
  };
  const water: SlotItem = {
    id: 'water',
    name: 'Woda',
    icon: 'bottle',
    stackable: true,
    count: 2,
    usable: true,
  };
  const stateProps: Record<SlotState, InventorySlotProps> = {
    empty: { item: null, keybind: '5' },
    filled: { item: water, keybind: '3' },
    selected: { item: knife, keybind: '1', selected: true },
    disabled: {
      item: { ...knife, id: 'pistol', name: 'Pistolet', icon: 'crowbar', usable: false },
      keybind: '2',
    },
    hover: { item: water, keybind: '4', hover: true, hoverable: true },
  };
  const srowSlots = h('div', 'pv-row');
  for (const state of SLOT_STATES)
    srowSlots.append(cell(createInventorySlot(stateProps[state], doc).el, state));
  srowSlots.append(
    cell(
      createInventorySlot({ item: null, keybind: '5', selected: true }, doc).el,
      'selected (pusty)',
    ),
  );
  slots.append(srowSlots);
  const hotbar = h('div', 'pv-hotbar dz-glass');
  const hotItems: (SlotItem | null)[] = [
    knife,
    { id: 'crowbar', name: 'Łom', icon: 'crowbar', stackable: false, usable: true },
    water,
    { id: 'can', name: 'Konserwa', icon: 'can', stackable: true, count: 1, usable: true },
    null,
  ];
  hotItems.forEach((item, i) =>
    hotbar.append(createInventorySlot({ item, keybind: String(i + 1), selected: i === 0 }, doc).el),
  );
  const hrow = h('div', 'pv-row');
  hrow.style.marginTop = '20px';
  hrow.append(cell(hotbar, 'Hotbar 370×82 (makieta)'));
  slots.append(hrow);

  // ---- Minimap ----
  const maps = section('Minimap · domyślnie north-up, opcja obrót z kamerą');
  const world: Omit<MinimapVM, 'cameraYaw'> = {
    player: { x: 0, z: 0, heading: -Math.PI / 2 },
    roads: [
      [
        { x: -45, z: 2 },
        { x: 45, z: 2 },
      ],
      [
        { x: 10, z: -45 },
        { x: 10, z: 45 },
      ],
    ],
    buildings: [
      [
        { x: -25, z: -23 },
        { x: -4, z: -23 },
        { x: -4, z: -7 },
        { x: -25, z: -7 },
      ],
      [
        { x: 18, z: 13 },
        { x: 34, z: 13 },
        { x: 34, z: 31 },
        { x: 18, z: 31 },
      ],
    ],
    pois: [{ x: 20, z: -19, kind: 'objective' }],
    enemies: [
      { x: -12, z: 15 },
      { x: -6, z: 20 },
    ],
  };
  const mrowMaps = h('div', 'pv-row');
  mrowMaps.append(
    cell(
      createMinimap({ ...world, cameraYaw: Math.PI / 4 }, {}, doc).el,
      'north-up (domyślnie) · „N” stale u góry',
    ),
    cell(
      createMinimap({ ...world, cameraYaw: Math.PI / 4 }, { orientation: 'camera' }, doc).el,
      'opcja: camera · yaw 45°',
    ),
    cell(
      createMinimap({ ...world, cameraYaw: (3 * Math.PI) / 4 }, { orientation: 'camera' }, doc).el,
      'opcja: camera · yaw 135°',
    ),
  );
  maps.append(mrowMaps);
  maps.append(
    h('p', 'pv-note', 'Gracz patrzy na północ. Te same dane we wszystkich trzech wariantach.'),
  );
  // ---- Tokens & moods ----
  const extra = section('Nastrój (winieta) i tokeny');
  const strip = h('div', 'pv-row');
  strip.style.gap = '8px';
  const times: [number, string][] = [
    [hm(12), '12:00'],
    [hm(18, 30), '18:30'],
    [hm(19), '19:00'],
    [hm(19, 30), '19:30'],
    [hm(20), '20:00'],
    [hm(20, 30), '20:30'],
    [hm(5, 45), '05:45'],
  ];
  for (const [t, label] of times) {
    const tile = h('div', 'pv-vtile');
    tile.style.background = `radial-gradient(ellipse at center, transparent 30%, ${vignetteAt(t)} 100%), ${MOOD_BG.day}`;
    strip.append(cell(tile, `${label} α${parseRgba(vignetteAt(t)).a.toFixed(2)}`));
  }
  extra.append(
    strip,
    h(
      'p',
      'pv-note',
      'Winieta interpolowana między klatkami dzień → zmierzch → noc (smoothstep); kafle na jasnym tle, żeby było widać różnicę.',
    ),
  );
  const threat = h('div', 'pv-row');
  threat.style.marginTop = '20px';
  const ratio = (text: string, bg: string) => contrastRatio(text, bg, MOOD_BG[mood]).toFixed(2);
  const trough = (bg: string) => {
    const c = parseRgba(bg);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a * Number(tokens.motion.pulse.threat)})`;
  };
  const banner = (level: 'medium' | 'high' | 'critical', caption: string, reduced = false) => {
    const b = createThreatBanner({ level }, doc).el;
    if (!reduced) return cell(b, caption);
    const wrap = h('div', 'dz-reduced-motion');
    wrap.append(b);
    return cell(wrap, caption);
  };
  const { high, critical } = tokens.color.threat;
  threat.append(
    banner('medium', `medium · ${ratio(tokens.color.text.inverse, tokens.color.warning.banner)}:1`),
    banner('high', `high · ${ratio(high.text, high.bg)}:1`),
    banner(
      'critical',
      `critical · puls tła · ${ratio(critical.text, critical.bg)}:1 (dołek pulsu ${ratio(critical.text, trough(critical.bg))}:1)`,
    ),
    banner('critical', 'critical · reduced motion: bez pulsu, ikona „!!”', true),
  );
  extra.append(
    threat,
    h('p', 'pv-note', 'ThreatBanner · low = brak paska · kontrast liczony na tle tego nastroju.'),
  );

  root.append(moodles, slots, actions, stats, maps, extra);

  root.append(createVignette(doc));
  return root;
}

const pngArg = process.argv.indexOf('--png');
const pngOut = pngArg > 0 ? process.argv[pngArg + 1] : undefined;
const style = await css();
const outDir = `${pkgDir}dist/preview`;
await mkdir(outDir, { recursive: true });
await copyFonts(`${pkgDir}dist`);

for (const mood of MOODS) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const sheet = buildSheet(doc, mood);
  const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>@deadzone/ui · preview · ${mood}</title>
<style>
${style}
</style>
</head>
<body data-hud-mood="${mood}" data-hud-chips="${mood === 'day' ? 'day' : 'night'}" style="min-height:${HEIGHT}px;--pv-bg:${MOOD_BG[mood]}">
${sheet.outerHTML}
</body>
</html>
`;
  const file = `${outDir}/preview-${mood}.html`;
  await writeFile(file, html);
  console.log(`wrote ${file}`);
  await window.happyDOM.close();

  if (pngOut) {
    const png = mood === 'day' ? pngOut : pngOut.replace(/\.png$/, `-${mood}.png`);
    execFileSync(
      process.env.CHROME_BIN ?? 'google-chrome',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=1920,${HEIGHT}`,
        '--force-device-scale-factor=1',
        '--virtual-time-budget=5000',
        `--screenshot=${png}`,
        `file://${file}`,
      ],
      { stdio: 'ignore' },
    );
    console.log(`wrote ${png}`);
  }
}
