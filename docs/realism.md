# Realizm: mechaniki jak w PZ (audyt)

Stała zasada: realistyczny symulator jak Project Zomboid, tylko zależności z prawdziwego życia.
Audyt kodu `packages/sim` i `packages/content` na `origin/main` 354ace2 (11.10.2026).

Ocena: **działa** / **częściowo** / **brak**. Kolumna „Plan” to etap z listy na końcu.

## Potrzeby

| Mechanika | Ocena | Stan w kodzie | Plan |
|---|---|---|---|
| Głód, pragnienie | działa | `survival` (vitals, moodle), akcje `eat` / `drink`, psucie leniwe (`items/spoilage.ts`) | — |
| Zmęczenie, sen | częściowo | `systems/sleep.ts`: komenda `sleep`, jakość wg mebla (łóżko 50 / kanapa 35 / podłoga 25), pobudka (ból, gorączka, zombie, wyspany). Brak długości snu (`sleepUntil`), materaca, śpiwora | 4 |
| Odpoczynek (kanapa, krzesło) | brak | brak akcji, brak pola „siedzisko” | 4 |
| Nuda, stres | działa | `leisure` (czytanie, TV, VHS) zmniejsza nudę i stres | — |
| Higiena (brud, mycie) | brak | brak statystyki brudu i mycia | 8 |
| Nauka z książek / radia / VHS tylko wypoczętym | brak | `read` i `watch` nie sprawdzają zmęczenia (powód `tired`) | 4–5 |

## Okna

| Mechanika | Ocena | Stan w kodzie | Plan |
|---|---|---|---|
| Otwórz / zamknij | działa | `toggleDoor` na krawędzi okna (`openings`) | — |
| Rozbij | działa | akcja `smashWindow` (ręką: szansa skaleczenia dłoni) | — |
| Wyczyść ze szkła | działa | akcja `removeGlass`, pole `cleared`, daje odłamki | — |
| Wejście przez nieoczyszczone kaleczy | działa | `physics/vault.ts`: `glassChance` tylko gdy `!cleared` (komentarz w `physics/constants.ts` jest nieaktualny) | — |
| Rękawice przy czyszczeniu ze szkła | brak | `removeGlass` nie wymaga rękawic ani narzędzia | 2 |
| Zasłony | brak | — | 7 |

## Drzwi i zamki

| Mechanika | Ocena | Stan w kodzie | Plan |
|---|---|---|---|
| Otwarte / zamknięte / na klucz | częściowo | stany `open` / `closed` / `locked`; zamknąć i otworzyć zamek można z obu stron bez klucza | 2 |
| Klucz z budynku | brak | brak przedmiotu klucza i przypisania do budynku (`TODO(openings)` w `openings/timed.ts`) | 2 |
| Wytrych z widelca, szansa wg umiejętności | brak | — | 2 |
| Wyważenie łomem, wykopanie | działa | akcja `forceDoor` (`pry` / `kick`, szansa + siła) | — |
| Rozbicie (zombie, gracz) | działa | `damageOpening`, tłum zombie | — |
| Barykady | działa | `barricade` / `removeBarricade` | — |
| Pukanie (hałas) | brak | — | 2 |
| Drzwi zamknięte na klucz przy generowaniu | brak | generator nie stawia stanu `locked` (Silnik 2) | 2 |

## Leczenie

| Mechanika | Ocena | Stan w kodzie | Plan |
|---|---|---|---|
| Rany (zadrapanie, rozcięcie, ugryzienie, głęboka) | działa | `survival/wounds.ts`, krwawienie, gojenie | — |
| Bandaże (czyste / brudne) | działa | `bandage`, brudny po `dirtyAfterMin`, gorsze gojenie | — |
| Zakażenie rany | działa | `systems/health.ts`: `dirt` (bez bandaża / brudny bandaż), ból i wolniejsze gojenie | — |
| Odkażanie (woda utleniona, alkohol) | brak | efekt `disinfect` jest w treści (`sterilized-*`), sim go ignoruje; brak czynności „odkaź” leczącej `dirt` i skracającej ranę | 3 |
| Szycie | brak | igła i nici są w treści (krawiectwo), brak czynności „zszyj ranę” | 3 |
| Szyna | częściowo | efekt `splint` w treści, brak złamań w sim | 3 |
| Wirus zombie | działa | szansa przy ugryzieniu, inkubacja, śmierć | — |

## Światło

| Mechanika | Ocena | Stan w kodzie | Plan |
|---|---|---|---|
| Lampy z prądem | częściowo | `ai/vision.ts`: światło `requiresPower` świeci, gdy `items.powered`; zawsze włączone | 7 |
| Włącznik (tylko z prądem) | brak | — | 7 |
| Zapalone w nocy wabi zombie | brak | światło zmienia tylko zasięg wzroku | 7 |
| Latarka w ręku | działa | `heldLight` (bez baterii i stożka) | — |

## Meble i czynności

