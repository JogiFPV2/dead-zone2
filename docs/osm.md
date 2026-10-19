# Mapa z OpenStreetMap (Stalowa Wola)

Dane: © współtwórcy OpenStreetMap, licencja ODbL 1.0. Każda mapa zbudowana z tych danych jest
bazą pochodną: gra pokazuje „© współtwórcy OpenStreetMap” (na ekranie gry na mapach OSM, w tle
menu ze sceną OSM i w „Autorach”), a dane razem ze skryptem eksportu udostępniamy osobno na ODbL
(repozytorium publiczne do założenia po akceptacji Pawła).

## Układ współrzędnych

UTM 34N (EPSG:32634), lokalne metry kwadratu 16 384 × 16 384 m: x = E − E0 (wschód),
y = N1 − N (południe), (0, 0) = róg północno-zachodni, 1 m = 1 kafel. Kwadrat Stalowej Woli:
E0 = 568 300, N0 = 5 595 000, N1 = N0 + 16 384 (miasto, HSW, San, Rozwadów, Charzewice, Pysznica).

## Potok

1. `extract_osm.py <podkarpackie.osm.pbf> stw-raw.json [E0 N0 SIZE]` (Python, osmium + pyproj):
   wycina kwadrat z wyciągu Geofabrik, oznaczone węzły, linie i multipoligony w lokalnych metrach.
2. `pnpm --filter @deadzone/map osm:convert stw-raw.json stw-map.json` (`tools/map/src/osm/convert.ts`):
   format `deadzone-osm-1` — drogi (rodzaj, szerokość, chodniki, mosty), tory, cieki, obszary
   (las, park, woda, zabudowa…), budynki z naszym typem i liczbą pięter (z tagu albo domyślne),
   drzewa, POI, nazwy miejscowości. Obok `stw-map.stats.json` (rozkłady typów i pięter).
3. `pnpm --filter @deadzone/map osm:scene stw-map.json` (`tools/map/src/osm/scene.ts`, wycinki w
   `scenes.ts`): wycinek jako mapa contentu `base:<id>` + plik sceny gry.
4. Podgląd planu: `pnpm --filter @deadzone/map osm:plan-png <id> out.png [z] [skala]`.

### Typy budynków

Tagi OSM (`building`, `amenity`, `shop`, `office`, `healthcare`, `craft`, `leisure`, `man_made`)
plus POI w obrysie i obszary amenity (teren szkoły, szpitala, stacji) → rodzaj → jeden z 12 typów
katalogu. Gdy `building=yes` bez innych tagów: landuse wokół (osiedle, przemysł, handel, rola) i
wielkość obrysu, a bez landuse sama wielkość (źródło typu: `tag` / `landuse` / `default`).
Rodzaje bez własnego typu katalogu (do uzupełnienia przez Designera): blok → `kostka`, kościół →
`gym` (jedna wysoka kondygnacja), hala przemysłowa → `shack` (program: magazyn), dworzec →
`grocery`, biurowiec / urząd → `school` (program: biura), garaże → `shack`, straż → `police`.

### Piętra

`building:levels` (lub `height` / 3 m), a bez tagu domyślnie wg rodzaju: blok 4–11 (długie
lamele 4–5, punktowce 10–11), dom 1–2, szpital 3–5, kościół 1 wysoka, szkoła 2–3, biurowiec 2–4.
Maks. 16 kondygnacji (z ≤ 15).

### Wnętrza (`interior.ts`)

Dla dowolnego wielokąta (maska kafli): klatka schodowa U (3 kafle szerokości, biegi na przemian w
dwóch kolumnach, trzecia to przejście — jak schody `u` katalogu) albo pojedynczy bieg w małym
dwukondygnacyjnym domu, w tym samym miejscu na każdym piętrze; korytarz 2 kafle wzdłuż dłuższej
osi w szerokich budynkach publicznych i blokach; pokoje cięte pasami × odcinkami wg rodzaju;
drzwi wewnętrzne po drzewie rozpinającym graf pokoi (nigdy obok biegu), wejście na parterze od
strony najbliższej drogi, okna na ścianach zewnętrznych. Typy pokoi wg rodzaju (mieszkania,
sklep + zaplecze, sale szkolne, biura, sale szpitalne…), meble i łupy wg typu pokoju
(`furnish`, loot tables), korytarze i klatki: `base:room-hall` (tabela `base:hall`). Test
`osm.test.ts`: z każdego kafla każdego piętra każdego budynku da się dojść do wyjścia.

