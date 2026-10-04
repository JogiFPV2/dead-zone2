# Strumieniowanie chunków w kliencie (`apps/game/src/world/streaming`)

Świat docelowo ma ok. 8 × 8 km (250 × 250 chunków). Klient trzyma w pamięci i na GPU tylko otoczenie gracza: pierścienie chunków wokół gracza i celu kamery, z trzema poziomami szczegółów (LOD). Ten dokument jest kontraktem dla **Silnika 2** (generator świata) i **Symulacji** (daleka, zgrubna symulacja).

## Siatka: jedna dla generatora, sim i renderu
- Chunk ma **32 × 32 kafle** (`CHUNK_SIZE` z `@deadzone/protocol`, ten sam co `SimChunk`). Klient rzuca błąd przy innym `chunkSize`.
- Adres to `(cx, cy)`, a piętra to `z` (0 = parter). Kafel `(tx, ty)` należy do chunka `(floor(tx / 32), floor(ty / 32))`. 1 kafel = 1 m, a świat three.js to X = tx, Z = ty, Y = z × 3 m.
- Warstwy jednego piętra (`ChunkData` w `world/chunk.ts`) mają kształt `SimChunk`: `floor`, `edgeN`/`edgeW`, `roof`, `room` + `rooms`, `objects`, `stairs` (`SimStairs`, schody z `z` na `z + 1`). Każda warstwa to `Uint16Array(1024)`, indeks `y * 32 + x`.

## Interfejs źródła: `WorldChunkSource` (`streaming/source.ts`)
```ts
interface WorldChunkSource {
  id: string;            // 'content:test-town', 'gen:deadzone', 'stress'
  version: string;       // wersja generatora / formatu: seed + version = świat
  seed: number;
  chunkSize: number;     // musi być 32
  bounds: { cx0; cy0; cx1; cy1 };      // włącznie
  levels: { min; max };                // zakres pięter
  tilePalette: (ContentId | null)[];   // TileId → content id (floor, roof), 0 = puste
  edgePalette?: (EdgeDef | null)[];    // id krawędzi → { id, kind: wall|window|door }
  getChunk(cx, cy, signal?): Promise<WorldChunk | undefined>;
  getSummary?(cx, cy): ChunkSummary | undefined;   // opcjonalnie: tani far-LOD z makroplanu
}
interface WorldChunk {
  cx; cy;
  levels: Map<z, ChunkData>;           // poziom 0 musi istnieć
  decor?: DecorInstance[];             // tylko klient: rośliny i drobne propsy, sim je ignoruje
  buildings?: BuildingMeta[];          // metadane renderu budynków na tym chunku
}
interface DecorInstance { kind: ContentId; x; y /* lokalne kafle, float */; z; rot /* rad */; scale }
interface BuildingMeta  { id /* globalny buildingId */; x0; y0; x1; y1 /* globalne kafle */; floors; block? }
interface ChunkSummary  { cx; cy; ground: Uint16Array(64) /* dominujący TileId 8×8 */; height: Uint8Array(64) /* piętra */ }
```

### Wymagania dla generatora (Silnik 2)
1. **Czysta funkcja.** `getChunk(cx, cy)` zależy tylko od `(seed, version, cx, cy)`: bez globalnego stanu i bez zależności od kolejności wywołań. Streamer woła ją równolegle (domyślnie do 4 naraz), przerywa przez `signal` i po wyładowaniu woła ponownie dla tego samego chunka. Wynik musi być identyczny, bo nic nie jest cache'owane między wyładowaniem a powrotem.
2. **Makroplan raz, wypełnianie leniwie.** Plan całego świata (miasta, drogi, rzeka, lasy) liczy się z seeda raz i trzyma w cache (tanio, w pamięci). `getChunk` wypełnia chunk z planu i z bloków. `getSummary` (zalecane) odpowiada z samego planu, bez wypełniania. Wtedy dalekiego pierścienia w ogóle nie trzeba generować (w świecie stress far = 144 chunki bez `getChunk`).
3. **Zwrócone dane są niemutowalne** (klient współdzieli tablice między warstwami).
4. **Palety są globalne i stałe** przez cały czas życia źródła. Nowy content oznacza nową wersję.
5. **`buildingId` jest globalny** (zwykła liczba, nie Uint16). **`roomId` w warstwie `room`** (Uint16) wystarczy unikalny w obrębie chunka, a ten sam pokój na sąsiednich chunkach może mieć różne id, jeśli `rooms[id].buildingId` się zgadza. Na 8 × 8 km globalnie unikalnych Uint16 nie starczy. **Uzgodnione z Symulacją (sim-architecture.md 9.24):** w sim `roomId` jest lokalny w chunku, a `SimChunk.roomBuildings` mapuje go na globalny `buildingId` (adapter `chunkSourceToSimMap` przepisuje `RoomInfo.buildingId`).
6. **Krawędź na granicy chunka** należy do chunka po południowej lub wschodniej stronie linii (`edgeN` kafla y = 0 to granica z chunkiem wyżej). Render near-LOD czeka, aż wczyta się sąsiad N i W, żeby poprawnie przypisać krawędź do budynku (cutaway).
7. **Dach i piętra:** `roof` na najwyższym piętrze budynku, `BuildingMeta.floors` = liczba pięter. Renderer ukrywa dach i ściany budynku, w którym stoi gracz (cutaway po `buildingId`). Wyższe piętra są w `levels`.
8. **Dekoracje** (`decor`) to tylko render: drzewa, krzaki, kamienie. Rodzaj to content id. Dziś klient rysuje zastępcze kształty po wzorcu nazwy (`tree|pine|oak`, `rock|stone`, reszta jako krzak). Modele dojdą jako mapowanie `kind → model` z tym samym instancingiem (1 InstancedMesh na rodzaj na chunk, geometria i materiał współdzielone).

