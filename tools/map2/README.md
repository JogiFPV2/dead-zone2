# map2: nowa mapa Stalowej Woli z OSM (`@deadzone/map2`)

Osobny, czysty pipeline. Stary generator (`tools/map`, `?map=osm-stw`) zostaje bez zmian, dopóki
map2 go nie zastąpi. Etapy: **1 drogi** → **3 budynki 1:1** → **4 teren 1:1** (wody, lasy, pola,
zieleń, tory wszystkich rodzajów, drzewa, linie energetyczne) → dalej: lasy i drzewa w średnim i
dalekim LOD, dopasowanie terenu do budynków i dróg.

Zasady, które odróżniają map2 od starego generatora:

- **Bez obrotu i prostowania.** Północ u góry, geometria 1:1 z OSM (stary obraca o 27° i prostuje
  99,7 % budynków do kątów prostych).
- **Jedna projekcja dla całej mapy**: poprzeczny Mercator na elipsoidzie WGS84, skala 1, środek
  `STW_ORIGIN` (KEN × Okulickiego), x na wschód, y na południe, metry (`src/project.ts`).
- **Węzły OSM zachowane**: skrzyżowanie = wspólny węzeł dróg, nie zgadywanie po współrzędnych.
- Zasięg: Stalowa Wola, Rozwadów, Huta, Nisko, dolny San do Wisły (bbox 21,80–22,25 E, 50,47–50,76 N).

## Dane (cache, nie repo; ODbL)

```sh
tools/map2/scripts/fetch.sh                      # Geofabrik podkarpackie → ~/.cache/deadzone-osm
python3 tools/map2/scripts/extract.py ~/.cache/deadzone-osm/podkarpackie-latest.osm.pbf \
  ~/.cache/deadzone-osm/stw-raw2.json            # deadzone-osm-raw-2 (WGS84, id węzłów)
pnpm --filter @deadzone/map2 roads ~/.cache/deadzone-osm/stw-raw2.json ~/.cache/deadzone-osm/stw-roads2.json
pnpm --filter @deadzone/map2 osm ~/.cache/deadzone-osm/stw-roads2.json ~/.cache/deadzone-osm/stw2-osm.json
python3 tools/map2/scripts/extract_buildings.py ~/.cache/deadzone-osm/podkarpackie-latest.osm.pbf \
  ~/.cache/deadzone-osm/stw-bld-raw2.json        # budynki 1:1 (deadzone-osm-bld-raw-2)
pnpm --filter @deadzone/map2 buildings ~/.cache/deadzone-osm/stw-bld-raw2.json ~/.cache/deadzone-osm/stw-bld2.json
pnpm --filter @deadzone/map osm:map2-bld ~/.cache/deadzone-osm/stw2-osm.json \
  ~/.cache/deadzone-osm/stw-bld2.json ~/.cache/deadzone-osm/stw2-bld.json
python3 tools/map2/scripts/extract_land.py ~/.cache/deadzone-osm/podkarpackie-latest.osm.pbf \
  ~/.cache/deadzone-osm/stw-land-raw2.json       # teren 1:1 (deadzone-osm-land-raw-2)
pnpm --filter @deadzone/map2 land ~/.cache/deadzone-osm/stw-land-raw2.json ~/.cache/deadzone-osm/stw-land2.json
pnpm --filter @deadzone/map osm:map2-land ~/.cache/deadzone-osm/stw2-bld.json \
  ~/.cache/deadzone-osm/stw-land2.json ~/.cache/deadzone-osm/stw2-full.json
pnpm --filter @deadzone/map osm:tiles ~/.cache/deadzone-osm/stw2-full.json $PWD/apps/game/public/osm/stw2 --stw2
python3 tools/map2/scripts/overlay.py ~/.cache/deadzone-osm/stw-roads2.json out.jpg 22.0535 50.5825 15
```

`overlay.py` składa trzy panele: referencja (kafelki openstreetmap.org, cache), wynik map2 i
nakładka wyniku na referencję, z podpisanymi głównymi ulicami i dzielnicami.

## Model dróg (`src/profile.ts`, `src/graph.ts`)

