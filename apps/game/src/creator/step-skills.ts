import type { ContentIndex } from '@deadzone/sim';
import { budget, creation, skillRows, type CreatorDraft, type SkillRow } from './creator-model.js';
import {
  SKILL_GROUPS,
  itemLabel,
  modifierText,
  professionName,
  signedPts,
  skillName,
  traitName,
} from './creator-labels.js';
import { esc, svg } from './html.js';

const PROF_ICONS: Record<string, string> = {
  'base:carpenter': 'tool',
  'base:mechanic': 'wrench',
  'base:electrician': 'wrench',
  'base:construction-worker': 'tool',
  'base:nurse': 'cross',
  'base:doctor': 'cross',
  'base:police-officer': 'badge',
  'base:veteran': 'shield',
  'base:firefighter': 'fire',
  'base:unemployed': 'couch',
  'base:farmer': 'leaf',
  'base:fisherman': 'leaf',
  'base:park-ranger': 'leaf',
  'base:lumberjack': 'leaf',
};

type Prof = ContentIndex['professions'] extends ReadonlyMap<string, infer T> ? T : never;

/** „Stolarka +3 · Broń tępa +1” (or the points it gives when there are no bonuses). */
export function professionSummary(p: Prof): string {
  const bonus = p.skillBonuses.map((b) => `${skillName(b.skill)} ${signedPts(b.levels)}`);
  if (bonus.length) return bonus.join(' · ');
  return p.points > 0 ? `Brak bonusów · +${p.points} punktów do rozdania` : 'Brak bonusów';
}

function professionCard(p: Prof, sel: boolean): string {
  const pts =
    p.points === 0
      ? ''
      : `<span class="dzc-ppts ${p.points > 0 ? 'dzc-pos' : 'dzc-neg'}">${signedPts(p.points)} pkt</span>`;
  return `<button type="button" class="dzc-prof${sel ? ' dzc-prof--sel' : ''}" data-act="profession" data-id="${esc(p.id)}">
<span class="dzc-picon">${svg(PROF_ICONS[p.id] ?? 'user', 20)}</span>
<span class="dzc-col dzc-gap4 dzc-grow"><span class="dzc-pname">${esc(professionName(p.id))}</span><span class="dzc-psub">${esc(professionSummary(p))}</span></span>
${pts}${sel ? `<span class="dzc-acc">${svg('check', 16, 3)}</span>` : ''}</button>`;
}

function srow(label: string, value: string, cls = ''): string {
  return `<div class="dzc-srow"><span class="dzc-sl">${label}</span><span class="dzc-sv ${cls}">${value}</span></div>`;
}

/** Perks of the selected profession (free traits, modifiers, items, recipes). */
export function professionPerks(c: ContentIndex, p: Prof): [string, string][] {
  const rows: [string, string][] = [];
  rows.push(['Punkty', signedPts(p.points)]);
  for (const t of p.freeTraits) rows.push(['Cecha', traitName(t)]);
  for (const m of p.modifiers ?? []) rows.push(['Premia', modifierText(m)]);
  if (p.startingItems.length)
    rows.push([
      'Start. ekwipunek',
      p.startingItems
        .map((i) => `${itemLabel(i.item)}${(i.count ?? 1) > 1 ? ` ×${i.count}` : ''}`)
        .join(', '),
    ]);
  if (p.knownRecipes.length) rows.push(['Znane receptury', String(p.knownRecipes.length)]);
  void c;
  return rows;
}

export function renderProfessions(c: ContentIndex, d: CreatorDraft): string {
  const cards = [...c.professions.values()]
    .map((p) => professionCard(p, p.id === d.profession))
    .join('');
  const sel = c.professions.get(d.profession);
  const perks = sel
    ? professionPerks(c, sel)
        .map(([l, v]) => srow(esc(l), esc(v)))
        .join('')
    : '';
  return `<div class="dzc-hdr"><span class="dzc-htitle">ZAWÓD</span><span class="dzc-hnote">bonus bazowy</span></div>
<div class="dzc-col dzc-gap8 dzc-scroll dzc-proflist">${cards}</div>
<div class="dzc-sep"></div>
<div class="dzc-hdr"><span class="dzc-htitle">${esc(professionName(d.profession).toUpperCase())} · PREMIA</span></div>
<div class="dzc-stats">${perks}</div>`;
}