### Adapter obecnej mapy
`chunkSourceToWorld(source, range, id)` opakowuje dzisiejszy synchroniczny `ChunkSource` (mapy contentu `test-town` i `demo-house`, mapa testowa) jako `WorldChunkSource` z jednym piętrem. Sim dalej dostaje całą mapę przez `chunkSourceToSimMap` (bez zmian).

## Pierścienie, LOD i budżety (`streaming/rings.ts`)
Odległość to odległość Czebyszewa w chunkach do najbliższego środka. Środki to gracz i cel kamery (różnią się, gdy kamera dogania gracza).

| LOD | Zawartość | Koszt |
|---|---|---|
| near | pełne warstwy gry: teren (InstancedMesh na typ kafla), ściany i dachy z cutaway, obiekty mapy (meble, schowki), dekoracje z instancingiem | jak przed streamingiem |
| mid | 1 scalony mesh na chunk (kolory wierzchołków, wspólny materiał): podłogi łączone w przebiegi, ściany i okna, dachy; bez drzwi, obiektów i dekoracji; bez rzucania cieni | 1 draw call na chunk |
| far | 1 mesh: siatka 8 × 8 dominujących podłóg + bloki zabudowy z `ChunkSummary` | ~100–300 trójkątów, 1 draw call |

Presety (ustawienie `graphics.viewDistance`, nadpisanie przez `?view=low|medium|high`, bez wiersza w UI):

| preset | promienie near/mid/far | limity chunków near/mid/far | budżet budowania | równoległe pobrania | GPU (geometria streamu) |
|---|---|---|---|---|---|
| low | 2 / 3 / 5 | 36 / 49 / 120 | 3 ms/klatkę | 2 | 48 MB |
| **medium** (domyślny) | 2 / 4 / 7 | 36 / 100 / 240 | 4 ms/klatkę | 4 | 96 MB |
| high | 3 / 5 / 9 | 64 / 140 / 400 | 5 ms/klatkę | 6 | 160 MB |

- **Histereza 1 chunk:** ulepszenie LOD następuje od razu na promieniu, a pogorszenie lub wyładowanie dopiero chunk dalej. Chodzenie w tę i z powrotem po granicy niczego nie przebudowuje (test).
- **Kolejka priorytetowa:** pobrania i budowy idą według odległości, potem LOD. Nowy LOD powstaje przed usunięciem starego, więc nie ma dziur.
- **Budżet czasu:** budowy w klatce trwają do `buildBudgetMs` (zawsze co najmniej jedna). Wyjątek to 3 × 3 chunki wokół środka, które budują się od razu (start, teleport).
- **Limity:** nadmiar ponad limit pierścienia spada do grubszego LOD. Powyżej budżetu GPU budują się już tylko chunki near.
- **Zwalnianie:** wyładowanie zwalnia bufory instancji i geometrie chunka, a dane chunka wypadają z pamięci. Współdzielone geometrie i materiały (kafel, box ściany, kształty dekoracji, materiał LOD, boxy mebli według rozmiaru) zostają. Tekstury pochodzą z ModelKit / KTX2 (wspólny loader i `RefCache`); streaming nie tworzy własnych tekstur.

