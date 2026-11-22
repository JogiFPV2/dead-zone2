# Dane OpenStreetMap (Stalowa Wola)

`stw-okulickiego.deadzone-osm-1.json`: wycinek wokół ul. Okulickiego z mapy OSM Stalowej Woli
w formacie `deadzone-osm-1`, w surowym układzie OSM: obejmuje okno gry 1,5 × 1,5 km obrócone o
27° (generator obraca dane na siatkę ulic) plus margines 128 m
(`pnpm --filter @deadzone/map osm:crop <stw-map.json> okulickiego <plik>`).

© współtwórcy OpenStreetMap. Dane są dostępne na licencji Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/ , https://www.openstreetmap.org/copyright

Plik danych jest osobnym utworem bazodanowym na ODbL; kod gry ma własną licencję. Gra pokazuje
podpis „© współtwórcy OpenStreetMap” na mapach wygenerowanych z tych danych.

`stw-16km/`: cały kwadrat 16 × 16 km (`?map=osm-stw`) w kafelkach 1 × 1 km świata gry
(`manifest.json` + `t-<x>-<y>.json`, format `deadzone-osm-tiles-1`,
`pnpm --filter @deadzone/map osm:tiles <stw-map.json> <katalog>`). Gra ładuje na starcie tylko
kafelki wokół gracza, resztę w miarę potrzeby; każdy kafelek ma sumę SHA-256 w manifeście, a
wersja świata to skrót wszystkich kafelków. Każdy kafelek niesie te same pola atrybucji i licencji.

`stw2/`: nowa mapa z `tools/map2` (`?map=stw2`, Paweł 01.11): kwadrat 32,8 × 32,8 km (Stalowa
Wola, Rozwadów, Huta, Nisko, San do Wisły), północ u góry, bez obrotu i prostowania. Drogi
(szerokości, pasy, chodniki z tagów, łuki krawężnika), budynki (obrysy bez prostowania,
dziedzińce, ściany wspólne, piętra z tagów) i teren 1:1 z OSM: wody (San, stawy, jeziora,
zbiorniki), cieki, lasy, pola, zieleń, tory wszystkich rodzajów, drzewa, linie energetyczne. Kafle `t-<x>-<y>.json.gz`
(gzip w repo, ~12,6 MB; sha256/bytes w manifeście liczone z JSON-a, klient rozpakowuje).
Odtworzenie: `tools/map2/README.md` (roads → `pnpm --filter @deadzone/map2 osm`, budynki →
`pnpm --filter @deadzone/map2 buildings` → `pnpm --filter @deadzone/map osm:map2-bld <drogi>
<budynki> <wyjście>`, teren → `pnpm --filter @deadzone/map2 land` → `pnpm --filter @deadzone/map
osm:map2-land <drogi+budynki> <teren> <wyjście>`) → `pnpm --filter @deadzone/map osm:tiles <plik>
apps/game/public/osm/stw2 --stw2`. Kafle zbudowane z wyciągu Geofabrik z 19.11.2026.