function pips(r: SkillRow, max: number): string {
  let s = '';
  for (let i = 0; i < max; i++) {
    const cls = i < r.base ? ' dzc-pip--b' : i < r.total ? ' dzc-pip--s' : '';
    s += `<i class="dzc-pip${cls}"></i>`;
  }
  return `<span class="dzc-pips">${s}</span>`;
}

function skillRow(r: SkillRow, max: number): string {
  const base =
    r.profession > 0 ? `zawód ${signedPts(r.profession)}` : r.base > 0 ? `+${r.base}` : '—';
  const btn = (act: 'inc' | 'dec', on: boolean) =>
    `<button type="button" class="dzc-stp" data-act="skill-${act}" data-id="${esc(r.id)}"${on ? '' : ' disabled'} aria-label="${act === 'inc' ? 'Dodaj' : 'Odejmij'} poziom">${svg(act === 'inc' ? 'plus' : 'minus', 14, 2.4)}</button>`;
  return `<div class="dzc-skrow${r.passive ? ' dzc-skrow--passive' : ''}"><span class="dzc-skname">${esc(skillName(r.id))}</span>
<span class="dzc-skbase">${base}</span>${pips(r, max)}
<span class="dzc-skpts${r.cost ? ' dzc-acc' : ''}">${r.cost ? `+${r.cost}` : '0'}</span>
${btn('dec', r.canDec)}${btn('inc', r.canInc)}<span class="dzc-sktot">${r.total}</span></div>`;
}

export function renderSkills(c: ContentIndex, d: CreatorDraft): string {
  const cc = creation(c);
  const b = budget(c, d);
  const rows = skillRows(c, d);
  const max = Math.max(6, ...rows.map((r) => r.base + cc.maxSkillLevelAtStart));
  const groups: string[] = [];
  let g = '';
  let body = '';
  for (const r of rows) {
    if (r.group !== g) {
      if (body) groups.push(body);
      g = r.group;
      body = `<div class="dzc-skgroup">${esc((SKILL_GROUPS[g] ?? g).toUpperCase())}</div>`;
    }
    body += skillRow(r, Math.min(10, max));
  }
  if (body) groups.push(body);
  // Points for skills = pool − merits + flaws (picked traits move the budget).
  const avail = b.pool - b.merits + b.flaws;
  const left = b.left;
  const pct = avail > 0 ? Math.max(0, Math.min(100, (b.skills / avail) * 100)) : 0;
  const costs = cc.skillPointCost.join(' / ');
  return `<div class="dzc-hdr"><span class="dzc-htitle">UMIEJĘTNOŚCI</span><button type="button" class="dzc-btn dzc-btn--sec dzc-btn--sm" data-act="random-skills">${svg('dice', 16)} Losuj umiejętności</button></div>
<div class="dzc-pool"><div class="dzc-col dzc-gap6 dzc-grow"><div class="dzc-row"><span class="dzc-pooltitle dzc-grow">Punkty: <span class="dzc-mono dzc-acchi${left < 0 ? ' dzc-neg' : ''}">${left} / ${avail}</span></span><span class="dzc-note">wydane ${b.skills} · pozostało ${left}</span></div>
<div class="dzc-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>
<div class="dzc-row dzc-gap12 dzc-note"><span class="dzc-row dzc-gap4"><i class="dzc-pip dzc-pip--b"></i>baza</span><span class="dzc-row dzc-gap4"><i class="dzc-pip dzc-pip--s"></i>wydane</span></div></div>
<div class="dzc-skhead"><span class="dzc-grow">UMIEJĘTNOŚĆ</span><span class="dzc-skbase">BAZA</span><span class="dzc-pips">POZIOM</span><span class="dzc-skpts">PKT</span><span class="dzc-skbtns"></span><span class="dzc-sktot">RAZEM</span></div>
<div class="dzc-scroll dzc-sklist">${groups.join('')}</div>
<span class="dzc-note dzc-faint">Koszt poziomu: ${costs} pkt · maks. ${cc.maxSkillLevelAtStart} kupione · Shift+klik: reset</span>`;
}
