import './creator.css';
import type { CharacterSpec } from '@deadzone/protocol';
import type { ContentIndex } from '@deadzone/sim';
import { menuScale } from '../menu/menu-model.js';
import type { MeshRef, PartColors, RenderLook } from './appearance-map.js';
import { professionName } from './creator-labels.js';
import {
  checkDraft,
  decSkill,
  defaultDraft,
  draftLook,
  draftName,
  errorText,
  incSkill,
  paletteHex,
  randomName,
  randomizeLook,
  randomizeOutfit,
  randomizeSkills,
  randomizeTraits,
  setProfession,
  setSkill,
  toSpec,
  toggleTrait,
  type CreatorDraft,
} from './creator-model.js';
import type { CreatorPreview } from './creator-preview.js';
import { esc, keyCap, svg } from './html.js';
import {
  lookOptions,
  renderLookLeft,
  renderLookRight,
  selectedId,
  type ColorTarget,
  type LookCtx,
  type LookSlot,
} from './step-look.js';
import { renderProfessions, renderSkills } from './step-skills.js';
import { renderTraitList, renderTraitSummary } from './step-traits.js';

export interface CreatorResult {
  spec: CharacterSpec;
  look: RenderLook;
}

export interface CreatorScreenOptions {
  root: HTMLElement;
  content: ContentIndex;
  /** Mode chip in the header („TRYB: PRZETRWAJ”). */
  modeLabel: string;
  preview?: CreatorPreview | undefined;
  /** First step (0..2), dev `?creator=1&step=N`. */
  step?: number;
  rng?: () => number;
  sound?: (id: 'click' | 'hover' | 'switch') => void;
  onDone(result: CreatorResult | undefined): void;
}

const STEPS = ['Wygląd', 'Zawód i umiejętności', 'Cechy'];
const ROT_STEP = Math.PI / 8;