Przy domyślnym zoomie izometria pokazuje ok. ±1,5 chunka wokół celu (±2 przy maksymalnym oddaleniu), więc **near pokrywa cały ekran**. Mid i far to zapas na oddalenie i prefetch. Wygląd tego, co widać, się nie zmienia.

## Narzędzia
- `?perf=1` (każdy build): nakładka z fps, czasem klatki (średnia i max), CPU klatki, czasem budowania, chunkami per pierścień (zbudowane / limit), kolejką, pobraniami, draw callami, trójkątami, geometriami, teksturami i programami, szacunkiem GPU streamu i stertą JS. Ostatni odczyt trafia do `window.__dzPerf`.
- `?stress=1[&latency=N]`: proceduralny świat 8 × 8 km (`StressWorldSource`: makroplan z miastami, siecią autostrad i lasami, deterministyczne wypełnienie, dwupiętrowe domy ze schodami, dekoracje, `getSummary`), mock sim bez kolizji. Hooki: `__dzStream.walk(dx, dy)`, `__dzStream.teleport(x, y)`, `__dzStream.stats()`.
- Testy: `rings.test.ts` (histereza, priorytety, granice, limity), `streamer.test.ts` (ładowanie, brak przebudów przy chodzeniu w tę i z powrotem, 200 chunków marszu bez wzrostu pamięci, teleport, porzucanie spóźnionych pobrań, budżet czasu, far z samego podsumowania, budżet GPU), `world-renderer.test.ts` (każda geometria per chunk zwolniona, scena pusta po `dispose`), `stress-source.test.ts` (determinizm), `streaming.perf.test.ts` (koszt budowy).

## Dla Symulacji
- **Obszar zainteresowania (sim-architecture.md 9.24):** komenda `setInterest {cx, cy, radiusChunks}` (`client.setInterest`) — sim liczy szczegółowo chunki w promieniu wokół (cx, cy) oprócz okna wokół gracza (zawsze aktywnego). Proponowane: pierścień near + 1 wokół celu kamery, wysyłany przy zmianie chunka celu; 0 usuwa. Sim dalej dostaje mapę jako leniwą `SimMap` (`simMapFromWorldSource`) i woła ten sam generator przez `WorldSource`.
- **`chunkChanged {cx, cy, z, reason: 'opening' | 'object' | 'loot'}`** przychodzi na końcu ticka, w którym stan chunka zmienił się widocznie; klient woła wtedy `streamer.invalidate(cx, cy)`. Chunki wczytane i zwolnione przez LOD sim nie zgłasza.

## Znane ograniczenia (następne kroki)
- **Town kit (#78, Silnik 2)** — `TownTerrain` / `TownStructures` układają całą mapę naraz (layout, skórki, dachy spadziste przez granice chunków), więc na mapach contentu z kitem streaming obsługuje tylko obiekty mapy (cała mapa w near, jak przed streamingiem), a świat stress używa szarych warstw per chunk. Do zrobienia z Silnikiem 2: `loadChunk/unloadChunk` w kicie (layout z `BuildingMeta` generatora zamiast z całej mapy) + jego mid-LOD — wtedy warstwa podpina się jako `NearLayer` (`world-renderer.ts`).
- `OpeningsView` (drzwi, szyby okien i płoty ze stanem z sim, #74), `ShelfFill` (propsy na półkach), minimapa i miejsca do spania i TV czytają dziś całą mapę contentu synchronicznie. Przy mapie generatora trzeba je przepiąć na per-chunk (`streamer.loaded` / zdarzenia near). W trybie stress widzą pustą mapę.
- Obiekty mapy (meble) z modelem są instancjonowane: jeden `InstancedMesh` na część modelu (geometria + materiał) dla wszystkich wczytanych chunków (`world/furniture-instances.ts`; per chunk dawało za mało, bo w chunku jest po kilka mebli), przebudowa raz na klatkę po wczytaniu lub zwolnieniu chunka. X-ray podmienia instancje jednego mebla na osobny klon. Gęste miasto stress (teleport 4000, 4000): 250 → AFTER draw calli z cieniami. Szare boxy bez modelu zostają osobnymi meshami (kolor „przeszukane”).
- Mid-LOD buduje się ok. 3 ms na chunk (Node). Gdyby to był problem, można to przenieść do workera (geometria jako transferable).
- Dekoracje są tylko w near (mid nie pokazuje drzew). Przy większym oddaleniu kamery warto dodać drzewa jako impostory w mid.