- Profil z tagów: klasa (`highway`, `_link` = włączenie), szerokość (`width` → `lanes` × szer.
  pasa klasy → domyślna), pasy, `oneway` (także `-1`, ronda i autostrady), ronda
  (`junction=roundabout|circular`), chodniki (`sidewalk`, `sidewalk:left/right/both`, `separate`
  = brak, bo chodnik jest osobną drogą), warstwa / most / tunel, linie (oś przy drodze
  dwukierunkowej, linie pasów przy > 1 pasie w kierunku).
- Graf: drogi dzielone na odcinki w węzłach wspólnych; typy węzłów: koniec, łuk, T, X,
  włączenie (ramię pod kątem < 35°), rondo, złożone. Na T / X łuki krawężnika o promieniu wg
  największej klasy (12 m główna, 10 zbiorcza, 8 lokalna, 6 osiedlowa, 4 dojazdowa).
- Jezdnie rozdzielone: pary jednokierunkowych odcinków tej samej drogi w przeciwnych kierunkach
  ≤ 40 m od siebie (`dual`).
- Kontrola (`checkNet`): luki (koniec drogi < 3 m od innej, bez połączenia) i nakładania
  (przecięcie na tej samej warstwie bez wspólnego węzła).
- `src/chunks.ts`: indeks odcinków na chunki 32 m (format klienta).

## Klient: `?map=stw2` (`src/to-osm.ts`)

Sieć map2 zapisana w formacie klienta (`deadzone-osm-1`, kafle 1 km `deadzone-osm-tiles-1`,
chunki 32 m z istniejącego generatora, obrót 0°, świat 32 768 m, przesunięcie `STW2_OFFSET`):
jezdnie z szerokością i chodnikiem z tagów (szerszy z dwóch boków), linia osi tylko na drogach
dwukierunkowych (`cl: 0` na jednokierunkowych), linie pasów (`ll`, przesunięcia od osi), łuki
krawężnika jako wachlarz pasków asfaltu od środka węzła do łuku (tylko węzły bez jezdni
jednokierunkowych), przejścia dla pieszych z istniejącego `zebras.ts` (tylko przy węzłach jezdni
pod kątem > 30°: T, X, wloty rond; nie na włączeniach). Kafle są w `apps/game/public/osm/stw2`.

## Teren 1:1 (`src/land.ts`, `tools/map` `src/osm/map2-land.ts`)

`extract_land.py` bierze z OSM wszystko na ziemi poza drogami i budynkami, z każdym wierzchołkiem
i z dziurami multipoligonów (wyspy na stawach, polany w lasach): obszary (`natural`, `landuse`,
`leisure`, `amenity`, `waterway=riverbank`, `man_made`…), żywopłoty, cieki, tory, linie
energetyczne, pojedyncze drzewa, szpalery, zwrotnice / kozły / przejazdy i POI. map2 tylko je
rzutuje (`land`), a klasyfikację robi ten sam `classifyArea` co w starym konwerterze:

- **wody**: jeziora, stawy, zbiorniki i koryto Sanu jako wielokąty 1:1 (`water`), mokradła;
- **cieki**: rzeka / kanał / strumień / rów (`drain` → rów, przepusty pominięte), szerokość z
  `width`, a bez niej San i Wisła 60 m, inne rzeki 15 m, kanał 8, strumień 3, rów 1,5;
- **tory**: główne, bocznice (`service`), tramwaj, nieczynne (`disused`, bez sieci trakcyjnej),
  sieć trakcyjna z `electrified=contact_line`, mosty; zwrotnice i przejazdy tylko na wierzchołku toru;
- **reszta**: lasy, łąki, pola, sady, ogródki, parki, boiska, cmentarze, parkingi, tereny
  mieszkaniowe / przemysłowe / handlowe / wojskowe, żywopłoty jako paski zarośli.

Obszary relacji mają id powyżej id dróg OSM (`1e10 + pierścień · 1e8 + id`), tak jak budynki.

## Migracja klienta (dalej)

Nowy id mapy `?map=stw2` obok `osm-stw`; chunki 32 m z indeksu `chunkIndex`, render wstęg dróg
z profilu (jezdnia, krawężnik z łukami, chodnik, linie), przejścia tylko przy węzłach T / X / rondach.
`LATEST_MAP` przełączamy dopiero po akceptacji Pawła.