/** Character creator (mockups creator-look / creator-skills / creator-traits). */
export function createCreatorScreen(o: CreatorScreenOptions): { dispose(): void } {
  const c = o.content;
  const rng = o.rng ?? Math.random;
  let d: CreatorDraft = defaultDraft(c, randomName(rng));
  let step = Math.max(0, Math.min(2, o.step ?? 0));
  const thumbs = new Map<string, string>();

  const el = document.createElement('div');
  el.className = 'dzc';
  el.innerHTML = `<div class="dzc-shade"></div><div class="dzc-stage">
<div class="dzc-head"></div><div class="dzc-rule"></div>
<div class="dzc-panel dzc-p1"></div><div class="dzc-panel dzc-p2"></div><div class="dzc-panel dzc-p3"></div>
<div class="dzc-preview"><div class="dzc-glow"></div><div class="dzc-ring"></div><div class="dzc-view"></div>
<div class="dzc-nameplate"></div>
<div class="dzc-rot dzc-rot--l"><button type="button" class="dzc-rbtn" data-act="rot" data-dir="1" aria-label="Obróć w lewo">${svg('rotl', 22)}</button>${keyCap('Q')}</div>
<div class="dzc-rot dzc-rot--r"><button type="button" class="dzc-rbtn" data-act="rot" data-dir="-1" aria-label="Obróć w prawo">${svg('rotr', 22)}</button>${keyCap('E')}</div>
<div class="dzc-rothint">Obróć: Q / E lub przeciągnij · Scroll: przybliż</div></div>
<div class="dzc-foot"></div></div>`;
  o.root.appendChild(el);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const stage = $('.dzc-stage');
  const view = $('.dzc-view');
  const p1 = $('.dzc-p1');
  const p2 = $('.dzc-p2');
  const p3 = $('.dzc-p3');
  if (o.preview) view.appendChild(o.preview.canvas);

  const hex = (pal: string, id: string) => paletteHex(c, pal, id);
  const thumb = (ref: MeshRef, colors: PartColors): string => {
    if (!o.preview) return '';
    const key = `${ref.model}/${ref.mesh}/${(ref.hide ?? []).join()}|${colors.primary ?? ''}|${colors.secondary ?? ''}|${d.skin}`;
    let url = thumbs.get(key);
    if (url === undefined) {
      url = o.preview.thumbnail(ref, colors, hex('base:skin', d.skin) ?? '#d9ad8a');
      thumbs.set(key, url);
    }
    return url;
  };
  const lookCtx = (): LookCtx => ({ c, d, thumb, hex });

  function header(): string {
    const steps = STEPS.map((n, i) => {
      const cls = i === step ? ' dzc-step--act' : i < step ? ' dzc-step--done' : '';
      const num = i < step ? svg('check', 14, 3) : String(i + 1);
      const line =
        i < 2 ? `<span class="dzc-sline${i < step ? ' dzc-sline--done' : ''}"></span>` : '';
      return `<button type="button" class="dzc-step${cls}" data-act="goto" data-step="${i}"><span class="dzc-sn">${num}</span><span class="dzc-st">${n}</span></button>${line}`;
    }).join('');
    return `<span class="dzc-title">NOWA POSTAĆ</span><span class="dzc-mode">TRYB: ${esc(o.modeLabel.toUpperCase())}</span>
<span class="dzc-grow"></span><div class="dzc-row dzc-gap14">${steps}</div><span class="dzc-grow"></span><button type="button" class="dzc-esc" data-act="cancel">Esc wróć do menu</button>`;
  }

  function summary(): string {
    const name = draftName(d) || '—';
    if (step === 0) {
      const top = lookOptions(lookCtx(), 'top').find((x) => x.id === d.top.part)?.label ?? '';
      const bottom =
        lookOptions(lookCtx(), 'bottom').find((x) => x.id === d.bottom.part)?.label ?? '';
      return `${esc(name)} · ${esc(top)} · ${esc(bottom)}`;
    }
    const left = checkDraft(c, d);
    const pts = left.ok ? left.state.pointsLeft : left.pointsLeft;
    if (step === 1)
      return `${esc(name)} · ${esc(professionName(d.profession))} · pozostało ${pts} pkt`;
    return `${esc(name)} · ${esc(professionName(d.profession))} · ${d.traits.length} cech · bilans ${pts} pkt`;
  }

  function footer(): string {
    const back =
      step === 0
        ? ''
        : `<button type="button" class="dzc-btn dzc-btn--sec dzc-btn--lg" data-act="back">${svg('arrowl', 16)} WSTECZ ${keyCap('Backspace')}</button>`;
    let next: string;
    let err = '';
    if (step < 2) {
      next = `<button type="button" class="dzc-btn dzc-btn--pri dzc-btn--lg" data-act="next">DALEJ: ${step === 0 ? 'ZAWÓD' : 'CECHY'} ${svg('arrowr', 16)} ${keyCap('Enter')}</button>`;
    } else {
      const r = checkDraft(c, d);
      if (!r.ok) err = `<span class="dzc-err">${esc(errorText(r.errors[0]))}</span>`;
      next = `<button type="button" class="dzc-btn dzc-btn--pri dzc-btn--xl" data-act="start"${r.ok ? '' : ' disabled'}>${svg('play', 16)} ROZPOCZNIJ ${keyCap('Enter')}</button>`;
    }
    return `<div class="dzc-fside">${back}</div><span class="dzc-grow"></span><span class="dzc-col dzc-center dzc-gap6"><span class="dzc-summary">${summary()}</span>${err}</span><span class="dzc-grow"></span><div class="dzc-fside dzc-end">${next}</div>`;
  }

  function nameplate(): string {
    return `<span class="dzc-npname">${esc(draftName(d))}</span><span class="dzc-npprof">${esc(professionName(d.profession).toUpperCase())}</span>`;
  }

  function render(): void {
    el.dataset.step = String(step);
    $('.dzc-head').innerHTML = header();
    $('.dzc-foot').innerHTML = footer();
    $('.dzc-nameplate').innerHTML = nameplate();
    p3.hidden = step !== 2;
    if (step === 0) {
      p1.innerHTML = renderLookLeft(lookCtx());
      p2.innerHTML = renderLookRight(lookCtx());
    } else if (step === 1) {
      p1.innerHTML = renderProfessions(c, d);
      p2.innerHTML = renderSkills(c, d);
    } else {
      p1.innerHTML = renderTraitList(c, d, 'merits');
      p2.innerHTML = renderTraitList(c, d, 'flaws');
      p3.innerHTML = renderTraitSummary(c, d);
    }
    layout();
  }

  /** Keeps the scroll positions of lists across re-renders (one click = one innerHTML swap). */
  function update(next: CreatorDraft, look = false): void {
    const scroll = [...el.querySelectorAll<HTMLElement>('.dzc-scroll')].map((s) => s.scrollTop);
    d = next;
    render();
    el.querySelectorAll<HTMLElement>('.dzc-scroll').forEach(
      (s, i) => (s.scrollTop = scroll[i] ?? 0),
    );
    if (look) o.preview?.setLook(draftLook(c, d));
  }

  function layout(): void {
    const w = o.root.clientWidth || window.innerWidth;
    const h = o.root.clientHeight || window.innerHeight;
    const s = menuScale(w, h);
    stage.style.transform = `scale(${s})`;
    el.style.setProperty('--dzc-s', String(s));
    const r = view.getBoundingClientRect();
    o.preview?.resize(Math.round(r.width), Math.round(r.height));
  }

  function go(next: number): void {
    const s = Math.max(0, Math.min(2, next));
    if (s === step) return;
    step = s;
    o.sound?.('switch');
    render();
    revealSelection();
  }

  /** Scrolls the selected profession into its list (on entering a step, not on every click). */
  function revealSelection(): void {
    el.querySelector('.dzc-prof--sel')?.scrollIntoView({ block: 'nearest' });
  }

  function finish(): void {
    const r = checkDraft(c, d);
    if (!r.ok) return;
    o.sound?.('click');
    dispose();
    o.onDone({ spec: toSpec(c, d), look: draftLook(c, d) });
  }

  function cancel(): void {
    o.sound?.('click');
    dispose();
    o.onDone(undefined);
  }

  function cycle(slot: LookSlot, dir: number): void {
    const opts = lookOptions(lookCtx(), slot);
    const i = opts.findIndex((x) => x.id === selectedId(d, slot));
    const n = opts[(i + dir + opts.length) % opts.length];
    if (n) pick(slot, n.id);
  }

  function pick(slot: LookSlot, id: string): void {
    o.sound?.('click');
    if (slot === 'head') update({ ...d, head: id }, true);
    else update({ ...d, [slot]: { ...d[slot], part: id } }, true);
  }

  function color(target: ColorTarget, id: string): void {
    o.sound?.('click');
    if (target === 'skin') update({ ...d, skin: id }, true);
    else if (target === 'hair') update({ ...d, hairColor: id }, true);
    else update({ ...d, [target]: { ...d[target], primary: id } }, true);
  }

  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || (t as HTMLButtonElement).disabled) return;
    const id = t.dataset.id ?? '';
    switch (t.dataset.act) {
      case 'goto':
        go(Number(t.dataset.step));
        break;
      case 'next':
        go(step + 1);
        break;
      case 'back':
        go(step - 1);
        break;
      case 'start':
        finish();
        break;
      case 'cancel':
        cancel();
        break;
      case 'random':
        o.sound?.('switch');
        update(randomizeLook(c, d, rng), true);
        break;
      case 'random-outfit':
        o.sound?.('switch');
        update(randomizeOutfit(c, d, rng), true);
        break;
      case 'random-skills':
        o.sound?.('switch');
        update(randomizeSkills(c, d, rng));
        break;
      case 'random-traits':
        o.sound?.('switch');
        update(randomizeTraits(c, d, rng));
        break;
      case 'pick':
        pick(t.dataset.slot as LookSlot, id);
        break;
      case 'cycle':
        cycle(t.dataset.slot as LookSlot, Number(t.dataset.dir));
        break;
      case 'color':
        color(t.dataset.target as ColorTarget, id);
        break;
      case 'rot':
        o.preview?.rotate(Number(t.dataset.dir) * ROT_STEP);
        break;
      case 'profession':
        o.sound?.('click');
        update(setProfession(c, d, id));
        break;
      case 'skill-inc':
        o.sound?.('click');
        update(incSkill(c, d, id));
        break;
      case 'skill-dec':
        o.sound?.('click');
        update((e as MouseEvent).shiftKey ? setSkill(d, id, 0) : decSkill(d, id));
        break;
      case 'trait':
        o.sound?.('click');
        update(toggleTrait(c, d, id));
        break;
    }
  });
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act !== 'name') return;
    const field = t.dataset.field === 'last' ? 'last' : 'first';
    d = field === 'last' ? { ...d, lastName: t.value } : { ...d, firstName: t.value };
    const count = el.querySelector(`[data-name-count="${field}"]`);
    if (count) count.textContent = `${t.value.length}/${t.maxLength}`;
    $('.dzc-foot').innerHTML = footer();
    $('.dzc-nameplate').innerHTML = nameplate();
  });

  // Rotation: Q / E held, drag on the preview; wheel zooms.
  const held = new Set<string>();
  let raf = 0;
  let lastMs = 0;
  const spin = (now: number) => {
    const dt = lastMs ? Math.min(0.1, (now - lastMs) / 1000) : 0;
    lastMs = now;
    const dir = (held.has('KeyQ') ? 1 : 0) - (held.has('KeyE') ? 1 : 0);
    if (dir) o.preview?.rotate(dir * dt * 2.4);
    raf = held.size ? requestAnimationFrame(spin) : 0;
    if (!raf) lastMs = 0;
  };
  const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.tagName === 'INPUT';
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.code === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (step < 2) go(step + 1);
      else finish();
      return;
    }
    if (typing(e)) return;
    if (e.code === 'Backspace') {
      e.preventDefault();
      go(step - 1);
    } else if (e.code === 'KeyR' && step === 0) {
      update(randomizeLook(c, d, rng), true);
    } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
      held.add(e.code);
      if (!raf) raf = requestAnimationFrame(spin);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code);
  };
  let drag: number | undefined;
  view.addEventListener('pointerdown', (e) => {
    drag = e.clientX;
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', (e) => {
    if (drag === undefined) return;
    o.preview?.rotate((e.clientX - drag) * 0.012);
    drag = e.clientX;
  });
  view.addEventListener('pointerup', () => (drag = undefined));
  view.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      o.preview?.zoom(e.deltaY > 0 ? 0.06 : -0.06);
    },
    { passive: false },
  );
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  const ro = new ResizeObserver(layout);
  ro.observe(o.root);

  o.preview?.setLook(draftLook(c, d));
  render();
  revealSelection();

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    ro.disconnect();
    el.remove();
  }
  return { dispose };
}
