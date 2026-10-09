import {
  DEFAULT_HUD_LAYOUT,
  HUD_LAYOUT_REFERENCE,
  type HudLayoutSlot,
} from '@deadzone/ui/settings';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The editor treats a slot without a saved entry as DEFAULT_HUD_LAYOUT and „Resetuj element” goes
 * back to it, while the HUD itself is placed by the stylesheets. This test reads the slot groups'
 * left / right / top / bottom from the CSS (cascade order as imported by hud.ts, --_s = 1,
 * --_safe = 18 px) and checks they are the same anchors and px offsets as DEFAULT_HUD_LAYOUT at
 * 1280×720, so a reset never moves anything visually.
 */
// Read from disk: vitest stubs CSS imports (even `?raw`) to empty strings.
const SHEETS = ['../hud-layout.css', '../v2/top-bar.css', '../hud-v3.css', './hud-slots.css'].map(
  (p) => readFileSync(new URL(p, import.meta.url), 'utf8'),
);
const SLOT_CLASS: Record<HudLayoutSlot, string> = {
  topbar: 'dz-topbar',
  status: 'dz-g--status',
  minimap: 'dz-g--minimap',
  itemlog: 'dz-g--itemlog',
  weapon: 'dz-g--weapon',
  hotbar: 'dz-g--hotbar',
  threat: 'dz-g--threat',
  hints: 'dz-g--hints',
};
const PROPS = ['left', 'right', 'top', 'bottom'] as const;
type Prop = (typeof PROPS)[number];

interface Rule {
  selectors: string[];
  decls: Partial<Record<Prop, string>>;
}

function parse(css: string): Rule[] {
  const out: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Partial<Record<Prop, string>> = {};
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      const k = d.slice(0, i).trim() as Prop;
      if (i > 0 && PROPS.includes(k)) decls[k] = d.slice(i + 1).trim();
    }
    out.push({ selectors: m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
  }
  return out;
}

/** Specificity of a matching selector (classes + attributes), or -1 when it does not match. */
function matches(sel: string, cls: string, noObjective: boolean): number {
  const bases = [`.${cls}`, `.dz-hud .${cls}`];
  if (bases.includes(sel)) return sel.split('.').length - 1;
  if (noObjective && sel === `.dz-hud[data-objective='none'] .${cls}`) return 3;
  return -1;
}

/** Computed left / right / top / bottom of a slot group at --_s = 1. */
function computed(cls: string, noObjective: boolean): Partial<Record<Prop, string>> {
  const hits: { spec: number; order: number; decls: Rule['decls'] }[] = [];
  let order = 0;
  for (const css of SHEETS) {
    for (const r of parse(css)) {
      order++;
      const spec = Math.max(...r.selectors.map((s) => matches(s, cls, noObjective)));
      if (spec >= 0) hits.push({ spec, order, decls: r.decls });
    }
  }
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order);
  return Object.assign({}, ...hits.map((h) => h.decls)) as Partial<Record<Prop, string>>;
}

/** px of a value, 'auto', or 'center' (left: 50%). */
function px(v: string | undefined): number | 'auto' | 'center' | undefined {
  if (v === undefined || v === 'auto') return v === 'auto' ? 'auto' : undefined;
  if (v === '50%') return 'center';
  if (v === '0') return 0;
  if (v === 'var(--_safe)') return 18;
  const m = /^(?:calc\()?(-?[\d.]+)px(?: \* var\(--_s\)\))?$/.exec(v);
  if (!m) throw new Error(`unsupported CSS value: ${v}`);
  return Number(m[1]);
}

function anchorOf(c: Partial<Record<Prop, string>>): { anchor: string; x: number; y: number } {
  const left = px(c.left);
  const right = px(c.right);
  const top = px(c.top);
  const bottom = px(c.bottom);
  let h: string;
  let x: number;
  if (left === 'center') [h, x] = ['c', 0];
  else if (typeof left === 'number') [h, x] = ['l', left];
  else if (typeof right === 'number') [h, x] = ['r', right];
  else throw new Error('no horizontal position');
  let v: string;
  let y: number;
  if (typeof top === 'number') [v, y] = ['t', top];
  else if (typeof bottom === 'number') [v, y] = ['b', bottom];
  else throw new Error('no vertical position');
  return { anchor: `${v}${h}`, x, y };
}

describe('DEFAULT_HUD_LAYOUT = HUD positions from the stylesheets (hud-slots.css & co.)', () => {
  const ref = HUD_LAYOUT_REFERENCE;
  for (const noObjective of [false, true]) {
    it(`every slot at its default anchor and offset (${noObjective ? 'no objective' : 'with objective'})`, () => {
      for (const [slot, cls] of Object.entries(SLOT_CLASS) as [HudLayoutSlot, string][]) {
        const c = computed(cls, noObjective);
        const css = anchorOf(c);
        const d = DEFAULT_HUD_LAYOUT.elements[slot];
        expect(css.anchor, slot).toBe(d.anchor);
        expect(css.x, slot).toBeCloseTo(d.x * ref.w, 3);
        expect(css.y, slot).toBeCloseTo(d.y * ref.h, 3);
        expect([d.scale, d.opacity, d.visible], slot).toEqual([1, 1, true]);
      }
    });
  }
});
