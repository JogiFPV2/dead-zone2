# Plan gry — Deadzone (nazwa robocza)

## Decyzje Pawła (30.09.2026)
| # | Temat | Decyzja |
|---|-------|---------|
| 1 | Tryb | Najpierw pełny singleplayer. Multiplayer później, ale architektura od dnia 1 musi go umożliwiać. |
| 2 | Model | Na razie darmowa. Komercja to cel długoterminowy. |
| 3 | Platforma | Przeglądarka na komputerze (mysz + klawiatura). Później Android, może iOS. |
| 4 | Pierwszy cel | Grywalne demo, w którym da się coś robić i sprawdzić kierunek. |
| 5 | Grafika | 3D low-poly, kamera izometryczna jak na screenie referencyjnym. |
| 6 | Assety | Na start darmowe (CC0: Kenney, Quaternius, Poly Pizza CC0, freesound CC0). Każdy asset wpisany do `ASSETS.md` z licencją. |
| 7 | Mody | Tak. Cała zawartość gry trzymana jako dane. |

## Cel gry i wymagania Pawła (30.09.2026)
- **Cel:** przeżyć jak najwięcej dni. Licznik dni jest główną miarą wyniku, a ekran śmierci pokazuje przeżyte dni i statystyki.
- **Schowki:** skrzynie, szafki, lodówki, bagażniki. Mają pojemność, gracz może je stawiać i przenosić (skrzynia z desek z craftingu), a zawartość zapisuje się w stanie chunka.
- **Plecaki i torby:** od reklamówki, przez torbę sportową i plecak szkolny, po duży plecak turystyczny i wojskowy. Różnią się pojemnością i redukcją wagi, zakłada się je na plecy albo nosi w ręce.
- **Broń, pełna skala:** improwizowana (butelka, kamień, cegła, deska), krótka ostra (nóż kuchenny, nóż myśliwski, śrubokręt), długa ostra (maczeta, siekiera), tępa (kij baseballowy, łom, młotek, kij z gwoździami), długa (włócznia z craftingu), palna (pistolet, rewolwer, strzelba, karabin) z amunicją, magazynkami, hałasem i trwałością. Broń i przedmioty rzucane (butelka, kamień) odciągają zombie hałasem.
- **Rozwój postaci na setki sposobów:** zawody i kilkadziesiąt cech (pozytywnych i negatywnych) z bilansem punktów przy tworzeniu postaci, umiejętności w kategoriach (walka: tępa, ostra, długa, krótka, palna; przetrwanie: gotowanie, pierwsza pomoc, zbieractwo, rybołówstwo, pułapki; rzemiosło: stolarka, mechanika, elektryka, krawiectwo, metalurgia; ruch: sprint, skradanie, zręczność, siła, kondycja), książki i magazyny odblokowujące receptury i mnożące XP, cechy zdobywane i tracone w trakcie gry (np. otyłość, wytrzymałość). Wszystko jako dane, więc łatwo rozbudowywać i modować.

## Tryby gry singleplayer (30.09.2026)
Tryby są danymi (`packages/content`, katalog `game-modes/`): cel wygranej i przegranej jako deklaratywne warunki, preset świata (start, populacja zombie, twardy limit zombie, hordy wokół stref, odradzanie), zasady startu (zawody, cechy, zestaw startowy) i definicja wyniku. Mody mogą więc dodawać własne tryby i scenariusze bez zmian w kodzie. Oba tryby są w demie.
- **„Przetrwaj”:** przeżyj jak najdłużej, wynik = przeżyte dni.
- **„Ratunek”:** NPC jest bezpiecznie zamknięty w willi otoczonej pilnującą hordą (w tym trybie limit np. 300 zombie). Gracz przebija się, odciąga hordę i wyprowadza NPC do strefy ewakuacji.

**Wabiki** (przedmioty jako dane, mechanika w Symulacji):
- **Elektroniczny:** gracz go stawia i uruchamia pilotem z odległości do 60 m. Hałas trwa 30 s i słychać go w promieniu 40 m. Zombie kręcą się w miejscu 20–40 s, potem się rozchodzą. Zużywa baterie.
- **Biegający:** craft z tuszki królika, części mechanicznej i drutu. Gracz ustawia opóźnienie 3–30 s i kierunek. Wabik przebiega około 15 m i hałasuje przez 20 s w promieniu 30 m. Jest jednorazowy (niszczy się).

