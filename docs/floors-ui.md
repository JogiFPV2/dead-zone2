# Piętra (UI) — co robi klient, czego potrzebuje od symulacji

Spec: `deadzone-hud-v2-spec.md`, sekcja „Piętra (UI)”. Kod: `apps/game/src/floors/`,
`apps/game/src/hud/floor-hud.ts`, `apps/game/src/bigmap/floor-panel.ts`.

## Co jest po stronie klienta (bez symulacji)

Rzut każdego piętra budynku (pomieszczenia, ściany, okna, drzwi, klatki schodowe) klient
składa sam ze statycznych chunków mapy: warstwy `room` / `rooms`, `edgeN` / `edgeW` +
`edgePalette` i `stairs`, a budynek bierze z `BuildingLookup.at(tx, ty, z)`
(`floors/building-plan.ts`). Pomieszczenia przecinające granicę chunka są sklejane, biegi
schodów dostają litery A, B, … według klatki.

Klient sam liczy też: piętro gracza (`floor(state.z)`), nazwy pięter, zmianę piętra (toast,
animacja odznaki) i to, czy gracz był na piętrze (wynika z listy pomieszczeń).

## Wiedza gracza — `FloorIntel` z danych sima (protokół 22)

Wiedza gracza o wnętrzach idzie przez interfejs `FloorIntel` (`floors/floor-intel.ts`):

```ts
interface FloorIntel {
  readonly version: number;
  room(room: { key: RoomKey; parts: { cx; cy; room }[] }, z: number): 'unknown' | 'seen' | 'searched';
  sensedZombies(): readonly SeenZombie[]; // { x, y, z, tick }
  lastSeenZombies(): readonly SeenZombie[];
  markerZ(id: number): number | undefined;
}
```

- `SimFloorIntel` (gra): `worldMap.rooms` / `roomsAdd` → stan pomieszczeń (pomieszczenie na
  kilku chunkach jest `searched`, gdy któraś część jest przeszukana i żadna nie jest tylko
  widziana), `sensedZombies` (stableId) → pozycje i poziom z encji snapshotu,
  `worldMap.zombieSightings` → „ostatnio widziane” w panelu budynku, `MapMarkerView.z` →
  piętro znacznika. Nowe znaczniki idą na bieżące piętro gracza (`AddMarkerCommand.z`).
- `DemoFloorIntel` (`?floorsDemo=1`, tylko do zrzutów/przeglądu): stałe dane wokół gracza.

Lokalny zastępnik (`LocalFloorIntel`) usunięty: sim w workerze zawsze wysyła te pola, a mock
(`?crowd=N`) nie ma pomieszczeń ani zombie.

## Prośba do Symulacji (pola i typy) — zrobione w #194 (protokół 22)

Pomieszczenie identyfikujemy tak jak w danych mapy: chunk `(cx, cy)`, poziom `z` i lokalny
`RoomId` z warstwy `room` tego chunka (pomieszczenie przecinające chunki to kilka wpisów —
klient je skleja).

1. Stan pomieszczeń — `packages/protocol/src/views.ts`, `WorldMapView`:

   ```ts
   export type RoomIntelState = 'seen' | 'searched';
   export interface RoomIntelView {
     cx: number; // chunk x
     cy: number; // chunk y
     z: number; // poziom (0 = parter, ujemne = piwnica)
     room: number; // RoomId z warstwy `room` chunka (cx, cy, z)
     state: RoomIntelState;
   }
   export interface WorldMapView {
     // …
     /** Pełna lista: pierwszy widok, po wczytaniu zapisu, po resecie. */
     rooms?: RoomIntelView[];
     /** Zmiany od ostatniego widoku (nowe lub `seen` → `searched`), jak `trailAdd`. */
     roomsAdd?: RoomIntelView[];
   }
   ```

   - `seen`: pomieszczenie było w polu widzenia gracza (ta sama widoczność co dla bytów),
     wystarczy kawałek podłogi.
   - `searched`: gracz przeszukał (otworzył) każdy przeszukiwalny pojemnik świata w tym
     pomieszczeniu; pomieszczenie bez pojemników przechodzi w `searched`, gdy gracz w nim
     stanie.
   - Stan tylko rośnie (`unknown` → `seen` → `searched`), per gracz, zapisywany w save'ie.

2. Piętro znaczników — `MapMarkerView.z: number` (wymagane w widoku), w komendach
   `AddMarkerCommand.z?: number` (domyślnie 0) i `EditMarkerCommand.z?: number`.
   Klient wysyła piętro, które jest otwarte w panelu budynku (albo piętro gracza).

3. Zombie z piętrem:
   - wyczute teraz — `SimViewPatch.sensedZombies?: number[]` (stableId zombie, które gracz
     teraz widzi lub słyszy; pozycję i `z` klient bierze z encji snapshotu, które `z` już
     mają). Równoważnie może to być flaga na encji.
   - ostatnio widziane — `WorldMapView.zombieSightings?: { x: number; y: number; z: number; tick: number }[]`
     (ostatnia obserwacja per zombie, najwyżej ~64 najnowsze, `tick` = tick symulacji).

Nie potrzebujemy osobnego „odwiedzone piętro” — wynika z `rooms`.

## Czego jeszcze nie ma

- liczby mieszkań w nagłówku panelu (brak w danych mapy),
- adresu (nagłówek pokazuje lokalizację z dużej mapy).
