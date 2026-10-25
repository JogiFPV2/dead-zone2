# Zadania — Deadzone

Legenda: `[x]` zrobione, `[~]` w toku, `[ ]` do zrobienia. Właściciel w nawiasie. Aktualizuje Szef sztabu.

## Etap 0 — Fundament
- [x] Decyzje startowe od Pawła (Szef sztabu)
- [x] Repo, README, plan i ta lista (Szef sztabu)
- [x] GDD: pętla rozgrywki, lista mechanik z priorytetami na demo (Szef sztabu + Modules) — zastąpione przez PLAN.md
- [x] Monorepo pnpm + Turborepo, TS strict, ESLint, Prettier, Vitest (Silnik)
- [x] CI GitHub Actions: lint, typecheck, test, build (Silnik)
- [x] Schematy contentu (zod) i walidator: item, recipe, skill, trait, moodle, lootTable, zombieType (Modules)
- [ ] Style guide wizualny i HUD w Figmie na bazie referencji (Designer)
- [ ] Lista darmowych assetów CC0 + `ASSETS.md` z licencjami (Designer)

## Etap 1 — Prototyp ruchu i świata
- [x] Scena Three.js, kamera izometryczna, zoom, obrót (Silnik)
- [x] Teren z kafli + instancing (Silnik)
- [x] Budynek z wnętrzem, ukrywanie dachu i ścian (Silnik)
- [x] Pętla symulacji 20 Hz w Web Workerze + interpolacja renderu (Symulacja + Silnik)
- [x] ECS (bitecs), RNG z seedem, system komend (Symulacja)
- [x] Ruch WASD, celowanie myszą, kolizje (Symulacja + Silnik)
- [ ] Dzień i noc, latarnie, cienie (Silnik)
- [x] Pomiar fps i draw calli w trybie dev (Silnik)

## Etap 2 — Przetrwanie
- [x] Statystyki: zdrowie, głód, pragnienie, zmęczenie, nuda, stres, temperatura (Symulacja)
- [~] Moodle i chipy statusu w HUD (Symulacja + Designer) — moodle w sim i widok `view` gotowe; chipy w HUD robią Designer i Silnik
- [x] Części ciała, rany, krwawienie, bandaże (Symulacja)
- [x] Infekcja i gorączka (Symulacja)
- [x] Sen (Symulacja)
- [x] Kary z ran, widzenie w dzień i w nocy, czasy jedzenia i picia jako dane (Modules)
- [ ] Kary z ran do ruchu, ataku i widzenia w sim (Symulacja)
- [ ] Licznik przeżytych dni jako wynik + ekran śmierci ze statystykami (Silnik + Designer)

## Etap 3 — Przedmioty i ekwipunek
- [x] Definicje przedmiotów w JSON (Modules)
- [x] Ekwipunek z wagą, torby, lewa i prawa ręka (Symulacja)
- [ ] Szybkie sloty 1–5 (Silnik + Designer)
- [x] Plecaki i torby: od reklamówki do plecaka wojskowego (pojemność, redukcja wagi) (Modules + Symulacja)
- [~] Schowki: skrzynie, szafki, lodówki, stawiane i przenoszone skrzynie (Symulacja) — w sim gotowe; schowki z mapy (`objects`/`rooms` chunków) przekazywane z `apps/game` (Silnik), kolizje postawionych skrzyń i zapis w diffie chunka później
- [x] Okno przeszukiwania schowka i zapełnienie mebli (propy na półkach wg `fillPct`) (Silnik)
- [x] Kontenery i akcja „Przeszukaj” z czasem (Symulacja)
- [x] Looting/przeszukiwanie nie przez ściany: zasięg + linia `meleeLine`, powód `wall`, `canReachTarget` dla klienta (Symulacja, docs 9.69)
- [ ] Okno ekwipunku i przeciąganie przedmiotów (Silnik + Designer)
- [x] Psucie się jedzenia (Symulacja)
- [x] Test pokrycia ikon: każdy przedmiot ma ikonę w `public/icons` albo jest na `MISSING_ICONS_ALLOWLIST` (`apps/game/src/hud/`), lista tylko maleje (Modules)
- [x] Ikony 107 brakujących przedmiotów (Designer + Silnik) — #189, #190; `MISSING_ICONS_ALLOWLIST` pusta

