# Zadania — Deadzone

Legenda: `[x]` zrobione, `[~]` w toku, `[ ]` do zrobienia. Właściciel w nawiasie. Aktualizuje Szef sztabu.

## Etap 0 — Fundament
- [x] Decyzje startowe od Pawła (Szef sztabu)
- [x] Repo, README, plan i ta lista (Szef sztabu)
- [ ] GDD: pętla rozgrywki, lista mechanik z priorytetami na demo (Szef sztabu + Modules)
- [ ] Monorepo pnpm + Turborepo, TS strict, ESLint, Prettier, Vitest (Silnik)
- [ ] CI GitHub Actions: lint, typecheck, test, build (Silnik)
- [ ] Schematy contentu (zod) i walidator: item, recipe, skill, trait, moodle, lootTable, zombieType (Modules)
- [ ] Style guide wizualny i HUD w Figmie na bazie referencji (Designer)
- [ ] Lista darmowych assetów CC0 + `ASSETS.md` z licencjami (Designer)

## Etap 1 — Prototyp ruchu i świata
- [ ] Scena Three.js, kamera izometryczna, zoom, obrót (Silnik)
- [ ] Teren z kafli + instancing (Silnik)
- [ ] Budynek z wnętrzem, ukrywanie dachu i ścian (Silnik)
- [ ] Pętla symulacji 20 Hz w Web Workerze + interpolacja renderu (Symulacja)
- [ ] ECS (bitecs), RNG z seedem, system komend (Symulacja)
- [ ] Ruch WASD, celowanie myszą, kolizje (Symulacja + Silnik)
- [ ] Dzień i noc, latarnie, cienie (Silnik)
- [ ] Pomiar fps i draw calli w trybie dev (Silnik)

## Etap 2 — Przetrwanie
- [ ] Statystyki: zdrowie, głód, pragnienie, zmęczenie, nuda, stres, temperatura (Symulacja)
- [ ] Moodle i chipy statusu w HUD (Symulacja + Designer)
- [ ] Części ciała, rany, krwawienie, bandaże (Symulacja)
- [ ] Infekcja i gorączka (Symulacja)
- [ ] Sen (Symulacja)
- [ ] Śmierć i ekran podsumowania (Silnik + Designer)

## Etap 3 — Przedmioty i ekwipunek
- [ ] Definicje przedmiotów w JSON (Modules)
- [ ] Ekwipunek z wagą, torby, lewa i prawa ręka (Symulacja)
- [ ] Szybkie sloty 1–5 (Silnik + Designer)
- [ ] Kontenery i akcja „Przeszukaj” z czasem (Symulacja)
- [ ] Okno ekwipunku i przeciąganie przedmiotów (Silnik + Designer)
- [ ] Psucie się jedzenia (Symulacja)

## Etap 4 — Zombie i walka
- [ ] AI: wzrok, słuch, wędrowanie, gonienie (Symulacja)
- [ ] System hałasu (Symulacja)
- [ ] Pathfinding + flow field dla hord (Symulacja)
- [ ] Walka wręcz, stamina, pchnięcie (Symulacja)
- [ ] Broń palna, amunicja, trwałość broni (Symulacja)
- [ ] Ugryzienia i szansa infekcji (Symulacja)
- [ ] Poziom zagrożenia w HUD (Designer + Silnik)
- [ ] Test obciążenia: 200 zombie przy 60 fps (Silnik)

## Etap 5 — Postać i umiejętności
- [ ] Zawody i cechy jako dane (Modules)
- [ ] Ekran tworzenia postaci (Designer + Silnik)
- [ ] Umiejętności 0–10, XP za akcje, mnożniki z książek (Symulacja)
- [ ] Toasty XP i obrażeń (Designer + Silnik)

## Etap 6 — Crafting
- [ ] Receptury jako dane (Modules)
- [ ] Kolejka akcji czasowych z paskiem postępu (Symulacja)
- [ ] Okno craftingu (Designer + Silnik)
- [ ] Gotowanie, bandaże, barykadowanie okien, rozbiórka mebli (Symulacja)

## Etap 7 — Mapa demo i loot
- [ ] Format mapy w chunkach + narzędzie do budowania mapy (Silnik)
- [ ] Miasteczko demo: około 20 budynków, stacja, sklep, apteka (Designer + Silnik)
- [ ] Loot tables zależne od pomieszczeń (Modules)
- [ ] Drzwi i okna: zamykanie, rozbijanie, wchodzenie przez okno (Symulacja)
- [ ] Minimapa i licznik dni (Designer + Silnik)
- [ ] Cele i zadania (Symulacja + Designer)
- [ ] Lokalny zapis i wczytanie gry (IndexedDB) (Symulacja)

## Etap 8 — Konta, serwer i landing
- [ ] Landing page (Designer + Silnik)
- [ ] Supabase Auth: email + Google (Serwer)
- [ ] Tabele profili i zapisów + RLS (Serwer)
- [ ] API zapisów w chmurze z walidacją i limitami (Serwer)
- [ ] Profil i lista zapisów, przycisk „Graj” (Designer + Silnik)

## Etap 9 — Grywalne demo
- [ ] Dźwięki CC0 (Designer)
- [ ] Samouczek i ustawienia (Designer + Silnik)
- [ ] Profilowanie i optymalizacja (Silnik)
- [ ] Sentry i zbieranie błędów (Serwer)
- [ ] Wdrożenie publiczne (Serwer)
- [ ] Playtest i zebranie opinii (Szef sztabu)
