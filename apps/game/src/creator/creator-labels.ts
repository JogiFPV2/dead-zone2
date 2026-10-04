import { humanizeId } from '../hud/labels.js';
import { polishItemName } from '../content/polish-names.js';

/**
 * TEMPORARY Polish labels for the character creator (content only has i18n keys). Unknown ids
 * fall back to a readable form of the id, like hud/labels.ts.
 */
const PROFESSIONS: Record<string, string> = {
  'base:unemployed': 'Bezrobotny',
  'base:burglar': 'Włamywacz',
  'base:veteran': 'Weteran',
  'base:farmer': 'Rolnik',
  'base:fisherman': 'Rybak',
  'base:park-ranger': 'Strażnik parku',
  'base:firefighter': 'Strażak',
  'base:police-officer': 'Policjant',
  'base:nurse': 'Pielęgniarka',
  'base:doctor': 'Lekarz',
  'base:chef': 'Kucharz',
  'base:fitness-instructor': 'Instruktor fitness',
  'base:carpenter': 'Stolarz',
  'base:mechanic': 'Mechanik',
  'base:electrician': 'Elektryk',
  'base:construction-worker': 'Budowlaniec',
  'base:lumberjack': 'Drwal',
};

const SKILLS: Record<string, string> = {
  'base:blunt': 'Broń tępa',
  'base:blade-long': 'Broń długa',
  'base:blade-short': 'Broń krótka',
  'base:spear': 'Włócznie',
  'base:aiming': 'Broń palna',
  'base:reloading': 'Przeładowanie',
  'base:carpentry': 'Stolarka',
  'base:mechanics': 'Mechanika',
  'base:electrical': 'Elektronika',
  'base:tailoring': 'Krawiectwo',
  'base:metalworking': 'Ślusarstwo',
  'base:sprinting': 'Sprint',
  'base:nimble': 'Zwinność',
  'base:sneaking': 'Skradanie',
  'base:lightfoot': 'Lekki krok',
  'base:strength': 'Siła',
  'base:fitness': 'Sprawność',
  'base:first-aid': 'Pierwsza pomoc',
  'base:cooking': 'Gotowanie',
  'base:farming': 'Uprawa',
  'base:foraging': 'Zbieractwo',
  'base:fishing': 'Wędkarstwo',
  'base:trapping': 'Pułapki',
};

export const SKILL_GROUPS: Record<string, string> = {
  combat: 'Walka',
  survival: 'Przetrwanie',
  crafting: 'Rzemiosło',
  movement: 'Ruch',
};

const TRAITS: Record<string, string> = {
  'base:nimble-fingers': 'Zręczne palce',
  'base:all-thumbs': 'Dwie lewe ręce',
  'base:home-cook': 'Domowy kucharz',
  'base:outdoorsy': 'Obieżyświat',
  'base:gearhead': 'Złota rączka',
  'base:desensitized': 'Znieczulony',
  'base:hardened': 'Zahartowany',
  'base:fast-learner': 'Szybki uczeń',
  'base:handy': 'Majsterkowicz',
  'base:jumpy': 'Nerwowy',
  'base:keen-ears': 'Czujne uszy',
  'base:light-eater': 'Mały apetyt',
  'base:hearty-appetite': 'Duży apetyt',
  'base:iron-gut': 'Żelazny żołądek',
  'base:weak-stomach': 'Słaby żołądek',
  'base:overweight': 'Otyły',
  'base:underweight': 'Niedowaga',
  'base:brave': 'Odważny',
  'base:cowardly': 'Tchórz',
  'base:slow-learner': 'Wolny uczeń',
  'base:fast-reader': 'Szybko czyta',
  'base:slow-reader': 'Wolno czyta',
  'base:restful-sleeper': 'Twardy sen',
  'base:restless-sleeper': 'Płytki sen',
  'base:hemophobic': 'Hemofobia',
  'base:strong': 'Silny',
  'base:weak': 'Słaby',
  'base:athletic': 'Wysportowany',
  'base:unfit': 'Bez kondycji',
  'base:thick-skinned': 'Gruba skóra',
  'base:thin-skinned': 'Cienka skóra',
  'base:fast-healer': 'Szybko się goi',
  'base:slow-healer': 'Wolno się goi',
  'base:resilient': 'Odporny',
  'base:prone-to-illness': 'Chorowity',
  'base:eagle-eyed': 'Sokoli wzrok',
  'base:short-sighted': 'Krótkowzroczny',
  'base:hard-of-hearing': 'Niedosłyszy',
  'base:stealthy': 'Cichy',
  'base:clumsy': 'Niezdarny',
  'base:steady-hand': 'Pewna ręka',
  'base:shaky-hands': 'Drżące ręce',
  'base:strong-back': 'Mocne plecy',
  'base:weak-back': 'Słabe plecy',
};

