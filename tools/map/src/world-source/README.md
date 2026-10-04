# Źródło świata z planu (`@deadzone/map/world-source`)

Jedno API dla mapy OSM Stalowej Woli i dla plan-4: **plan świata** (`WorldPlanInput`: cechy w
kształcie `deadzone-osm-1`, granice chunków, seed, wersja) → `PlanChunkGenerator` → kolumna chunka
(`GenColumn`: wszystkie kondygnacje, drzewa, metadane budynków). Plan-4 to tylko inny dostawca
planu (`plan4Plan(seed, size)`, generator zamiast pliku), OSM to `osmPlan(plik, { dataHash, region })`.

- Indeks planu (`PlanIndex`, siatka 64 m) powstaje raz; chunki generują się leniwie i
  deterministycznie na żądanie (te same seed + wersja = te same bajty, dowolna kolejność).
- Geometria chunka jest lokalna (kafle 0..31, auta i drzewa we współrzędnych chunka).
- Skala 1:1 (1 kafel = 1 m), bez obrotu: północ w górę.
- Budynki: typy z #113 (tag OSM → landuse → domyślny), piętra z tagu albo z typu, klatki
  schodowe na każdej kondygnacji pod najwyższą, meble przez `furnishView` (reguła #131: meble
  tylko na kaflach pokojów, na zewnątrz tylko kosze, drewno, ławki, kontenery).
- Teren: pokrycie (landuse / natural), woda (`base:water`, w sim floor 0 = nie do przejścia),
  tory, drogi z chodnikami, wiadukty (pokład + balustrady), drzewa OSM + las i parki z siatki.
- Auta (`SimChunk.vehicles`, `base:sedan`): globalna kratka zatok parkingowych i pasów przy
  krawężniku, wolne miejsce 4,6 × 1,8 m, maks. 64 na chunk. `base:fuel-pump` przy `amenity=fuel`.
- `chunkKind` (gęstość zombie w LOD symulacji) z rastra planu w rozdzielczości chunków.
- `places()` — nazwy miejscowości / osiedli (np. `saveSummary.place`, mapa).
- Wersja: `osm-stw-<sha256 pliku, 12 znaków>-<region>-g<GENERATOR_REV>` (plan-4:
  `plan-4-s<seed>-z<size>-g<rev>`); liczba do zapisów: `generatorVersionNumber`. **Każda zmiana wyniku
  generatora = podbicie `GENERATOR_REV`** (stare zapisy odmówią wczytania, jak powinny).

## W grze (`apps/game/src/world/gen/`)

- `maps.ts`: rejestr nazw map dla `?map=` i `LATEST_MAP` (`osm-stw`, `plan-4`).
- `chunk-worker.ts` + `GeneratedWorldSource`: `WorldChunkSource` (docs/streaming.md) z generacją
  w workerze; `StreamedTown` / `StreamedOpenings`: zestaw miasta i drzwi per chunk w pierścieniu near.
- `sim-world-worker.ts` + `generatorWorldSource`: `WorldSource` symulacji na tym samym planie
  (LOD sim: zombie także na piętrach, łupy według typu pokoju, skrzynki, auta).

## Dane OSM

Plik danych jest osobny (ODbL), np. `apps/game/public/osm/stw-okulickiego.deadzone-osm-1.json`
(`pnpm --filter @deadzone/map osm:crop <stw-map.json> okulickiego <plik>`). Gra pokazuje podpis
„© współtwórcy OpenStreetMap”. `?osmUrl=<url>` wskazuje inny plik (np. cały kwadrat 16 km).
