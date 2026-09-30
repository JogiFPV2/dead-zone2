# @deadzone/ui

HUD gry według specyfikacji **HUD A** od Designera: tokeny (zmienne CSS i obiekt TS z jednego źródła) oraz komponenty DOM bez frameworka.

## Dlaczego vanilla DOM

`apps/game` renderuje świat w Three.js i nie ma Reacta (nakładka dev `stats-overlay` to zwykły DOM). React jest tylko w `apps/web` (landing). Specyfikacja (§5) zostawia wybór frameworka otwarty („vanilla albo Preact z sygnałami”) i wymaga tylko komponentów prezentacyjnych, które dostają dane z jednego `HudState`, oraz tekstu przez `textContent`. Dlatego każdy komponent to fabryka `createX(props) → { el, update(props), destroy() }`, a stan siedzi w atrybutach `data-*` stylowanych przez CSS. Z Reacta/Preacta można to owinąć w kilku linijkach (`ref` + `update` w efekcie). Nie dodajemy zależności.

## Tokeny

- Źródło: `tokens/<grupa>.json` (color, font, space, radius, border, shadow, blur, opacity, motion, z, size). Wartość może być referencją do innego tokenu: `"{color.text.muted}"`. Generator wstawia wtedy wartość dosłowną.
- `pnpm --filter @deadzone/ui gen:tokens` generuje `src/tokens/tokens.generated.css` (`:root { --color-… }`) i `src/tokens/tokens.generated.ts` (`tokens`, `tokenPaths`, typ `TokenPath`). Opcja `--check` kończy się błędem, gdy pliki są nieaktualne. To samo sprawdza test `tokens.drift.test.ts` w `pnpm test`, więc CI łapie rozjazd.
- Nazwy: `color.moodle.neg.3.bg` → `--color-moodle-neg-3-bg` → `tokens.color.moodle.neg[3].bg`, a `cssVar('color.moodle.neg.3.bg')` zwraca `var(--color-moodle-neg-3-bg)` (typowane).
- Token z wariantami: węzeł z kluczem `$value` ma własną wartość i dzieci, np. `"bg": { "$value": "<noc>", "day": "<dzień>" }` → `--color-moodle-neg-3-bg` i `--color-moodle-neg-3-bg-day`; w TS `tokens.color.moodle.neg[3].bg.$value` i `.bg.day`.

## Użycie w grze (Silnik)

```ts
import '@deadzone/ui/hud.css'; // fonty (@font-face) + tokeny + style komponentów, raz w aplikacji (Vite)
import {
  createMoodleList,
  createStatBars,
  createInventorySlot,
  createActionButton,
  createMinimap,
  createVignette,
  setHudMood,
  applyVignetteAt,
  setHudMotion,
  computeUiScale,
  applyUiScale,
} from '@deadzone/ui';

const hud = document.createElement('div');
hud.className = 'dz-hud'; // position:absolute; inset:0; z-index: var(--z-hud); pointer-events:none
game.append(createVignette(), hud);
setHudMood(game, 'night'); // klatka: 'day' | 'dusk' | 'night' (winieta + zestaw chipów)
applyVignetteAt(game, minutesOfDay); // co minutę gry: płynna winieta + przełączenie chipów
setHudMotion(game, 'auto'); // 'reduced' | 'full' | 'auto' (= prefers-reduced-motion)

const stats = createStatBars({ health: 72, thirst: 41, hunger: 58, energy: 84 });
hud.append(stats.el);
stats.update(nextStats); // co tick HUD (spec: throttling do 10 Hz)
```