## Ściany skośnych budynków: `wallSegments` (ocena + format dla Symulacji)

Ocena: obrys OSM obrócony względem siatki rasteryzowany do krawędzi kafli daje „ząbki”
(1267 z 23670 budynków poza siatką po wyrównaniu obróconych/dopasowanych). Wariant minimalny
rozszerzony o pole dla sima (wdrożony, `GENERATOR_REV` 5):

- **Render**: ściany zewnętrzne takich budynków rysowane wektorowo z obrysu
  (`apps/game/src/world/town/vector-walls.ts`); rastrowe zewnętrzne ściany-pełne tych budynków
  nie są rysowane, drzwi/okna zostają na krawędziach kafli i widać je w przerwach obrysu.
  Słupki w narożnikach („rogatki”) to dekoracja, **bez kolizji**. Dachy zostają rastrowe.
- **Raster (kafle, `SimChunk` jak dotąd)**: konserwatywny — kafel należy do budynku tylko wtedy,
  gdy jego środek jest w obrysie i żadna krawędź obrysu go nie przecina (`fillRingsInner`).
  Schodek jest więc zawsze po wewnętrznej stronie linii: kolizja na krawędziach kafli nigdy nie
  wystaje poza ścianę wektorową (szczelina między nimi to przestrzeń „w ścianie”).
- **`SimChunk.wallSegments?: readonly SimWallSegment[]`** (`packages/protocol/src/map.ts`),
  obecne tylko w chunkach/poziomach ze skośnymi budynkami:
  - `{ x0, y0, x1, y1, z, building? }`;
  - `x/y` w **metrach świata, absolutnie** (1 kafel = 1 m, ta sama oś co `tx/ty`), nie lokalnie
    względem chunka;
  - `z` = poziom chunka (kondygnacja), taki sam jak `SimChunk.z`;
  - odcinki są **przycięte do prostokąta chunka** (Liang–Barsky); odcinek leżący dokładnie na
    granicy może wystąpić w obu chunkach — deduplikacja niepotrzebna dla kolizji/LOS;
  - **otwory już wycięte**: przy zewnętrznych drzwiach i oknach danego poziomu jest przerwa
    ~1,2 m (przejście/okno sim nadal bierze z krawędzi kafli: drzwi/okna mają tam swoje typy);
  - `building` = `BuildingId` budynku (ten sam co w kaflach), do pokojów/dźwięku;
  - grubość ściany nie jest zapisana: render używa 0,15 m, sim traktuje odcinek jako linię
    (albo kapsułę o promieniu gracza).
- Sim: dokładna kolizja i LOS na odcinkach (obok krawędzi kafli), dźwięk i pokoje mogą zostać
  na kaflach. Do zrobienia po stronie Symulacji — klient i generator już to emitują.

## Scena `osm-okulickiego` (tło menu)

320 × 320 m wokół wiaduktu ul. KEN nad torami przy ul. Okulickiego (środek wycinka UTM
574 590 E / 5 602 864 N), obrócone o 61°, żeby tory biegły wschód–zachód, a wiadukt
północ–południe. Wiadukt leży na poziomie 0 (jezdnia nad torami, barierki `base:railing`
na krawędziach pomostu nad torami) — silnik nie ma jeszcze nasypów ani pomostów na wysokości.

- W grze: `?map=osm-okulickiego` (`?zombies=0` bez zombie). Start w strefie `start` mapy.
- Tło menu: `?menu=1&menuScene=osm-okulickiego` (`menu/menu-scene.ts`; ognisko = wiadukt).
- Pliki: mapa `packages/content/data/base/maps/osm-okulickiego/` (manifest + chunki, ładowana jak
  każda mapa paczki `base` przez `loadBaseMap('osm-okulickiego')`), scena
  `apps/game/src/world/osm/scenes/osm-okulickiego.json`.
- API (`apps/game/src/world/osm/scenes.ts`): `osmScene(id)` → `{ map, focus, player, zombies,
  vehicles, trees, cut, attribution }`; `withSceneVehicles(source, scene)` dokłada auta do
  `ChunkData.vehicles` (sim: `SimChunk.vehicles`, max 64 na chunk, `base:sedan`),
  `sceneZombies(scene)` → `SimZombieSpawn[]` (opcja `zombies` w `startSimWorker`),
  `scene.trees` → `townDecor(…, trees)` zamiast losowych drzew, `OSM_ATTRIBUTION`.
