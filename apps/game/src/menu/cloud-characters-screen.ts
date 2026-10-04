import type { AudioEngine } from '../audio/audio-engine.js';
import type { AccountUsage, CloudCharacter } from '../account/account-api.js';
import type { AccountSession } from '../account/account-session.js';
import { NEW_FOCUS, moveFocus, type CharFocus } from './characters-model.js';
import { scrollFor } from './characters-screen.js';
import {
  cloudCardView,
  initials,
  methodLabel,
  newCharacterState,
  sortCloud,
  usageColor,
  usageFraction,
  usageLabel,
  type CloudCardView,
} from './cloud-characters-model.js';
import { createConfirm, type ConfirmDialog } from './confirm-dialog.js';
import { GOOGLE_G, icon } from './icons.js';
import { MINI_LOGO, keyBadge, mountOverlay } from './overlay-stage.js';

export interface CloudCharactersOptions {
  readonly root: HTMLElement;
  readonly account: AccountSession;
  readonly audio?: Pick<AudioEngine, 'play'> | undefined;
  readonly note?: string | undefined;
  /** No answer after this long → error banner (spec: 10 s). */
  readonly timeoutMs?: number;
  /** Graj: the screen is disposed. */
  onPlay(c: CloudCharacter): void;
  onNew(): void;
  onClose(): void;
  /** „GRAJ OFFLINE” on the error banner. */
  onOffline(): void;
  /** WYLOGUJ or session expired (401). */
  onSignedOut(expired: boolean): void;
  now?: () => number;
}