- Eksporty: `@deadzone/ui` (wszystko), `@deadzone/ui/tokens` (same tokeny), `@deadzone/ui/fonts.css`, `@deadzone/ui/tokens.css`, `@deadzone/ui/components.css`, `@deadzone/ui/hud.css` (= fonts + tokens + components), `@deadzone/ui/fonts/*`.
- Fonty są self-hosted: Inter i JetBrains Mono (zmienne woff2, latin + latin-ext, Fontsource 5.3.0, SIL OFL 1.1, licencje w `fonts/`). `hud.css`/`fonts.css` ładują je z `./fonts/` obok pliku CSS. Bez Google Fonts.
- Reduced motion: przy `prefers-reduced-motion: reduce` albo klasie `.dz-reduced-motion` na przodku nie ma pulsów, drain jest natychmiastowy, a wejścia to sam fade (`motion.reduced.fade` = 150 ms, ten sam czas dla toastów). Klasa `.dz-full-motion` wyłącza reakcję na ustawienie systemu.
- Pozycje grup (kotwice, `--ui-scale`, `transform-origin`) należą do gry. `computeUiScale(innerWidth, innerHeight, hudScaleSetting)` + `applyUiScale(hud, scale)` liczą skalę z §2.
- Elementy klikalne (slot, ActionButton, minimapa) robią `stopPropagation`, więc klik nie odpala ataku w świecie. Chipy moodle mają `pointer-events:auto` tylko dla tooltipa.
- Minimapa: współrzędne świata three.js w metrach (x, z; sim `y` = `z`), `heading` = sim `facingRad`, `cameraYaw` = yaw kamery (`ISO_YAW` + obrót). Domyślnie `north-up` (decyzja Pawła): północ zawsze u góry, a „N” stoi na stałe u góry, 8 px od krawędzi. Opcja `orientation: 'camera'` obraca mapę z kamerą (wtedy „N” krąży po obwodzie). Drogi mają 6 m. Skala 2.5 px/m nie zależy od kamery, więc `VIEW_HEIGHT = 24` w grze niczego tu nie zmienia (pakiet nigdy nie zakładał viewH 27).
- Chipy dzienne: `data-hud-chips="day"` (ustawia `setHudMood`/`applyVignetteAt`) podmienia tło chipów moodle na `color.moodle.*.*.bg.day` (α 0.92) i dodaje obrys `border.chip.day`. Tła się nie interpolują, tylko przełączają: zestaw dzienny działa od klatki świtu 05:45 do klatki zmierzchu 19:30, poza tym nocny (klatka `dusk` = nocny). Oba zestawy mają ≥ 4.5:1 na tle zmierzchu, więc przełączenie nigdy nie spada poniżej AA; test sprawdza każdą 5. minutę doby.
- ThreatBanner: `critical` pulsuje tłem (opacity 1 ↔ `motion.pulse.threat`); przy reduced motion nie ma pulsu, zamiast niego widać ikonę „!!”.
- Moodle: `toPolarity('negative' | 'positive')` mapuje polaryzację z `@deadzone/content` na `'neg' | 'pos'`.

## Komponenty i stany

| Komponent           | Fabryka                            | Stany (`data-*`)                                                                                                                                              |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moodle (StatusChip) | `createMoodle`, `createMoodleList` | `data-polarity` neg/pos × `data-level` 1–4. Poziom 0 = brak elementu. Neutralny chip `+N` (`color.chip.overflow`), błysk przy zmianie poziomu, puls tła neg 4 |
| StatBar             | `createStatBar`, `createStatBars`  | `data-state` normal/low/critical, `data-drain` (ghost)                                                                                                        |
| InventorySlot       | `createInventorySlot`              | `data-state` empty/filled/selected/disabled/hover (disabled > selected > hover), `data-empty` (zaznaczony pusty: ramka selected na pustym tle)                |
| ActionButton        | `createActionButton`               | `data-variant` primary/secondary × `data-state` default/hover/pressed/disabled, focus-visible, pasek przytrzymania                                            |
| ThreatBanner        | `createThreatBanner`               | `data-level` low (ukryty)/medium/high/critical; critical: mocniej nasycone tło + ramka + puls, przy reduced motion „!!”                                       |
| KeyBadge            | `createKeyBadge`                   | `data-variant` light/inverse                                                                                                                                  |
| Minimap             | `createMinimap`                    | `data-orientation` north-up (domyślnie)/camera                                                                                                                |

## Podgląd

`pnpm --filter @deadzone/ui preview -- --png /tmp/ui.png` renderuje wszystkie stany na jednym arkuszu do `dist/preview/preview-{night,day,dusk}.html` (statyczny HTML) i, z `--png`, do PNG przez headless Chrome (`CHROME_BIN`, domyślnie `google-chrome`): `/tmp/ui.png` (dzień), `/tmp/ui-night.png` (noc) i `/tmp/ui-dusk.png` (zmierzch).
