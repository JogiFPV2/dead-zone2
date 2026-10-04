# Nazwy miejsc

`stalowa-wola.json`: dzielnice i miejscowości w kwadracie 16 × 16 km mapy OSM Stalowej Woli
(`place` = town, suburb, quarter, neighbourhood, village, hamlet) jako `{ name, x, y }` we
współrzędnych gry (kafle = metry; x na wschód od zachodniej krawędzi kwadratu, y na południe od
północnej, ten sam układ co plan świata OSM i mapa `osm-stw`). Do `saveSummary.place`.

Generowane: `pnpm --filter @deadzone/map osm:places <stw-map.json> packages/content/places/stalowa-wola.json`.

© współtwórcy OpenStreetMap, dane na licencji ODbL 1.0 (https://www.openstreetmap.org/copyright).