/** Modifier stats → short Polish phrase (trait / profession descriptions). */
const STATS: Record<string, string> = {
  'hunger-rate': 'głodu',
  'thirst-rate': 'pragnienia',
  'fatigue-rate': 'zmęczenia',
  'endurance-regen': 'regeneracji kondycji',
  'healing-rate': 'gojenia',
  'move-speed': 'szybkości ruchu',
  'sprint-speed': 'szybkości sprintu',
  'search-speed': 'szybkości przeszukiwania',
  'carry-capacity-kg': 'udźwigu',
  'footstep-noise': 'hałasu kroków',
  'crafting-speed': 'szybkości craftingu',
  'weapon-wear': 'zużycia broni',
  'panic-resistance': 'odporności na panikę',
  'xp-gain': 'XP',
  'hearing-range-tiles': 'zasięgu słuchu',
  'sight-range-tiles': 'zasięgu wzroku',
  'food-sickness-chance': 'szansy zatrucia',
  'melee-damage': 'obrażeń wręcz',
  'aim-accuracy': 'celności',
  'reading-speed': 'szybkości czytania',
  'scratch-resistance': 'odporności na zadrapania',
  'bite-resistance': 'odporności na ugryzienia',
  'infection-resistance': 'odporności na infekcję',
  stress: 'stresu',
  panic: 'paniki',
};

const ITEMS: Record<string, string> = {
  'base:crowbar': 'Łom',
  'base:matches': 'Zapałki',
  'base:fire-axe': 'Topór strażacki',
  'base:pistol': 'Pistolet 9 mm',
  'base:bandage': 'Bandaż',
  'base:sterilized-bandage': 'Bandaż jałowy',
  'base:kitchen-knife': 'Nóż kuchenny',
  'base:hammer': 'Młotek',
  'base:pipe-wrench': 'Klucz do rur',
  'base:screwdriver': 'Śrubokręt',
  'base:hatchet': 'Siekierka',
  'base:nails': 'Gwoździe',
};

export const professionName = (id: string): string => PROFESSIONS[id] ?? humanizeId(id);
export const skillName = (id: string): string => SKILLS[id] ?? humanizeId(id);
export const traitName = (id: string): string => TRAITS[id] ?? humanizeId(id);
export const itemLabel = (id: string): string => ITEMS[id] ?? polishItemName(id) ?? humanizeId(id);

const pct = (v: number): string => `${v > 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%`;
const signed = (v: number): string => `${v > 0 ? '+' : '−'}${Math.abs(v)}`;

/** `{stat:'hunger-rate', op:'mul', value:0.8}` → `−20% głodu`; `add` → `+3 udźwigu`. */
export function modifierText(m: { stat: string; op: string; value: number }): string {
  const what = STATS[m.stat] ?? m.stat;
  if (m.op === 'mul') return `${pct(m.value)} ${what}`;
  const unit = m.stat === 'carry-capacity-kg' ? ' kg' : '';
  return `${signed(m.value)}${unit} ${what}`;
}

/** Number with a real minus sign and explicit plus (`+2`, `−4`, `0`). */
export const signedPts = (n: number): string => (n === 0 ? '0' : signed(n));