## Zasady architektury
1. **Symulacja oddzielona od renderu.** `packages/sim` to czysty TypeScript bez DOM i bez Three.js. Działa na stałym ticku (20 Hz) i jest deterministyczny (własne RNG z seedem). Ten sam kod uruchamia przeglądarka (w Web Workerze) i później serwer, który ma ostatnie słowo w multiplayerze.
2. **Zawartość jako dane.** Przedmioty, receptury, umiejętności, cechy, moodle, loot tables i typy zombie to pliki JSON walidowane schematem (zod). Mod to paczka takich plików plus nadpisania.
3. **Komendy zamiast bezpośrednich zmian stanu.** Gracz wysyła komendy (ruch, podnieś, craftuj). Symulacja je przetwarza. To od razu daje sieciowość, replay i zapis gry.
4. **ECS** (bitecs) dla encji: gracz, zombie, przedmioty na ziemi, kontenery, drzwi.
5. **Świat w chunkach** (np. 32×32 kafle) wczytywanych strumieniowo. Zapis gry to seed plus diff chunków.
6. **Budżet wydajności** (średni laptop, zintegrowane GPU): 60 fps, poniżej 250 draw calli (instancing, wspólne atlasy), pierwsze wczytanie poniżej 15 MB, poniżej 1 GB RAM.

## Stack
- Monorepo: pnpm + Turborepo, TypeScript strict, ESLint, Prettier, Vitest, Playwright.
- Klient gry: Three.js + Vite. UI gry (HUD, ekwipunek) w React nad canvasem.
- Landing i konto: React + Vite (albo Astro), Tailwind + shadcn.
- Backend: Supabase (Auth, Postgres, Storage na zapisy gry) plus serwer Node (Fastify) na walidację i przyszły multiplayer (Colyseus albo własne WebSockety).
- Hosting: statyczny front (Vercel/Cloudflare/Hostinger), serwer na VPS.

## Struktura repo
```
apps/web        landing, rejestracja, logowanie, profil, przycisk „Graj”
apps/game       klient gry (Three.js + HUD)
apps/server     API zapisów, walidacja, później serwer multiplayer
packages/sim    symulacja (przetrwanie, walka, AI, crafting, umiejętności)
packages/content  definicje JSON + schematy (baza pod mody)
packages/protocol typy komend i snapshotów (klient ↔ serwer)
packages/ui     wspólne komponenty UI (design system)
tools/          edytor/konwerter map, walidator contentu
```

## Etapy

### Etap 0 — Fundament
Repo, monorepo, CI (lint, typy, testy, build), konwencje, dokument projektu gry (GDD) i pierwszy szkic wyglądu UI od Designera.
**Gotowe, gdy:** `pnpm build` i `pnpm test` przechodzą w CI, GDD jest zatwierdzony przez Pawła.

### Etap 1 — Prototyp ruchu i świata („szare pudełka”)
Scena Three.js z kamerą izometryczną (zoom, lekki obrót), teren z kafli, jeden budynek z wnętrzem (ukrywanie dachu po wejściu), ruch WASD i celowanie myszą, kolizje, cykl dnia i nocy z latarniami, pętla symulacji w Web Workerze.
**Gotowe, gdy:** da się chodzić po małej mapie w 60 fps, a noc wygląda jak na referencji.

### Etap 2 — Przetrwanie
Statystyki: zdrowie, głód, pragnienie, zmęczenie, nuda, stres, temperatura. Moodle (chipy statusu jak „Infekcja”, „Ból 2”, „Gorączka”). Ciało podzielone na części z ranami (zadrapanie, rana szarpana, ugryzienie), krwawienie, bandaże, infekcja, śmierć i ekran śmierci.
**Gotowe, gdy:** bez jedzenia i picia postać słabnie i umiera, a rany trzeba opatrywać.

Kary z ran (`worldSettings.survival.woundPenalties`, **do balansu z Symulacją**). Zadrapanie i rana szarpana są lekkie, ugryzienie i głęboka rana ciężkie. Wartości to utrata w %: ruch / atak / tempo akcji / widzenie.

| Grupa | Lekka | Ciężka |
|---|---|---|
| Noga (udo, goleń, stopa) | 15 / 0 / 5 / 0 | 35 / 5 / 10 / 0 |
| Ręka (ramię, przedramię, dłoń) | 0 / 15 / 10 / 0 | 5 / 35 / 25 / 0 |
| Tułów (klatka, brzuch, krocze) | 5 / 5 / 5 / 0 | 15 / 15 / 15 / 0 |
| Głowa (głowa, szyja) | 0 / 0 / 5 / 10 | 5 / 5 / 10 / 25 |

W grupie liczy się najcięższa rana, grupy się sumują, a każda kara ma limit 60%. Opatrzona rana daje połowę kary. Widzenie zmniejszają też ból (od 50: −10%), gorączka (od 40: −15%, rozmycie 0,3) i krwawienie (od 30: −20%, rozmycie 0,2). Przeciążenie spowalnia tylko przez moodle „Ciężki ładunek” i przyspiesza zmęczenie ×1,5.

Widzenie (`worldSettings.vision`) działa tak samo dla gracza i zombie: 30 kafli w dzień, w nocy ×0,4, a światło (latarka, lampa, ognisko) podnosi czynnik o 0,5 × jasność, najwyżej do pełnego zasięgu. Strefy mapy z `role: 'dark'` (piwnice, lasy nocą) liczą się jak noc także w dzień. Latarka ma stożek 50° i działa na baterii.