export interface CloudCharactersScreen {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

type Phase = 'loading' | 'ready' | 'error';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;

/**
 * Postacie online (mockup characters-online.png): `GET /v1/characters` cards with the cloud
 * status, last location, save size, the account header and usage (alive limit, MB). Loading
 * skeletons, the network-error banner (cached cards stay, Graj disabled) and 401 handling.
 */
export function createCloudCharactersScreen(o: CloudCharactersOptions): CloudCharactersScreen {
  const overlay = mountOverlay(o.root, 'dzo--chars');
  const { stage } = overlay;
  const { account } = o;
  const now = o.now ?? Date.now;
  let phase: Phase = 'loading';
  let chars: CloudCharacter[] = [];
  let usage: AccountUsage | undefined;
  let cards: CloudCardView[] = [];
  let focus: CharFocus = { card: 0, action: 0 };
  let confirm: ConfirmDialog | undefined;
  let note = o.note ?? '';
  let scroll = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loadSeq = 0;

  const ui = (id: 'ui-click1' | 'ui-rollover2' = 'ui-click1'): void => o.audio?.play('ui', id);
  const stale = (): boolean => phase === 'error';
  const newState = (): { disabled: boolean; note: string } =>
    usage ? newCharacterState(usage) : { disabled: true, note: '' };
  const canCreate = (): boolean => phase === 'ready' && !newState().disabled;

  function rebuild(): void {
    const t = now();
    chars = sortCloud(chars);
    cards = chars.map((c) => cloudCardView(c, t, account.syncing.has(c.id)));
    if (!cards.length) focus = NEW_FOCUS;
    else if (focus.card >= cards.length) focus = { card: cards.length - 1, action: 0 };
  }

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    phase = 'loading';
    render();
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      if (seq !== loadSeq || disposed) return;
      phase = 'error';
      render();
    }, o.timeoutMs ?? 10_000);
    const r = await account.api.listCharacters();
    if (disposed || seq !== loadSeq) return;
    clearTimeout(timer);
    if (r.ok) {
      chars = r.characters;
      usage = r.usage;
      phase = 'ready';
      rebuild();
    } else if (r.reason === 'unauthorized') {
      account.expired();
      dispose();
      o.onSignedOut(true);
      return;
    } else phase = 'error';
    render();
  }

  function headerHtml(): string {
    const u = account.user;
    if (!u) return '';
    const avatar =
      u.avatarUrl && /^https:\/\//.test(u.avatarUrl)
        ? `<img src="${esc(u.avatarUrl)}" alt="">`
        : esc(initials(u.email));
    const used = usage ? usageFraction(usage.usedBytes, usage.limitBytes) : 0;
    const syncing = phase === 'loading' || account.syncing.size > 0;
    return `<div class="dza-acct"><div class="dza-avatar">${avatar}</div><div class="dza-acct-who"><span class="dza-acct-mail">${esc(u.email)}</span><span class="dza-acct-method">${u.method === 'google' ? GOOGLE_G(10) : icon('mail', 10)} ${methodLabel(u)}</span></div><div class="dza-acct-div"></div><button type="button" class="dza-btn dza-btn--sec" data-act="logout">${icon('exit', 13)}WYLOGUJ</button></div>
<div class="dza-usage"><div class="dza-usage-top"><span>${icon('user', 14)}<span><b>${usage ? usage.alive : '—'} / ${usage?.aliveLimit ?? 20}</b> żywych postaci</span></span><span>${icon('database', 13)}<span><b>${usage ? usageLabel(usage) : '— / 50 MB'}</b></span></span></div>
<div class="dza-bar"><i style="width:${pct(used)};background:${usageColor(used)}"></i></div>
<div class="dza-usage-foot"><span>licznik liczy tylko żywe postacie</span>${syncing ? `<span class="dza-syncing">${icon('sync', 11)}Synchronizuję…</span>` : ''}</div></div>`;
  }

  function portraitHtml(v: CloudCardView): string {
    if (v.dead) return `<div class="dzo-portrait dzo-portrait--dead">${icon('grave', 52)}</div>`;
    const p = v.portrait;
    return `<div class="dzo-portrait" aria-hidden="true"><i class="dzo-pt-body" style="background:${p.shirt}"></i><i class="dzo-pt-neck" style="background:${p.skin}"></i><i class="dzo-pt-head" style="background:${p.skin}"></i><i class="dzo-pt-hair" style="background:${p.hair}"></i><i class="dzo-pt-eyes"></i></div>`;
  }

  function cardHtml(v: CloudCardView, i: number): string {
    const focused = focus.card === i;
    const badge =
      v.badge === 'sync'
        ? `<div class="dza-badge dza-badge--sync">${icon('sync', 12)}SYNCHRONIZUJĘ…</div>`
        : v.badge === 'cloud'
          ? `<div class="dza-badge">${icon('cloudOk', 13)}W CHMURZE</div>`
          : '';
    const rows = v.dead
      ? `<div class="dza-cs"><span>${v.daysLabel}</span><b>${v.days}</b></div>
<div class="dza-cs"><span>DATA ŚMIERCI</span><em class="dza-red">${esc(v.died ?? '—')}</em></div>
<div class="dza-cs"><span>OSTATNIO GRANA</span><em class="dza-muted">${esc(v.played)}</em></div>
<div class="dza-cs"><span>ZAPIS</span><em class="dza-dim">${v.save}</em></div>`
      : `<div class="dza-cs"><span>${v.daysLabel}</span><b>${v.days}</b></div>
<div class="dza-cs"><span>LOKACJA</span>${v.location ? `<em>${icon('pin', 11)}${esc(v.location)}</em>` : '<em class="dza-dim">—</em>'}</div>
<div class="dza-cs"><span>OSTATNIO GRANA</span><em>${esc(v.played)}</em></div>
<div class="dza-cs"><span>ZAPIS</span><em>${v.save}</em></div>`;
    const btn = (a: 'play' | 'delete', j: number): string => {
      const f = focused && focus.action === j;
      const tab = `tabindex="${f ? 0 : -1}"`;
      const fc = f ? ' dza-btn--focus' : '';
      if (a === 'play') {
        if (v.busy) {
          return `<button type="button" class="dza-btn${fc}" data-card="${i}" data-act="play" ${tab} aria-disabled="true">${icon('sync', 13)}CZEKAJ…</button>`;
        }
        if (stale()) {
          return `<button type="button" class="dza-btn${fc}" data-card="${i}" data-act="play" ${tab} aria-disabled="true" title="Wymaga połączenia">${icon('play', 13)}GRAJ</button>`;
        }
        return `<button type="button" class="dza-btn ${focused ? 'dza-btn--pri' : 'dza-btn--sec'}${fc}" data-card="${i}" data-act="play" ${tab}>${icon('playOutline', 13)}GRAJ</button>`;
      }
      const wide = v.dead;
      return `<button type="button" class="dza-btn dza-btn--danger dza-del${wide ? ' dza-del--wide' : ''}${fc}" data-card="${i}" data-act="delete" ${tab} aria-label="${wide ? 'Usuń nagrobek' : `Usuń postać ${esc(v.name)}`}"${stale() ? ' aria-disabled="true" title="Wymaga połączenia"' : ''}>${icon('trash', 13)}${wide ? 'USUŃ NAGROBEK' : ''}</button>`;
    };
    return `<div class="dza-card${focused ? ' dza-card--focus' : ''}${v.dead ? ' dza-card--dead' : ''}${stale() ? ' dza-card--stale' : ''}" data-card="${i}" role="group" aria-label="${esc(v.name)}">${badge}${portraitHtml(v)}
<div class="dza-card-body"><div class="dza-card-name">${esc(v.name)}</div><div class="dza-card-sub">${v.sub}</div>${rows}</div>
<div class="dza-card-actions">${v.actions.map(btn).join('')}</div></div>`;
  }

  const skeleton = `<div class="dza-card" aria-hidden="true"><div class="dzo-portrait dza-skel"></div><div class="dza-card-body"><div class="dza-skel" style="height:18px;width:140px;border-radius:4px"></div><div class="dza-skel" style="height:10px;width:60px;margin-top:8px;border-radius:3px"></div>${'<div class="dza-skel" style="height:10px;margin-top:20px;border-radius:3px"></div>'.repeat(4)}</div></div>`;

  function render(): void {
    if (disposed) return;
    const banner =
      phase === 'error'
        ? `<div class="dza-banner" role="alert">${icon('cloudOff', 18)}<span style="flex:1">Brak połączenia z serwerem. Postacie z konta są niedostępne.</span><button type="button" class="dza-btn dza-btn--sec" data-act="retry">SPRÓBUJ PONOWNIE</button><button type="button" class="dza-btn dza-btn--sec" data-act="offline">GRAJ OFFLINE</button></div>`
        : '';
    const row =
      phase === 'loading' && !cards.length ? skeleton.repeat(3) : cards.map(cardHtml).join('');
    const ns = newState();
    const newFocus = focus.card < 0;
    const newDisabled = !canCreate();
    stage.innerHTML = `${MINI_LOGO}
<div class="dzo-chars-head"><div class="dzo-chars-title">POSTACIE</div><div class="dza-chars-sub">KAŻDA POSTAĆ · JEDNA GRA · ZAPIS W CHMURZE</div></div>
${headerHtml()}${banner}
<div class="dza-row${phase === 'error' ? ' dza-row--banner' : ''}">${row}</div>
<button type="button" class="dza-btn dza-new${newFocus ? ' dza-btn--focus' : ''}" data-act="new" tabindex="${newFocus ? 0 : -1}"${newDisabled ? ' aria-disabled="true"' : ''}>${icon('plus', 16)} NOWA POSTAĆ${ns.note ? ` <em>${ns.note}</em>` : ''}</button>
${note ? `<div class="dza-note">${icon('warning', 14)}<span>${esc(note)}</span></div>` : ''}
<div class="dza-hints" style="right:42px;bottom:28px"><span>${keyBadge('←→')}wybierz</span><span>${keyBadge('Enter')}graj</span><span>${keyBadge('Del')}usuń</span><span data-act="back" style="cursor:pointer">${keyBadge('Esc')}wstecz</span></div>`;
    const r = stage.querySelector<HTMLElement>('.dza-row');
    if (r) r.scrollLeft = scrollFor(focus.card, scroll);
    scroll = r?.scrollLeft ?? 0;
    if (!confirm)
      stage.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }

  function askDelete(i: number): void {
    const c = chars[i];
    const v = cards[i];
    if (!c || !v || stale()) return;
    confirm = createConfirm({
      host: stage,
      title: v.dead ? 'USUNĄĆ NAGROBEK?' : 'USUNĄĆ POSTAĆ?',
      body: v.dead
        ? `Nagrobek „${esc(c.name)}” zniknie z konta.<br><span class="dzo-danger">Tej operacji nie można cofnąć.</span>`
        : `Postać i jej zapis zostaną usunięte z serwera na zawsze.<br><span class="dzo-danger">Tej operacji nie można cofnąć.</span>`,
      yes: v.dead ? 'USUŃ NAGROBEK' : 'USUŃ POSTAĆ',
      danger: true,
      icon: 'trash',
      onAnswer(yes) {
        confirm = undefined;
        if (!yes) {
          render();
          return;
        }
        note = '';
        void account.api.deleteCharacter(c.id).then((r) => {
          if (disposed) return;
          if (r.ok) void load();
          else if (r.reason === 'unauthorized') {
            account.expired();
            dispose();
            o.onSignedOut(true);
          } else {
            note = 'Nie udało się usunąć postaci. Spróbuj ponownie.';
            render();
          }
        });
      },
    });
  }

  function activate(f: CharFocus): void {
    ui();
    if (f.card < 0) {
      if (canCreate()) {
        dispose();
        o.onNew();
      }
      return;
    }
    const v = cards[f.card];
    const act = v?.actions[f.action];
    if (act === 'play') {
      if (v?.busy || stale()) return;
      const c = chars[f.card]!;
      dispose();
      o.onPlay(c);
    } else if (act === 'delete') askDelete(f.card);
  }

  async function logout(): Promise<void> {
    ui();
    await account.signOut();
    dispose();
    o.onSignedOut(false);
  }

  function onClick(e: MouseEvent): void {
    if (confirm) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = t?.dataset.act;
    if (!t || !act) return;
    if (act === 'back') {
      ui();
      dispose();
      o.onClose();
    } else if (act === 'logout') void logout();
    else if (act === 'retry') {
      ui();
      void load();
    } else if (act === 'offline') {
      ui();
      dispose();
      o.onOffline();
    } else if (act === 'new') activate(NEW_FOCUS);
    else {
      const card = Number(t.dataset.card);
      const action = cards[card]?.actions.indexOf(act as 'play' | 'delete') ?? -1;
      if (action >= 0) {
        focus = { card, action };
        activate(focus);
      }
    }
  }

  function onOver(e: PointerEvent): void {
    if (confirm) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    let next: CharFocus | undefined;
    if (t.dataset.act === 'new') next = NEW_FOCUS;
    else if (t.dataset.card !== undefined) {
      const card = Number(t.dataset.card);
      const action = cards[card]?.actions.indexOf(t.dataset.act as 'play' | 'delete') ?? -1;
      if (action >= 0) next = { card, action };
    }
    if (next && (next.card !== focus.card || next.action !== focus.action)) {
      focus = next;
      ui('ui-rollover2');
      render();
    }
  }

  const unsub = account.subscribe(() => {
    if (phase !== 'loading') rebuild();
    render();
  });
  overlay.el.addEventListener('click', onClick);
  overlay.el.addEventListener('pointerover', onOver);
  void load();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    unsub();
    confirm?.dispose();
    overlay.dispose();
  }

  return {
    onKey(e) {
      if (disposed) return false;
      if (confirm) {
        const handled = confirm.onKey(e);
        if (handled) ui();
        return handled;
      }
      const c = e.code;
      if (c === 'Escape') {
        ui();
        dispose();
        o.onClose();
        return true;
      }
      if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
        if (!e.repeat) activate(focus);
        return true;
      }
      if (c === 'Delete' && focus.card >= 0) {
        ui();
        askDelete(focus.card);
        return true;
      }
      const next = moveFocus(focus, c, cards, canCreate());
      if (!next) return false;
      if (next.card !== focus.card || next.action !== focus.action) {
        focus = next;
        ui('ui-rollover2');
        render();
      }
      return true;
    },
    dispose,
  };
}
