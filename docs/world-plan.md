# Plan świata (Silnik 2, generator — krok 1)

`tools/map/src/world/plan.ts`: `planWorld({ seed, size })` liczy z seeda makroplan całej mapy jako dane wektorowe. Nic z tego jeszcze nie trafia do gry: to podgląd do akceptacji, zanim wypełnianie chunków (`WorldChunkSource`, `docs/streaming.md`) zacznie z niego czytać.

- **Rozmiar jest parametrem:** domyślnie 16 384 m (512 × 512 chunków), `FALLBACK_WORLD_SIZE` = 8192 m, gdy zapis Symulacji nie zmieści dużego świata. Liczba osad skaluje się z powierzchnią.
- **Czysta funkcja** `(seed, size, WORLD_PLAN_VERSION)`; test sprawdza determinizm.
- **Zawartość:**
  - rzeka i jeziora;
  - miasta (2 na 16 km), miasteczka (5) i wsie (40): wsie są ulicówkami z działkami wzdłuż dróg, z kościołem, sklepem i remizą;
  - hierarchia dróg: ekspresówka W→E z obwodnicami i zjazdami, wojewódzkie (MST + graf Gabriela między miastami), lokalne, ulice, drogi polne i leśne, ścieżki, kolej ze stacjami;
  - kwartały miejskie: kamienice, bloki, domy, biurowce, sklepy, przemysł;
  - kompleksy: szpital i dwie komendy policji w mieście, ośrodek zdrowia i policja w miasteczku, baza wojskowa w lesie z ogrodzeniem, bramą, koszarami, hangarami i placem apelowym;
  - stacje paliw, przydrożne bary, warsztaty i magazyny;
  - zagrody co 190–450 m, przysiółki i kolonie na pustych polach, polany, ambony, leśniczówki.
- **Gęstość (test):** < 15 % komórek 512 m bez budynku ani drogi, a 95 % punktów leży ≤ 700 m od drogi lub ścieżki. Las zajmuje 20–45 % (dziś ~32 %).
- **Podgląd:** `pnpm --filter @deadzone/map exec tsx src/world-preview.ts [seed] [size] [outDir] [prefix]` zapisuje PNG z góry: przegląd, miasto, centrum z siatką chunków, miasteczko, wieś z polami, bazę wojskową, plus statystyki JSON.
- **Kolejny krok** (po akceptacji): wypełnianie chunka z planu. Geometria i instancje są względne do origin chunka (cx·32, cy·32), bo Silnik przesuwa origin co 1 km. `getSummary` czyta z samego planu, a wersja generatora trafia do zapisu.