## Etap 4 — Zombie i walka
- [x] AI: wzrok, słuch, wędrowanie, gonienie (Symulacja)
- [x] System hałasu (Symulacja)
- [x] Pathfinding + flow field dla hord (Symulacja)
- [ ] Walka wręcz, stamina, pchnięcie (Symulacja) — fizyka (masa, bezwładność, obciążenie, odrzut, zachwianie, przewrócenie, wstawanie) w `sim/src/physics`, podpięta do ruchu, walki i snapshotu (protokół v7); napór tłumu zombie na drzwi / okna / płoty i odpychanie w tłumie (`physics/crowd.ts`)
- [x] Katalog broni: improwizowana, krótka i długa ostra, tępa, włócznie (Modules) — `items/weapons-*.json` (#14)
- [x] Improwizowana broń: blok `improvisedWeapon` w przedmiocie, `meleeStatsFor(item)` dla każdego przedmiotu w ręku (Modules)
- [x] Podpiąć `meleeStatsFor` (`@deadzone/content`) pod atak wręcz: obrażenia, zasięg, tempo, trwałość i psucie się przedmiotu, XP dla `skill`, stamina, kryt, dwuręczność, `CombatView.melee` (Symulacja, sim-architecture 9.41)
- [ ] UI: statystyki broni w ręku z `CombatView.melee` (`conditionPct`, `source`) w ActionView / karcie celu (Silnik)
- [ ] Broń palna: pistolet, rewolwer, strzelba, karabin, amunicja, magazynki, trwałość (Symulacja)
- [ ] Rzucanie przedmiotów jako wabik hałasem (Symulacja)
- [x] Wabiki jako dane: elektroniczny z pilotem i baterią, biegający z craftingu (Modules)
- [ ] Wabik elektroniczny: postawienie, pilot do 60 m, hałas 30 s na 40 m, zombie zostają 20–40 s, zużycie baterii (Symulacja)
- [ ] Wabik biegający: opóźnienie 3–30 s i kierunek od gracza, bieg ~15 m, hałas 20 s na 30 m, jednorazowy (Symulacja)
- [ ] Ugryzienia i szansa infekcji (Symulacja)
- [ ] Poziom zagrożenia w HUD (Designer + Silnik); sim wystawia `view.threat` 0–100
- [~] Karta celu w HUD (Symulacja + Silnik) — sim gotowy: `SimViewPatch.target` (lock → kursor → ostatnio trafiony 4 s), komenda `setTarget`, protokół 20 ([sim-architecture.md 9.40](sim-architecture.md)); UI karty: Silnik
- [ ] Test obciążenia: 200 zombie przy 60 fps (Silnik); sim: 200 zombie ≈ 2,5 ms/tick w Node (`test/ai-perf.test.ts`)

## Etap 5 — Postać i umiejętności
- [x] Zawody i kilkadziesiąt cech jako dane, z bilansem punktów (Modules)
- [ ] Cechy zdobywane i tracone w trakcie gry (Symulacja)
- [ ] Ekran tworzenia postaci (Designer + Silnik)
- [x] Kreator postaci jako dane: części wyglądu, palety, pula punktów (Modules)
- [ ] Pula punktów i wygląd w stanie postaci (Symulacja)
- [x] Kasety VHS, telewizor i generator jako dane (Modules)
- [ ] Oglądanie kaset na zasilanym telewizorze, prąd z generatora (Symulacja)
- [ ] Umiejętności 0–10 w kategoriach walka, przetrwanie, rzemiosło i ruch, XP za akcje (Symulacja)
- [x] Książki i magazyny: mnożniki XP i odblokowanie receptur (Modules + Symulacja) — dane `items/books-*.json`, `magazines.json`, `recipe-magazines.json` (#18); sim: `xpMul` w `progress/skills.ts`, czytanie w `crafting.ts`
- [ ] Toasty XP i obrażeń (Designer + Silnik)

## Etap 6 — Crafting
- [x] Receptury jako dane (Modules)
- [x] Stacje rzemieślnicze z poziomami 1–3 i receptury „combine” jako dane (Modules)
- [ ] Łączenie przedmiotów w ekwipunku (combine) (Symulacja)
- [ ] Stacje: stawianie, ulepszanie, crafting przy stacji z poziomem (Symulacja)
- [ ] Ikona łączenia i okno warsztatu z poziomem stacji (Designer + Silnik)
- [ ] Kolejka akcji czasowych z paskiem postępu (Symulacja)
- [ ] Okno craftingu (Designer + Silnik)
- [ ] Gotowanie, bandaże, barykadowanie okien, rozbiórka mebli (Symulacja)

## Etap 7 — Mapa demo i loot
- [x] Format mapy w chunkach + narzędzie do budowania mapy (Silnik)
- [x] Tempo chodu pod mapę 8 × 8 km: chód 1,5 m/s (ok. 91 min przez mapę), bieg × 2,5, `worldSettings.movement` (Symulacja)
- [ ] Miasteczko demo: około 20 budynków, stacja, sklep, apteka (Designer + Silnik)
- [x] Loot tables zależne od pomieszczeń (Modules) — `rooms` w loot tables (`base:room-*`), sim wybiera tabelę wg `chunk.rooms` (`items/loot.ts`)
- [x] Loot per schowek i kategorie (Modules) — każdy schowek ma własną tabelę (`defaultLootTable`) i `lootAccepts` (`LootCategory`, `lootCategoryOf`); nowe typy `base:oven` (prąd), `base:gas-stove`, `base:fridge-freezer` (`compartments`), `base:desk`, `base:tv-stand`, `base:bathroom-cabinet`, `base:shop-counter`; test na dwóch osiach: schowek (`lootAccepts`) × pomieszczenie (`worldSettings.loot.roomAccepts`, `placeIn`) — nie przepuści broni w lodówce ani jedzenia w szafie (wyjątki w `container-loot-allowlist.ts`); `buildingKey` w tabelach szuflad i zombie; README „Loot”
- [x] Wybór tabeli schowka (`lootTableForContainer`) i przegrody `compartments` (Symulacja, PR F1; klucze `buildingKey` w etapie 2)
- [x] Klucze do budynku z `buildingKey` (Symulacja, etap 2): `ItemInstance.buildingId`, zamki drzwi (`lockedDoors` / `exteriorLockedChance`), wytrych, pukanie, rękawice; drzwi i okna w menu `useFurniture` — [sim-architecture.md 9.47](sim-architecture.md)
- [x] Odkażanie ran (woda utleniona, jałowy opatrunek, wódka) i szycie igłą z nicią: `treatWound`, `WoundView.stitched` / `disinfected` (Symulacja, etap 3) — [sim-architecture.md 9.48](sim-architecture.md)
- [x] Meble stałe (Modules) — zlew `base:kitchen-sink`, umywalka `base:bathroom-sink` (schowki, `base:under-sink`), kuchenka z piekarnikiem `base:range` (palniki gazowe + przegroda `base:oven` na prąd, stacja ognia 3), wanna `base:bathtub`, prysznic `base:shower`, magnetowid `base:vcr`, radioodbiornik `base:radio-set` (`items/furniture-fixtures.json`); polskie nazwy w `labels.ts` i `pl.json`. Ikony 5 mebli stałych — partia 9 (#213), rozstawienie — Silnik 2
- [x] Przedmioty codzienne, partia 8 (Modules) — 29 przedmiotów z ikonami Designera: klucz do budynku `base:building-key` (tag `base:building-key`), woda utleniona `base:hydrogen-peroxide` (`disinfect`, tag `base:disinfectant-liquid`), jedzenie z lodówki i spiżarki, mrożonki, napoje, sztućce, otwieracz, blacha, mydło, pasta, ręcznik, środki czystości, leki (przeciwbólowe, antybiotyki, witaminy), długopis; wpisane do tabel kuchni, lodówek, zamrażarek, łazienki, apteki, szpitala, sklepu, stacji i biurek
- [x] Wytrychy i rękawice (Modules) — `base:lockpick` (zestaw wytrychów) i `base:lockpick-fork` (wytrych z widelca), oba z tagiem `base:lockpick`; `base:gloves` (rękawice robocze, slot `hands`, tag `base:gloves`); w garażu, skrzynce narzędziowej i magazynie (rękawice); `openings.locks.exteriorLockedChance` 0,4 — #213
- [x] Szansa zamka per rodzaj budynku (Modules) — `openings.locks.exteriorLockedChanceByBuilding` (domy 0,4, sklepy i usługi 0,7, garaże 0,5, szpital/szkoła/policja 0,2, ruiny 0, bramy `gate` 0,1; reszta `exteriorLockedChance`), `buildingKindFromRooms(roomTypes)` i `exteriorLockedChanceFor(locks, kind)` w `@deadzone/content` (README, „Zamki drzwi”)
- [x] Zamki wg rodzaju budynku w sim (Symulacja, #233, #253: rodzaj z `SimChunk.buildingKinds` przez `lockKindOf`, typy pomieszczeń jako fallback) — w `lockedAtStart` (`openings/state.ts`) zamiast samego `exteriorLockedChance`: rodzaj z `buildingKindFromRooms` (typy pomieszczeń budynku zebrane po `roomBuildings`), szansa z `exteriorLockedChanceFor(locks, kind)`; bramy (`OpeningKind.gate`) — `exteriorLockedChanceFor(locks, 'gate')`
- [x] Sen z budzikiem (`sleep {until}`), odpoczynek `rest` (siedzisko `placeable.seat`), nauka tylko wypoczętym (`tired`) (Symulacja, etap 4) — [sim-architecture.md 9.50](sim-architecture.md)
- [x] Radio (`listenRadio`, `base:station-radio`), VHS przez magnetowid (`base:station-vcr`, `requireVcr`), czytanie z menu łóżka/siedziska (Symulacja, etap 5) — [sim-architecture.md 9.51](sim-architecture.md)
- [x] Gotowanie: kuchenki gaz/prąd (`placeable.cooking`, `station.appliance`, `base:range`), menu `cook:<recipeId>`, przypalanie (`crafting.burn`) (Symulacja, etap 6) — [sim-architecture.md 9.52](sim-architecture.md)
- [x] `base:gas-stove` jako placeable z `cooking` (Modules, #246; ikona — wpis Designera niżej) — [sim-architecture.md 9.52](sim-architecture.md)
- [x] Włączniki światła w pokojach (`base:light-switch`), zasłony, zapalone okno w nocy wabi zombie (`lighting.lure`, hałas `light`) (Symulacja, etap 7) — [sim-architecture.md 9.53](sim-architecture.md)
- [x] Placeable włącznika światła z tagiem `base:light-switch` + ikona (Modules), po jednym w pokoju z lampą (Silnik 2, `ROOM_KITS`) — [sim-architecture.md 9.53](sim-architecture.md)
- [x] Łazienka i woda z sieci: brud (`PlayerView.dirt`), `useWater` (picie z kranu, mycie, prysznic, wanna), tagi `base:water-tap` / `base:shower` / `base:bath` (Symulacja, etap 8) — [sim-architecture.md 9.54](sim-architecture.md)
- [x] Magnetowid `base:vcr` obok telewizora i radio `base:radio-set` w salonach (Silnik 2, `ROOM_KITS`); krzesła/fotele z `placeable.seat` (Modules)
- [ ] Meble wg typu pomieszczenia (Silnik 2) — `ROOM_KITS` w `tools/map/src/furnish.ts`: kuchnia + `base:oven` (albo `base:kitchen-oven` z `containerType`); lodówka `base:fridge-freezer` zamiast pary `base:fridge` + `base:freezer`, kuchenka `base:gas-stove` lub piekarnik `base:oven`; łazienka `base:bathroom-cabinet` zamiast `base:kitchen-cabinet`; salon + `base:tv`, `base:tv-stand`; sypialnia/biuro + `base:desk`; sklep, stacja, apteka, sklep z bronią: lada `base:shop-counter` zamiast `base:kitchen-counter`. Typowe pomieszczenia każdego schowka są w `placeIn` (dane). Po podmianie usunąć `TABLE_EXCEPTIONS` z `packages/content/src/test/container-loot-allowlist.ts`. Modele i etykiety nowych schowków (`model-kit.ts`, `labels.ts`) — Designer + Silnik
- [x] Siedziska, kuchenka gazowa, włącznik światła w content (Modules) — `base:chair`, `base:armchair` (`placeable.seat`, 1×1, bez schowka; pełny `rest` z #220), przedmiot `base:gas-stove` (`containerType` + stacja ognia 3 + `cooking { burners: gas, oven: gas }` dla #241), `base:light-switch` (tag `base:light-switch` = `lighting.switchTag` z #242, `placeable: {}` — nie blokuje, sim nie ma montażu na ścianie)
- [x] Rozstawienie krzeseł, foteli i włączników (Silnik 2) — `ROOM_KITS` w `tools/map/src/furnish.ts`: krzesła przy stole/biurku (kuchnia, biuro, szkoła), fotel w salonie; `base:light-switch` w każdym pokoju z lampą `requiresPower` (przy drzwiach), bez niego lampy świecą przy prądzie jak dotąd; kuchnia: `base:gas-stove` albo `base:range` (oba gotują)
- [x] Stół i lampy na prąd w content (Modules) — `base:table` (2×1, bez schowka), `base:floor-lamp` i `base:desk-lamp` (`placeable.light`, `requiresPower`, tag `base:light`, bez footprintu jak `base:ceiling-lamp`); włącznik z #242 steruje nimi w swoim pokoju
- [x] Rozstawienie stołu i lamp (Silnik 2) — `ROOM_KITS`: `base:table` w kuchni / salonie (krzesła przy stole, przodem do niego), w szkole (stół nauczyciela z lampką, bo biurko ma `placeIn` bez szkoły) i biurze; `base:floor-lamp` w rogu salonu i sypialni, `base:desk-lamp` na biurku (+0,75 m); `base:ceiling-lamp` w kuchni, łazience, salonie i sypialni; włącznik w każdym pokoju z lampą. Pokoju „jadalnia” nie ma w content. Tymczasowe modele Kenney (stół, krzesło, 3 lampy) do czasu modeli Designera
- [x] Toaleta `base:toilet` w content (Modules) — placeable 1×1 (jawny `footprint`, blokuje kafel), tag `base:toilet`, bez wody (schemat higieny ma tylko wodę z sieci: kran / prysznic / wanna)
- [x] Rozstawienie toalety (Silnik 2) — `ROOM_KITS` łazienka: `K('base:toilet', 1, 1, 0, TALL)` (plecami do pełnej ściany, przodem do pokoju, nie w drzwiach); tymczasowy model Kenney `toilet` w kliencie
- [x] Zbiornik wody w content (Modules) — opcjonalne `placeable.waterTank { capacityL > 0, quality: 'clean' | 'tainted', refillFromMains = true }` (`schemas/item/water-tank.ts`, typ `WaterTank`); `base:toilet` = `{ capacityL: 10, quality: 'tainted', refillFromMains: true }`
- [x] Woda w zbiorniku toalety (Symulacja, #260) — pobór z `placeable.waterTank` (zapas w stanie mebla, `tainted` do zagotowania, dopełnianie z sieci tylko przy `refillFromMains` i działającej wodzie)
- [x] Stałe wody w content (Modules) — `worldSettings.water { tankDrinkL, fillMin, bottles { empty, clean, tainted } }` (`world-settings/water.json`) i `waterContainer { capacityL }` na butelkach, wartości 1:1 ze stałymi z #260
- [x] Przepięcie sim na content (Symulacja, #263) — `furniture/water.ts`: `TANK_DRINK_L` → `worldSettings.water.tankDrinkL`, `FILL_MIN` → `water.fillMin`, `WATER_ITEMS` → `water.bottles`, `BOTTLE_L` → `waterContainer.capacityL` przedmiotu
- [ ] Model i ikona toalety (Designer) — model (Kenney `toilet.glb` / `toiletSquare.glb` leży w `assets-src/kenney_furniture-kit`, nie ma go w `public/models`; dziś szare pudełko), ikona `base:toilet` (na `MISSING_ICONS_ALLOWLIST`)
- [x] Blaty w content (Modules) — `surfaceHeightM` (typ schowka / `placeable`): `base:tv-stand` 0.55, `base:desk` 0.75, `base:table` 0.75, `base:shop-counter` 0.95; `placeable.onSurface` na `base:tv`, `base:vcr`, `base:radio-set`, `base:desk-lamp`; `surfaceHeightForId`, `onSurfaceForId`
- [ ] Meble `onSurface` na blatach (Silnik 2) — generator i render: obiekt z `onSurface` na kaflu mebla z `surfaceHeightForId`, wysokość = blat; dziś na mapach bazowych telewizor (125), magnetowid (125) i radio (164) stoją na kaflach bez mebla pod spodem (lampki biurkowe już na biurkach i stołach)
- [ ] Model i ikony stołu i lamp (Designer) — model `base:table` (dziś szare pudełko), lampy stojąca i biurkowa; ikony `base:table`, `base:floor-lamp`, `base:desk-lamp` (na `MISSING_ICONS_ALLOWLIST`)
- [ ] Ikony i modele (Designer) — ikony: `base:chair`, `base:armchair`, `base:gas-stove` (przedmiot), `base:light-switch` (na `MISSING_ICONS_ALLOWLIST`); modele: krzesło, fotel, włącznik (dziś szare pudełko); `base:gas-stove` ma model w `deadzone-furniture`
- [x] Drzwi i okna: zamykanie, rozbijanie, wchodzenie przez okno, barykady z desek, wyważanie zamkniętych drzwi, brama w ogrodzeniu (Symulacja) — klucze do budynków: 9.47
- [ ] Minimapa i licznik dni (Designer + Silnik)
- [x] Schemat punktów zaczepienia przewodów na słupach (Modules) — `@deadzone/content/wires`: `attachFileSchema` dla `<modelId>.attach.json` obok modelu (`{modelId, kind: hv110|hv220|hv400|lv|catenary, attach: [{id, x, y, z}]}`, metry od podstawy, y w górę), `WIRE_RULES` (dozwolone id per kind; drugi tor `L4`–`L6` all-or-none, `GW2` tylko z `GW`), `attachPoint(file, id)`; test waliduje każdy `*.attach.json` w repo. Modele słupów (Designer), przewody ze zwisem (Silnik 2)
- [ ] Cele i zadania (Symulacja + Designer)
- [ ] Lokalny zapis i wczytanie gry (IndexedDB) (Symulacja)
- [x] LOD symulacji dużej mapy (8×8 km): zombie daleko jako liczniki w komórkach (dryf, reakcja na głośny hałas), rozwijanie i zwijanie deterministyczne z histerezą, leniwy łup per chunk z catch-upem psucia, `worldSettings.simLod` (Symulacja) — [sim-architecture.md 9.24](sim-architecture.md)
- [x] Zapis świata jako delta: `deadzone-save` v2 = seed + `generatorVersion` + zmienione chunki + liczniki komórek + encje aktywne; ok. 230 KiB gzip przy 300 odwiedzonych chunkach; kody błędów wczytania (Symulacja) — 9.24
- [x] Interfejs `WorldSource` dla generatora świata + adapter mapy demo (Symulacja); generator (Silnik 2)
- [x] Streaming dla sim: `setInterest {cx, cy, radiusChunks}`, event `chunkChanged {cx, cy, z, reason}`, pokoje lokalne w chunku + globalny `buildingId` (`roomBuildings`) (Symulacja) — 9.24
- [x] Mapa świata gracza per postać: mgła (bitmapa chunków, odkrywanie w zasięgu wzroku), ślad co 16 m (limit 20 000), znaczniki `addMarker` / `editMarker` / `removeMarker` (także w pauzie, limit 200), `worldSettings.mapMarkers` / `playerMap`, view `worldMap`, eventy `chunksDiscovered` / `markersChanged`, zapis `playerMaps` (Symulacja) — [sim-architecture.md 9.29](sim-architecture.md)
- [x] Wiedza o piętrach dla mapy gracza (docs/floors-ui.md): `WorldMapView.rooms` / `roomsAdd` (`seen` / `searched`), `z` znaczników, `sensedZombies`, `zombieSightings`, zapis `rooms` / 8. element znacznika (Symulacja) — [sim-architecture.md 9.42](sim-architecture.md)
- [ ] `SimFloorIntel` za `FloorIntel` na polach z 9.42 (Silnik, #195)
- [x] Audyt mebli i czynności; prąd i woda z wyłączeniem wg `worldSettings.utilities`, lodówka/zamrażarka zależna od prądu, `SimViewPatch.utilities`, `utilityChanged` (Symulacja) — [sim-architecture.md 9.46](sim-architecture.md)
- [x] Footprint mebli (Modules) — opcjonalne `footprint: { w, h }` (1–4 kafli, brak = 1×1) w typach schowków i `placeable`; `@deadzone/content/footprint`: `footprintOf`, `footprintForId`, `rotatedFootprint`, `occupiedTiles`, `footprintCenter`; kotwica = kafel NW, przy `rot` 1/3 boki się zamieniają (README, „Footprint mebli”). 2×1: wanna, lada, biurko, kanapa, `base:metal-shelf`; 1×2: `base:bed`
- [ ] Footprint w kolizjach i szukaniu mebla (Symulacja) — blokada ruchu i wzroku na wszystkich `occupiedTiles`, „najbliższy mebel” (spanie, przeszukiwanie, stacje, telewizor, zlew) liczony od najbliższego zajętego kafla, a nie od kotwicy
- [ ] Footprint w renderze (Silnik) — `fitTile` w `map-objects.ts` skaluje model do `footprintForId` (W×H po obrocie, minus szczelina) zamiast 0,96 kafla, model w `footprintCenter`; to samo dla szarych pudełek i x-raya
- [ ] Footprint w `furnish.ts` (Silnik 2) — rozstawianie sprawdza wszystkie `occupiedTiles` (wolne, w tym samym pokoju, bez ściany/drzwi między kaflami, plecy do pełnej ściany na całej szerokości); przebudować mapy — po nowych rozmiarach na obecnych mapach nakłada się 246 kafli w `osm-okulickiego` i 69 w `town-catalog` (kanapy, łóżka, `base:metal-shelf`)
- [x] Pole materiału modelu `material: vc | pbr` + `pbr { albedo, normal, orm, layers, lowRes? }` (Modules; kształt od Designera, wcześniej `atlas`/`roughness`) — `tools/assets/src/material.ts`, wpisy modeli w packach, manifest (tylko dla `pbr`), `assets check`; README „Materiał modelu”
- [ ] Dane PBR dla pilota stylu realistycznego (Designer) — tekstury warstw (`albedo`, `normal`, `orm`, `layers`, opcjonalnie `lowRes`; ścieżki względne do `public`, warstwa w GLB `TEXCOORD_1`) i `material: "pbr"` dla `blok-p4`, `blok-p10`, domów, drzew i auta
- [ ] Czytanie `material` / `pbr` z manifestu w kliencie (Silnik) — przy `render.style = 'real'` materiał PBR z atlasu zamiast kolorów wierzchołków / palety; brak pola = `vc`
- [x] Modele mebli Designera w grze (Modules) — pack `deadzone-furniture` (`tools/assets/furniture/*.glb` → `public/models/deadzone-furniture/`): łóżko, łóżko podwójne, kanapa, regał metalowy, biurko, lada; `CONTAINER_MODELS` + `REAL_SCALE_FURNITURE` (skala 1:1, origin w środku footprintu, plecy przy ścianie −z); przy wyłączonym footprincie `fitTileRealScale` ściska każdą oś osobno do 0,96 kafla; półki regału 0,044/0,28/0,51/0,74/0,98 wysokości (`shelf-fill-model.ts`, `depthOffset`, `layoutProfile`)
- [x] Wypełnienie półek przy włączonym footprincie (Modules) — `shelfOrigin` (Silnik, #222) + profil regału 2×1 na realną szerokość (`size` 1,8 m, 10 kolumn); przy wyłączonym footprincie `layoutProfile` ściska układ do 0,96 kafla jak model
- [ ] Footprint przy przesuwaniu mebli (Fizyka) — cel przesunięcia i obrotu musi mieć wolne wszystkie `occupiedTiles`; obrót 2×1 wokół kotwicy NW zmienia zajęte kafle
- [x] Test map: obiekty nie nachodzą na siebie wg `occupiedTiles` (Modules) — po przebudowie map przez Silnika 2 (#252, `map-furniture-overlap.test.ts`)
- [x] Łóżko podwójne `base:double-bed` 2×2 (Modules + Designer) — przedmiot (`placeable`, `sleepSurface: bed`, `footprint {w:2,h:2}`), ikona partii 9, model Designera `/workspace/assets-src/furniture/double-bed.glb` (166×199 cm, origin w środku footprintu) — #213
- [ ] Rozstawienie łóżka podwójnego (Silnik 2) — `furnish.ts` stawia je w sypialniach z miejscem 2×2, wezgłowie przy ścianie; render modelu po włączeniu `worldSettings.furnitureFootprint`
- [ ] Generator świata 8×8 km wg `WorldSource` (`chunkKind`, `generatorVersion`) (Silnik 2)
- [x] Tryby gry jako dane: „Przetrwaj” i „Ratunek” (Modules)
- [ ] Tryb „Przetrwaj”: wynik = przeżyte dni (Symulacja)
- [ ] Tryb „Ratunek”: NPC zamknięty w willi, pilnująca horda (limit 300), wywabienie hordy i ewakuacja NPC (Symulacja)

## Etap 8 — Konta, serwer i landing
- [ ] Landing page (Designer + Silnik)
- [ ] Supabase Auth: email + Google (Serwer) — projekt: [backend.md](backend.md); serwer weryfikuje JWT przez JWKS, czeka na projekt Supabase, Google OAuth i SMTP (Paweł)
- [x] Tabele profili i zapisów + RLS (Serwer) — `supabase/migrations`, tylko pliki; zastosowanie na produkcji wymaga zgody Pawła
- [x] API zapisów w chmurze z walidacją i limitami (Serwer) — `apps/server` `/v1/characters…`, rate limit konta/IP (429 + `Retry-After`), `DELETE` postaci i konta (RODO); walidacja DZSV w `worker_threads` (timeout + limit sterty)
- [ ] Profil i lista zapisów, przycisk „Graj” (Designer + Silnik)
- [x] Ostatnia lokacja na karcie postaci i zajęte miejsce konta (Serwer) — `lastLocation` z `saveSummary` sima w workerze walidacji, `usage {usedBytes, limitBytes, alive, aliveLimit}` w `GET /v1/characters`; `place` = najbliższe miejsce z pliku miejsc mapy (`world_settings.map`, `@deadzone/content`), null bez pliku
- [x] Schemat i rejestr nazw miejsc (Modules) — `@deadzone/content/places`: `placeSchema` / `placesFileSchema` (`{name, x, y}` + opcjonalne `kind`: district|town|village), `nearestPlace(places, x, y)` (ta sama semantyka co w simie), `PLACES_FILES` / `placesFileFor(mapId)` (`osm-stw` → `places/stalowa-wola.json`); Node: `loadPlaces(mapId)` / `createPlacesCache()` z `@deadzone/content/node` (null bez pliku). Podpięcie `place` w `GET /v1/characters` według `world_settings.map` (Serwer)
- [x] Ustawienia gracza w chmurze (Serwer) — `GET`/`PUT /v1/me/settings`: `profiles.settings jsonb` + `settings_version` (ETag), najwyżej 16 KB, `If-Match` (428 bez, 412 nieaktualny), walidacja `validatePlayerSettings` z `@deadzone/ui/settings` (zapisywane tylko `data`), 413 `too-large`, 422 `invalid_settings` z `issues`; limit żądań na IP
- [ ] CAPTCHA Turnstile (Serwer + Silnik) — konfiguracja w Supabase Auth (Auth › Attack Protection: dostawca Turnstile + secret key); Supabase Auth sam weryfikuje token przy logowaniu i rejestracji, bez osobnej kontroli w naszym API. Klient przekazuje `captchaToken` w opcjach `signInWithOtp` / `signUp` (i logowania hasłem); site key to publiczna zmienna env klienta
- [x] Strona polityki prywatności (Serwer) — `apps/game/public/privacy/index.html` → https://jogifpv2.github.io/deadzone-play/privacy/; administrator i kontakt: Paweł Rosol, pawelrosol@gmail.com

## Etap 9 — Grywalne demo
- [ ] Dźwięki CC0 (Designer) — menu: muzyka, otoczenie i UI gotowe (ASSETS.md); efekty w grze brak
- [x] Menu główne z żywą sceną w tle + Ustawienia › Audio, szyny głośności Web Audio (Silnik)
- [x] Tło menu: pętla pory dnia 55 s (dzień 20 · zachód 10 · noc 15 · wschód 10), moduł `menu-day-cycle` niezależny od sceny, `?menuTime=` (Silnik)
- [x] Tło menu: scena OSM Stalowej Woli (wiadukt KEN / ul. Okulickiego) w town kicie gry, gracz + zombie ze sceny, cykl pory dnia, atrybucja OSM (Silnik)
- [ ] Samouczek i ustawienia (Designer + Silnik)
- [x] Schemat układu HUD i ustawień gracza (Modules) — `@deadzone/ui/settings`: `HUD_ELEMENT_IDS`, `HUD_LAYOUT_SLOTS`, `hudLayoutSchema`, `DEFAULT_HUD_LAYOUT`, `resolveLayout`, `clampToViewport`; `playerSettingsSchema` (v1, limit 16 KB) + `resolveSettings` / `validatePlayerSettings` dla serwera. Bez DOM; edytor HUD w kliencie jeszcze niepodpięty (Silnik)
- [ ] Profilowanie i optymalizacja (Silnik)
- [ ] Sentry i zbieranie błędów (Serwer)
- [ ] Wdrożenie publiczne (Serwer)
- [ ] Playtest i zebranie opinii (Szef sztabu)

## Multiplayer
- [ ] Ostrzeżenie o zagrożeniu przy otwartym menu (Serwer + Symulacja + Silnik) — flaga konfiguracji serwera `menuThreatWarning` (domyślnie wyłączona), wysyłana klientowi w ustawieniach świata przy połączeniu; zagrożenie liczy sim na serwerze jako czas dojścia ≤ 4 s, nigdy klient; gracz z otwartym menu dalej może zostać zaatakowany (online nie ma pauzy); event `menuThreat` przy wyłączeniu z opóźnieniem 1 s; ustawienie klienta „Ogranicz migotanie”
