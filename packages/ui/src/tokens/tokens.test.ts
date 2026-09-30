import { describe, expect, it } from 'vitest';
import { cssVar, cssVarName, tokenPaths, tokens } from './index.js';
import { flatten, mergeGroups, resolveRefs, TOKEN_GROUPS, toCss } from './generate.js';
import { parseColor } from './contrast.js';
import { parseRules, tokensCss } from '../test/css.js';

const rootDecls = parseRules(tokensCss()).find((r) => r.selectors.includes(':root'))?.decls ?? {};

describe('tokens', () => {
  it('exposes the spec naming: dot path → CSS var', () => {
    expect(cssVar('color.moodle.neg.3.bg')).toBe('var(--color-moodle-neg-3-bg)');
    expect(cssVar('space.0-5')).toBe('var(--space-0-5)');
    expect(cssVarName('font.label.sm')).toBe('--font-label-sm');
    expect(tokens.color.moodle.neg[3].bg.$value).toBe('rgba(200, 69, 60, 0.22)');
    expect(cssVar('color.moodle.neg.3.bg.day')).toBe('var(--color-moodle-neg-3-bg-day)');
    expect(cssVar('border.chip.day')).toBe('var(--border-chip-day)');
    expect(tokens.space[2]).toBe('8px');
    expect(tokens.radius.md).toBe('6px');
    expect(tokens.font.label.sm).toBe("700 11px/1 'JetBrains Mono', ui-monospace, monospace");
  });

  it('CSS vars and the TS object carry the same tokens and values', () => {
    const flat = flatten(tokens);
    expect(flat.map((t) => t.path)).toEqual([...tokenPaths]);
    expect(Object.keys(rootDecls).sort()).toEqual(flat.map((t) => cssVarName(t.path)).sort());
    for (const t of flat) {
      // Prettier lowercases hex colours in CSS; compare case-insensitively.
      expect(rootDecls[cssVarName(t.path)]?.toLowerCase(), t.path).toBe(t.value.toLowerCase());
    }
  });

  it('has a full moodle scale: polarity × level 1–4 × border/bg/text/dot', () => {
    for (const polarity of ['neg', 'pos'] as const) {
      for (const level of [1, 2, 3, 4] as const) {
        const set = tokens.color.moodle[polarity][level];
        expect(Object.keys(set).sort()).toEqual(['bg', 'border', 'dot', 'text']);
        expect(Object.keys(set.bg).sort()).toEqual(['$value', 'day']);
      }
    }
  });

  it('has the tokens from Designer answers 4, 5 and 8', () => {
    expect(tokens.color.chip.overflow).toEqual({
      border: tokens.color.text.muted,
      bg: tokens.color.bg.chip,
      text: tokens.color.text.muted,
      dot: tokens.color.text.muted,
    });
    expect(tokens.opacity).toEqual({ disabled: '0.5', ghost: '0.4' });
    expect(tokens.motion.pulse).toEqual({
      duration: '1000ms',
      moodle: '0.7',
      stat: '0.55',
      threat: '0.75',
    });
    expect(tokens.motion.drain).toBe('600ms');
    expect(tokens.motion.tooltip.delay).toBe('250ms');
    expect(tokens.motion.reduced.fade).toBe('150ms');
    expect(tokens.color.text.onDanger).toBe('#FFFFFF');
    expect(cssVar('color.text.onDanger')).toBe('var(--color-text-on-danger)');
    expect(tokens.color.moodle.neg[4].text).toBe(tokens.color.text.onDanger);
    expect(tokens.color.moodle.neg[4].dot).toBe(tokens.color.text.onDanger);
    expect(tokens.color.threat.high.text).toBe(tokens.color.danger.bright);
  });

  it('dusk vignette = night vignette at 60% strength (Designer, answer 1)', () => {
    const night = parseColor(tokens.color.overlay.vignette.night);
    const dusk = parseColor(tokens.color.overlay.vignette.dusk);
    expect({ ...dusk, a: 0 }).toEqual({ ...night, a: 0 });
    expect(dusk.a).toBeCloseTo(night.a * 0.6, 2);
  });

  it('keeps the groups split: color, space, radius, font, …', () => {
    expect(Object.keys(tokens)).toEqual([...TOKEN_GROUPS]);
  });
});

describe('generator', () => {
  const minimal = Object.fromEntries(TOKEN_GROUPS.map((g) => [g, { [g]: { a: '1px' } }]));

  it('merges groups in a fixed order and emits CSS vars', () => {
    const reversed = Object.fromEntries(Object.entries(minimal).reverse());
    const tree = mergeGroups(reversed);
    expect(Object.keys(tree)).toEqual([...TOKEN_GROUPS]);
    expect(toCss(tree)).toContain('  --color-a: 1px;');
  });

  it('resolves {references} to literal values, chains included', () => {
    expect(resolveRefs({ a: { b: '#fff', c: '{a.b}', d: '{a.c}' } })).toEqual({
      a: { b: '#fff', c: '#fff', d: '#fff' },
    });
    expect(() => resolveRefs({ a: '{nope}' })).toThrow(/unknown token reference \{nope\}/);
    expect(() => resolveRefs({ a: '{b}', b: '{a}' })).toThrow(/cycle/);
  });

  it('rejects unknown groups, wrong top-level keys and missing groups', () => {
    expect(() => mergeGroups({ ...minimal, extra: { extra: {} } })).toThrow(/unknown token group/);
    expect(() => mergeGroups({ ...minimal, color: { colour: {} } })).toThrow(/top-level key/);
    const withoutSize = Object.fromEntries(Object.entries(minimal).filter(([g]) => g !== 'size'));
    expect(() => mergeGroups(withoutSize)).toThrow(/missing token group file: tokens\/size.json/);
    expect(() => mergeGroups({ ...minimal, space: { space: { 1: 4 } } })).toThrow(
      /expected an object/,
    );
  });
});

describe('$value (token with its own value and variants)', () => {
  const tree = {
    color: { chip: { bg: { $value: 'rgba(1, 2, 3, 0.7)', day: 'rgba(1, 2, 3, 0.92)' } } },
  };
  it('flattens to the node path and path.variant', () => {
    expect(flatten(tree)).toEqual([
      { path: 'color.chip.bg', value: 'rgba(1, 2, 3, 0.7)' },
      { path: 'color.chip.bg.day', value: 'rgba(1, 2, 3, 0.92)' },
    ]);
  });
  it('emits one CSS var for each', () => {
    const css = toCss(tree);
    expect(css).toContain('--color-chip-bg: rgba(1, 2, 3, 0.7);');
    expect(css).toContain('--color-chip-bg-day: rgba(1, 2, 3, 0.92);');
  });
});