### Etap 3 — Przedmioty i ekwipunek
Definicje przedmiotów, ekwipunek z wagą i obciążeniem, torby, ręce (lewa/prawa), szybkie sloty 1–5, kontenery (szafki, lodówki), akcja „Przeszukaj” z czasem trwania, podnoszenie i upuszczanie, psucie się jedzenia.
**Gotowe, gdy:** można przeszukać dom, zabrać jedzenie, zjeść je i wyposażyć broń.

### Etap 4 — Zombie i walka
AI zombie: wzrok, słuch (hałas z kroków, strzałów, rozbijanych okien), wędrowanie, gonienie, gromadzenie się w hordy. Walka wręcz (zasięg, stamina, pchnięcie), broń palna z amunicją i hałasem, trwałość broni. Wskaźnik poziomu zagrożenia. Pathfinding po siatce plus flow field dla hord.
**Gotowe, gdy:** 200 zombie na ekranie przy 60 fps, a walka ma ryzyko ugryzienia.

### Etap 5 — Postać, umiejętności i cechy
Tworzenie postaci: zawód, cechy pozytywne i negatywne z bilansem punktów. Umiejętności z poziomami 0–10 i XP za akcje (walka, gotowanie, stolarka, pierwsza pomoc, skradanie, bieganie, szukanie). Czytanie książek jako mnożnik XP. Toasty „+3 …” w HUD.
**Gotowe, gdy:** wybór zawodu i cech zmienia rozgrywkę, a umiejętności rosną od używania.

### Etap 6 — Crafting i akcje czasowe
Receptury jako dane (składniki, narzędzia, wymagana umiejętność, czas), okno craftingu, gotowanie, zabarykadowanie okien deskami, rozbiórka mebli na materiały, kolejka akcji z paskiem postępu.
Stacje rzemieślnicze jako dane: warsztat stolarski, stół mechanika, piec (ognisko → piec murowany → piekarnik) i stół elektronika. Każda ma poziomy 1–3; poziom to stawiany przedmiot budowany albo ulepszany recepturą (materiały + umiejętność), a wyższe poziomy odblokowują lepsze receptury. Receptury „combine” to łączenie w ekwipunku (najwyżej 4 części, bez stacji, narzędzia z ekwipunku dozwolone, np. kij + gwoździe ×5 + taśma, młotek = kij z gwoździami). Każda receptura ma jawnie grupę (`category`), narzędzia osobno od składników, wymagane umiejętności, XP, czas w minutach gry oraz stację z minimalnym poziomem, więc okno warsztatu liczy stan z danych (dostępna / brak części / brak umiejętności / za niski poziom stacji). Poziom stacji skraca czas craftingu (1 / 0.8 / 0.65), a składniki bierze się z ekwipunku i schowków w promieniu 3 kafli (`worldSettings.crafting.nearbyRadiusTiles`).
**Gotowe, gdy:** da się zrobić bandaż, ugotować jedzenie i zabić deskami okno.

### Etap 7 — Mapa demo i loot
Małe miasteczko (około 20 budynków, stacja benzynowa, sklep, apteka), loot tables zależne od typu pomieszczenia, drzwi i okna (zamknięte, rozbite), minimapa, licznik dni, cele i zadania („Znajdź benzynę…”), zapis i wczytanie gry lokalnie.
**Gotowe, gdy:** jest 30–60 minut sensownej rozgrywki.

### Etap 8 — Konta, serwer i landing
Landing page (opis gry, screeny, przycisk „Graj”), rejestracja i logowanie (Supabase Auth, email + Google), profil, lista zapisów w chmurze, uruchomienie gry z poziomu strony. API zapisów z walidacją, limitami i RLS.
**Gotowe, gdy:** nowy użytkownik zakłada konto, gra, wychodzi i wraca do zapisu z innego komputera.

### Etap 9 — Grywalne demo (kamień milowy)
Dopracowanie: dźwięki CC0, balans, samouczek, ustawienia (grafika, klawisze, głośność), profilowanie wydajności, raportowanie błędów (Sentry), testy z kilkoma graczami, wdrożenie publiczne.
**Gotowe, gdy:** Paweł i testerzy grają i oceniają kierunek.

### Później (po demo)
Pojazdy i paliwo, farmienie, budowanie i baza, pogoda i pory roku, elektryczność i woda, NPC. Multiplayer (serwer autorytatywny na tym samym `sim`), mody (loader paczek, dokumentacja), aplikacja Android, a na koniec komercjalizacja z kupionymi assetami.

## Zespół
- **Szef sztabu:** plan, kolejność, pilnowanie `TASKS.md`, decyzje z Pawłem.
- **Designer:** styl wizualny, HUD i UI gry, landing, kierunek grafiki low-poly.
- **Modules:** architektura modułów, schematy contentu, design system `packages/ui`.
- **Silnik:** monorepo, CI, klient Three.js, render, HUD, wydajność.
- **Symulacja:** `packages/sim`, cały gameplay.
- **Serwer:** Supabase, API zapisów, wdrożenie, później multiplayer.