| Mechanika | Ocena | Stan w kodzie | Plan |
|---|---|---|---|
| Prąd / woda z sieci | częściowo | `items.powered` zawsze `true`, brak wody. PR #201 dodaje wyłączenie wg `worldSettings.utilities` | 1 |
| Lodówka / zamrażarka | częściowo | `base:fridge` ×0,3 i `base:freezer` ×0,05 (`requiresPower`). Brak stanu „zamrożone”, rozmrażania i jednego mebla z dwoma kontenerami | 1 |
| Sen na meblu | częściowo | jak wyżej (Potrzeby) | 4 |
| TV + VHS | działa | `watchTv {vhs?}`, akcja `watch`, XP raz na postać, `no-power`. Brak osobnego magnetowidu | 5 |
| Radio | brak | `base:radio` to tylko złom | 5 |
| Gotowanie | częściowo | receptury przy stacji `base:station-fire` (ognisko, piec, piekarnik); piekarnik nie wymaga prądu, brak kuchenki gazowej i przypalania | 6 |
| Zlew / kran | brak | brak modelu wody | 8 |
| Wanna / prysznic (mycie, zużycie wody) | brak | — | 8 |
| Toaleta | brak | opcjonalnie | 8 |
| Przesuwanie / podnoszenie mebli | brak | robi Fizyka; po stronie treści potrzebne pole wagi (`too-heavy`) | — |

## Ustalone API (dla Silnika i Serwera; spec Designera „Realizm…” w `deadzone-hud-v2-spec.md`)

- Jedno menu dla wszystkich obiektów:

  ```ts
  SimViewPatch.furnitureActions?: {
    furnitureId: number;
    typeId: string;
    actions: {
      id: string;
      labelPl: string;
      enabled: boolean;
      reason?: string;
      reasonPl?: string;
      durationMin?: number;
      chancePct?: number;
      breakChancePct?: number;
      noiseTiles?: number;
    }[];
  }[];
  ```

  Obejmuje obiekty pod kursorem albo obok gracza: meble i krawędzie.
  - `typeId` krawędzi i instalacji: `door`, `window`, `light-switch`, `bath`, `sink`. Meble mają swoje (`fridge`, `tv`, `cabinet`…).
  - `furnitureId` jest stabilny: dla obiektu mapy to kafel + numer obiektu, dla krawędzi klucz krawędzi.
- Jedna komenda: `useFurniture { furnitureId, actionId }` (w kliencie `client.useFurniture`). Menu działa tylko przez nią. Stare komendy (`toggleDoor`, `smashWindow`/`breakWindow`, `removeGlass`, `climbThrough`, `barricade`, `forceDoor`) zostają dla zgodności.
- Id akcji:
  - `window`: `open` / `close`, `smash`, `clear-glass`, `climb-through`, `barricade`, `curtains-close` / `curtains-open`.
  - `door`: `open` / `close`, `unlock-key`, `lockpick:<itemId>` (podmenu po prefiksie), `force-pry`, `force-kick`, `knock` (hałas), `barricade`.
  - `light-switch`: `on` / `off`.
  - `bath`: `wash`, `shower`, `fill-bath`.
  - `sink`: `fill-bottle`, `drink`, `wash-hands`, `open`.
  - Meble: `sleep`, `rest`, `cook`, `watch`, `watch-vhs`, `listen-radio`, `open-fridge` / `open-freezer`; `push` / `lift` (Fizyka).
- Kody `reason` (tabela Designera):
  - `no-power`, `no-water`, `threat`, `too-heavy`, `locked`, `no-key`;
  - `missing-tool`, `missing-item`, `missing-parts`;
  - `invalid-state`, `blocked`, `out-of-range`, `busy`;
  - dodatkowo `no-gas`, `tired`, `not-tired`.

  Polskie etykiety i powody są w `packages/content`; sim tylko je dołącza.
- Dane dodatkowe:
  - klucze przypisane do budynku;
  - rękawice przy `clear-glass` (bez nich szansa skaleczenia);
  - zasłony (światło na zewnątrz −90%);
  - waga mebla (pole w treści dla Fizyki, kod `too-heavy`);
  - woda utleniona: usuwa brud i zmniejsza ranę.
- Zasilanie budynku: `source: 'grid' | 'generator'`. Sieć działa do dnia wyłączenia; generator jest przewidziany w API, sam powstanie w późniejszym etapie.
- Zapis: `SAVE_VERSION` zostaje 3, nowe sekcje są opcjonalne i mają schemat w `@deadzone/protocol/schema`. Zapisujemy tylko zmienione obiekty (delta).

## Kolejność etapów

Po każdym etapie: zmergowany PR i raport.

1. Prąd i woda z wyłączeniem; lodówka z zamrażarką (jeden mebel, dwa kontenery `fridge` i `freezer`); stan „zamrożone” i rozmrażanie bez prądu.
2. Okna i drzwi w menu `useFurniture`: zamki, klucze z budynku, wytrych, wyważenie, pukanie, rękawice przy szkle.
3. Leczenie: odkażanie (woda utleniona), szycie, zakażenia.
4. Sen (`sleepUntil`: `'morning'` albo N godzin, pobudka przez sim, przerwanie zagrożeniem), odpoczynek, nauka tylko wypoczętym.
5. TV / VHS, radio (relaks, ewentualnie nauka), książki.
6. Gotowanie: piekarnik elektryczny wymaga prądu, kuchenka gazowa nie.
7. Światło: włącznik, zasłony, zapalone w nocy wabi zombie.
8. Łazienka i higiena, zlew.
