import type { ContentIndex } from '@deadzone/sim';
import { budget, traitRows, type CreatorDraft, type TraitRow } from './creator-model.js';
import { modifierText, professionName, signedPts, skillName, traitName } from './creator-labels.js';
import { esc, svg } from './html.js';

type Trait = ContentIndex['traits'] extends ReadonlyMap<string, infer T> ? T : never;

/** One-line description from modifiers, skill bonuses and XP multipliers. */
export function traitDescription(t: Trait): string {
  const parts = [
    ...t.modifiers.map(modifierText),
    ...t.skillBonuses.map((b) => `${skillName(b.skill)} ${signedPts(b.levels)}`),
    ...t.xpMultipliers.map(
      (m) => `XP ${skillName(m.skill)} ×${String(m.multiplier).replace('.', ',')}`,
    ),
  ];
  if (t.knownRecipes.length) parts.push(`receptury: ${t.knownRecipes.length}`);
  return parts.slice(0, 3).join(' · ');
}

/** Points shown on a trait: merits cost (−), flaws give (+). */
export const traitPts = (cost: number): string => signedPts(-cost);

function traitRow(c: ContentIndex, d: CreatorDraft, r: TraitRow): string {
  const t = c.traits.get(r.id)!;
  const state = r.selected ? 'sel' : r.blockedBy ? 'dis' : '';
  const box = r.selected
    ? `<span class="dzc-cbox dzc-cbox--on">${svg('check', 14, 3)}</span>`
    : r.blockedBy
      ? `<span class="dzc-cbox dzc-cbox--ban">${svg('ban', 18)}</span>`
      : '<span class="dzc-cbox"></span>';
  let reason = '';
  if (r.blockedBy) {
    const why = r.blockedBy.fromProfession
      ? `z zawodu: ${professionName(d.profession)}`
      : r.blockedBy.positive
        ? 'wybrana zaleta'
        : 'wybrana wada';
    reason = `<span class="dzc-why">Wyklucza: ${esc(traitName(r.blockedBy.id))} (${esc(why)})</span>`;
  } else if (r.fromProfession)
    reason = `<span class="dzc-free">z zawodu: ${esc(professionName(d.profession))}</span>`;
  const cls = r.positive ? 'dzc-neg' : 'dzc-pos';
  const dis = r.blockedBy || r.fromProfession ? ' disabled' : '';
  return `<button type="button" class="dzc-trait${state ? ` dzc-trait--${state}` : ''}" data-act="trait" data-id="${esc(r.id)}"${dis}>${box}
<span class="dzc-col dzc-gap3 dzc-grow"><span class="dzc-tname">${esc(traitName(r.id))}</span><span class="dzc-tdesc">${esc(traitDescription(t))}</span>${reason}</span>
<span class="dzc-tpts ${r.fromProfession ? '' : cls}">${r.fromProfession ? '0' : traitPts(r.cost)}</span></button>`;
}

export function renderTraitList(
  c: ContentIndex,
  d: CreatorDraft,
  kind: 'merits' | 'flaws',
): string {
  const rows = traitRows(c, d)[kind];
  const title = kind === 'merits' ? 'ZALETY' : 'WADY';
  const note =
    kind === 'merits'
      ? '<span class="dzc-hnote dzc-neg">kosztują punkty</span>'
      : '<span class="dzc-hnote dzc-pos">dają punkty</span>';
  return `<div class="dzc-hdr"><span class="dzc-htitle">${title}</span>${note}</div>
<div class="dzc-col dzc-gap8 dzc-scroll dzc-traitlist">${rows.map((r) => traitRow(c, d, r)).join('')}</div>`;
}

export function renderTraitSummary(c: ContentIndex, d: CreatorDraft): string {
  const b = budget(c, d);
  const free = c.professions.get(d.profession)?.freeTraits ?? [];
  const chips = [...d.traits, ...free.filter((f) => !d.traits.includes(f))]
    .map((id) => {
      const cost = free.includes(id) ? 0 : (c.traits.get(id)?.cost ?? 0);
      const cls = cost > 0 ? 'dzc-chip--neg' : 'dzc-chip--pos';
      return `<span class="dzc-chip ${cls}">${esc(traitName(id))} <b>${traitPts(cost)}</b></span>`;
    })
    .join('');
  const row = (l: string, v: string, cls = '') =>
    `<div class="dzc-srow"><span class="dzc-sl">${l}</span><span class="dzc-sv ${cls}">${v}</span></div>`;
  return `<div class="dzc-hdr"><span class="dzc-htitle">WYBRANE CECHY</span><span class="dzc-hnote">${d.traits.length + free.filter((f) => !d.traits.includes(f)).length}</span><button type="button" class="dzc-btn dzc-btn--sec dzc-btn--sm" data-act="random-traits">${svg('dice', 16)} Losuj cechy</button></div>
<div class="dzc-row dzc-wrap dzc-gap8">${chips || '<span class="dzc-note">Brak — kliknij zaletę lub wadę</span>'}</div>
<div class="dzc-stats">${row('Pozostało z umiejętności', String(b.pool - b.skills))}${row('Zalety', signedPts(-b.merits), b.merits ? 'dzc-neg' : '')}${row('Wady', signedPts(b.flaws))}
<div class="dzc-srow dzc-srow--total"><span class="dzc-sl">Bilans końcowy</span><span class="dzc-sv${b.left < 0 ? ' dzc-neg' : ''}">${b.left}</span></div></div>
<span class="dzc-note dzc-faint">Bilans ≥ 0, aby rozpocząć · niewydane punkty przepadają</span>`;
}
