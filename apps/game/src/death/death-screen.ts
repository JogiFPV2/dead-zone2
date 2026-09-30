import './death-screen.css';
import type { GameState } from '../state/game-state.js';
import { causeLabel, daysWord, deathTimeLabel, updateRecord } from './death-model.js';

type Death = NonNullable<GameState['death']>;

const div = (cls: string, text?: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
};

const storage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Death screen (mockup `death.png`), minimal: days survived, cause, time, record (localStorage).
 * TODO: buildings, crafted and skills are not in the sim yet → not shown.
 */
export function showDeathScreen(root: HTMLElement, death: Death, mapLabel: string): () => void {
  const days = death.daysSurvived ?? death.day;
  const record = updateRecord(storage(), days);
  const el = div('dz-death');
  const inner = div('dz-death__inner');
  const tag = div('dz-death__tag', `Tryb: Przetrwaj · Mapa: ${mapLabel}`);
  const title = div('dz-death__title', 'Nie żyjesz');
  const line = div('dz-death__line');
  const survived = div('dz-death__survived');
  const num = document.createElement('span');
  num.textContent = String(days);
  survived.append('Przetrwałeś ', num, ` ${daysWord(days)}`);
  const cause = div('dz-death__cause');
  cause.append(
    div('dz-death__chip', causeLabel(death.cause)),
    div('dz-death__when', deathTimeLabel(death.day, death.minuteOfDay)),
  );
  const panel = div('dz-death__panel');
  const head = div('dz-death__panel-head', 'Porównanie z rekordem');
  const row = div('dz-death__row');
  const isRecord = record === undefined || days > record;
  row.append(
    div('dz-death__row-label', 'Dni'),
    div('dz-death__row-now', String(days)),
    div('dz-death__row-rec', record === undefined ? '—' : String(record)),
  );
  if (isRecord) row.append(div('dz-death__badge', 'Nowy rekord'));
  const kills = div('dz-death__row');
  kills.append(
    div('dz-death__row-label', 'Zabite zombie'),
    div('dz-death__row-now', String(death.zombiesKilled ?? 0)),
    div('dz-death__row-rec', ''),
  );
  panel.append(head, row, kills);
  const buttons = div('dz-death__buttons');
  const btn = (label: string, key: string, primary: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dz-death__btn${primary ? ' dz-death__btn--primary' : ''}`;
    const k = document.createElement('span');
    k.className = 'dz-death__key';
    k.textContent = key;
    b.append(label, k);
    b.addEventListener('click', restart);
    return b;
  };
  // Both restart for now (no main menu yet).
  buttons.append(btn('Menu główne', 'Esc', false), btn('Nowa gra', 'Enter', true));
  const note = div(
    'dz-death__note',
    'Świat zostanie wygenerowany od nowa — postać i ekwipunek przepadają',
  );
  inner.append(tag, title, line, survived, cause, panel, buttons, note);
  el.append(inner);
  root.append(el);
  function restart(): void {
    window.location.reload();
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') restart();
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    el.remove();
  };
}
