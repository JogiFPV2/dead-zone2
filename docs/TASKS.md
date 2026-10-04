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
- [ ] Okno ekwipunku i przeciąganie przedmiotów (Silnik + Designer)
- [x] Psucie się jedzenia (Symulacja)

## Etap 4 — Zombie i walka
- [x] AI: wzrok, słuch, wędrowanie, gonienie (Symulacja)
- [x] System hałasu (Symulacja)
- [x] Pathfinding + flow field dla hord (Symulacja)
- [ ] Walka wręcz, stamina, pchnięcie (Symulacja) — fizyka (masa, bezwładność, obciążenie, odrzut, zachwianie, przewrócenie, wstawanie) w `sim/src/physics`, podpięta do ruchu, walki i snapshotu (protokół v7); napór tłumu zombie na drzwi / okna / płoty i odpychanie w tłumie (`physics/crowd.ts`)
- [ ] Katalog broni: improwizowana, krótka i długa ostra, tępa, włócznie (Modules)
- [ ] Broń palna: pistolet, rewolwer, strzelba, karabin, amunicja, magazynki, trwałość (Symulacja)
- [ ] Rzucanie przedmiotów jako wabik hałasem (Symulacja)
- [x] Wabiki jako dane: elektroniczny z pilotem i baterią, biegający z craftingu (Modules)
- [ ] Wabik elektroniczny: postawienie, pilot do 60 m, hałas 30 s na 40 m, zombie zostają 20–40 s, zużycie baterii (Symulacja)
- [ ] Wabik biegający: opóźnienie 3–30 s i kierunek od gracza, bieg ~15 m, hałas 20 s na 30 m, jednorazowy (Symulacja)
- [ ] Ugryzienia i szansa infekcji (Symulacja)
- [ ] Poziom zagrożenia w HUD (Designer + Silnik); sim wystawia `view.threat` 0–100
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
- [ ] Książki i magazyny: mnożniki XP i odblokowanie receptur (Modules + Symulacja)
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
- [ ] Loot tables zależne od pomieszczeń (Modules)
- [x] Drzwi i okna: zamykanie, rozbijanie, wchodzenie przez okno, barykady z desek, wyważanie zamkniętych drzwi, brama w ogrodzeniu (Symulacja) — klucze do budynków: TODO
- [ ] Minimapa i licznik dni (Designer + Silnik)
- [ ] Cele i zadania (Symulacja + Designer)
- [ ] Lokalny zapis i wczytanie gry (IndexedDB) (Symulacja)
- [x] LOD symulacji dużej mapy (8×8 km): zombie daleko jako liczniki w komórkach (dryf, reakcja na głośny hałas), rozwijanie i zwijanie deterministyczne z histerezą, leniwy łup per chunk z catch-upem psucia, `worldSettings.simLod` (Symulacja) — [sim-architecture.md 9.24](sim-architecture.md)
- [x] Zapis świata jako delta: `deadzone-save` v2 = seed + `generatorVersion` + zmienione chunki + liczniki komórek + encje aktywne; ok. 230 KiB gzip przy 300 odwiedzonych chunkach; kody błędów wczytania (Symulacja) — 9.24
- [x] Interfejs `WorldSource` dla generatora świata + adapter mapy demo (Symulacja); generator (Silnik 2)
- [x] Streaming dla sim: `setInterest {cx, cy, radiusChunks}`, event `chunkChanged {cx, cy, z, reason}`, pokoje lokalne w chunku + globalny `buildingId` (`roomBuildings`) (Symulacja) — 9.24
- [x] Mapa świata gracza per postać: mgła (bitmapa chunków, odkrywanie w zasięgu wzroku), ślad co 16 m (limit 20 000), znaczniki `addMarker` / `editMarker` / `removeMarker` (także w pauzie, limit 200), `worldSettings.mapMarkers` / `playerMap`, view `worldMap`, eventy `chunksDiscovered` / `markersChanged`, zapis `playerMaps` (Symulacja) — [sim-architecture.md 9.29](sim-architecture.md)
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

## Etap 9 — Grywalne demo
- [ ] Dźwięki CC0 (Designer) — menu: muzyka, otoczenie i UI gotowe (ASSETS.md); efekty w grze brak
- [x] Menu główne z żywą sceną w tle + Ustawienia › Audio, szyny głośności Web Audio (Silnik)
- [ ] Samouczek i ustawienia (Designer + Silnik)
- [ ] Profilowanie i optymalizacja (Silnik)
- [ ] Sentry i zbieranie błędów (Serwer)
- [ ] Wdrożenie publiczne (Serwer)
- [ ] Playtest i zebranie opinii (Szef sztabu)
