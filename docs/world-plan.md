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
- **Mapa v3 (`plan-3`):**
  - **Teren i rzeka:** `terrain.ts` daje wysokość (`baseHeight`). Rzeka Sołwia płynie z północy w dół zbocza do ujścia na E lub S i meandruje. Test sprawdza, że rzeka opada, w > 60 % biegnie doliną i ma krętość > 1,12.
  - **Mosty i bulwary:** na każdym skrzyżowaniu drogi lub kolei z rzeką stoi most (`plan.bridges`). W mieście rzekę przekraczają tylko główne osie siatki (co 4. linia, 336–384 m), w miarę prostopadle do nurtu (|sin| ≥ 0,5) i bez jazdy brzegiem w wodzie. Wzdłuż obu brzegów biegną bulwary, a każda ulica, która doszłaby do brzegu, dochodzi do bulwaru albo do najbliższej ulicy; odcinki, których nie da się połączyć, są skracane do ostatniego skrzyżowania, więc żadna nie kończy się ślepo nad wodą (test). Drogi polne i ścieżki nie przecinają rzeki ani jezior.
  - **Jeziora:** leżą w nieckach terenu, przy lasach albo wsiach. Dwa duże, Jezioro Czarne i Jezioro Białe, mają ośrodki wypoczynkowe: plażę, domki, bar, parking i dojazd.
  - **Nazwy:** miast, miasteczek, wsi, jezior i kompleksów. Główne miasto to Wolnogród nad rzeką, start w Lipowcu (`plan.start`). Kompleksy: Szpital powiatowy, Komenda Powiatowa Policji, JW 2417 w lasach na północy, PGR Borki.
  - **Las:** gęstszy na północy.
  - **Gradient zabudowy:** stare miasto, potem kwartały kamienic, bloki, domy, ogródki działkowe przy wylotówkach, na końcu pola. Test sprawdza, że gęstość zabudowy maleje w pasmach odległości od centrum.
  - **Wieś bez pustkowi:**
    - Przy drogach powiatowych (`local`, ~75 % odcinków), części polnych i głównych rosną aleje drzew.
    - Na polach są zagajniki i kępy śródpolne (`copse`), miedze z krzakami wzdłuż kierunku zagonów i rozrzucone zagrody z dojazdem do drogi.
    - Najpierw rozsiew po całych polach, potem dopełnienie: każdy otwarty kwadrat pól bez drzew i budynków większy niż 350 m dostaje coś na sobie (`openland.ts`, siatka 50 m).
    - Test: żaden otwarty obszar nie przekracza 600 × 600 m, a żadne drzewo ani krzak nie stoi na drodze.
    - Drzewa i krzaki są w `plan.treeLines`, po jednym punkcie na sztukę.
  - **Wsie:** ulicówki wzdłuż dróg. Test wymaga, by > 85 % domów stało ≤ 30 m od drogi.
  - **Pierzeje:** `frontage()` kładzie działki osobno na każdym prostym odcinku ulicy. Szerokości sumują się dokładnie do długości odcinka, więc kamienice stoją ściana w ścianę, bez dziur i bez nakładania się (test). Na zakręcie przycina się tylko wewnętrzną stronę. Tam, gdzie działkę przecina przecznica, stają węższe kamienice narożne z obu stron, aż do jej chodnika; test wymaga, by linia zabudowy wzdłuż promienistych ulic i obwodnicy starego miasta była zabudowana w > 70 %. Obwód kwartału jest wypełniony tak samo.
- **Podgląd:** `pnpm --filter @deadzone/map exec tsx src/world-preview.ts [seed] [size] [outDir] [prefix]` zapisuje PNG z góry: przegląd, miasto, centrum z siatką chunków, miasteczko, wieś z polami, bazę wojskową, widoki v3 (`v3-overview`, `v3-suburbs`, `v3-river`, `v3-village`, `v3-pierzeje`, `v3-borowiec`) z plikami `.labels.json` (nazwy i pozycje w pikselach, do opisania obrazka), plus statystyki JSON.
- **Kolejny krok** (po akceptacji): wypełnianie chunka z planu. Geometria i instancje są względne do origin chunka (cx·32, cy·32), bo Silnik przesuwa origin co 1 km. `getSummary` czyta z samego planu, a wersja generatora trafia do zapisu.
