# map2: nowa mapa Stalowej Woli z OSM (`@deadzone/map2`)

Osobny, czysty pipeline. Stary generator (`tools/map`, `?map=osm-stw`) zostaje bez zmian, dopóki
map2 go nie zastąpi. Etapy: **1 drogi** (ten pakiet teraz) → 2 tory → 3 budynki 1:1 → 4 lasy i drzewa.

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

## Migracja klienta (następne PR-y)

Nowy id mapy `?map=stw2` obok `osm-stw`; chunki 32 m z indeksu `chunkIndex`, render wstęg dróg
z profilu (jezdnia, krawężnik z łukami, chodnik, linie), przejścia tylko przy węzłach T / X / rondach.
`LATEST_MAP` przełączamy dopiero po akceptacji Pawła.
