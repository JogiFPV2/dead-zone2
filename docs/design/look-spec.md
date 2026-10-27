# Deadzone · Stalowa Wola: wygląd budynków, audyt i specyfikacja (Designer, 27.10.2026)

Pliki: `look-palette.png` (makieta), `look-palette.json` (paleta maszynowa), źródło makiety `/workspace/dz-html/look/mock.html` + `shoot.mjs`.
Stan kodu: origin/main 40b8d39b (worktree /workspace/dz-look). Dane OSM: Geofabrik podkarpackie-261003.osm.pbf, kwadrat 16×16 km gry (bbox 21.963–22.198 E, 50.503–50.648 N).

## A. Audyt

### Jak dziś budynki dostają wygląd
- Konwerter OSM (`tools/map/src/osm/convert.ts`) zapisuje tylko `type/kind/typeFrom/levels/levelsFrom/rings/name/tall`. **building:colour, roof:colour, roof:shape, building:material, height, roof:levels są odrzucane** (brak w `tools/map/src/osm/types.ts`).
- Kind → blueprint z katalogu (`tools/map/src/catalog.ts`, ok. 10 wpisów: ściany brick/shop/siding-green/siding-blue/plaster, dachy felt/flat/tile/gable/shingles/corrugated).
- Klient: skin ściany z treści krawędzi (`apps/game/src/world/town/modules.ts:55 skinOfWall`), 15 skinów (`modules.ts:23`), kolory to komórki atlasu-palety 16×16 (`skins.ts`, EXT_CELLS od indeksu 192). Kształt dachu z treści (`modules.ts:158 roofStyle`: flat/hip/gable), kolor dachu: `roof-tile`, `corrugated` albo `building % 4` z 4 kolorów (`modules.ts:166`). Bloki mają osobną elewację (`blok-facade.ts`, 6 kolorów balkonów, 3 akcenty).
- Efekt: wszystkie domy (21 133) losują się w praktyce z 3 sidingów + 4 dachów, wszystkie sklepy mają ten sam `shop-wall #6d7268`; brak tynków jasnych, żółtych, pasteli bloków. Paleta jest ciemna (L≈30–45%), stąd „szaro i jednakowo”.

### Tagi w danych (16 km, 30 145 budynków w surowym OSM; 31 182 obiekty po konwersji, część pocięta na kafelki)
| tag | budynków |
|---|---|
| building=yes | 19 505 (65%) |
| residential 4 330, house 2 050, outbuilding 1 709, detached 1 120, commercial 122, garages 116, industrial 104, retail 99, apartments 83, school 40, office 36, warehouse 34 | |
| building:levels | 4 346 (14%) |
| roof:shape | 84 (gabled 44, flat 21, hipped 14, inne 5) |
| roof:levels | 59 |
| height | 8 |
| building:colour / roof:colour / building:material / roof:material | **0 / 0 / 0 / 0** |
| amenity na budynku | 120, shop na budynku 46, name 254 |
| Po konwersji: kind | house 21 133, shed 4 448, garage 2 691, industrial 805, office 648, block 549, shop 401, ruin 243, school 108, church 38, hospital 35 |
| typeFrom | landuse 16 964 (54%, zgadywane z landuse), tag 11 426, default 2 792; levelsFrom default 26 739 (86%) |

Wniosek: kolor z OSM nic nie da (0 budynków), więc różnorodność musi pochodzić z palety + seedu. Kształt dachu z OSM tylko dla 84 obiektów.

### Infrastruktura
| obiekt | OSM (16 km) | w grze |
|---|---|---|
| highway=street_lamp (węzły) | 990 (po konwersji 1 028 POI) | **ignorowane**; latarnie proceduralnie co 18 m na każdym chodniku (`apps/game/src/world/town/decor.ts:19,62,120`, ~25% zepsutych) |
| highway=crossing (węzły) | 1 349 (zebra 108, marked 73, uncontrolled 474, unmarked 152, traffic_signals 46, bez crossing=* 496) | **odrzucane w konwerterze** (convert.ts zachowuje tylko kolejowe level_crossing, l.433–440); zebry generowane geometrycznie (`apps/game/src/world/town/zebras.ts:94 zebraSpots`) |
| footway=crossing (drogi) | 674 | nie używane jako przejścia |
| power=line / minor_line / cable | 97 / 261 / 157 dróg | line+minor_line → `power` (hv110 834, hv220 220, lv 505 odcinków w kafelkach); cable słusznie pominięte |
| power=tower / pole / portal | 481 / 1 623 / 47 | słupy na każdym wierzchołku linii (`tools/map/src/osm/types.ts:100`, `world-source/infra.ts`), więc z danych: OK |
| power=transformer | 17 | brak |

## Luki i hipotezy błędów
1. Zebry: `zebraSpots` (zebras.ts:142–200) stawia zebrę na **każdej nodze każdego skrzyżowania jezdni asfaltowej r≥2** oraz tam, gdzie chodnik przecina jezdnię. Wjazdy (service/parking asfaltowe) liczą się jak skrzyżowanie, a chodnik przecinający drogę daje zebrę w środku kwartału: stąd „przejścia poza skrzyżowaniami” i ich nadmiar. Dane OSM mają 1 349 węzłów crossing, z czego tylko 181 oznaczonych (zebra+marked) i 46 z sygnalizacją, ale konwerter je wyrzuca. Propozycja: przenieść `highway=crossing` z `crossing∈{zebra,marked,traffic_signals,uncontrolled}` do danych i rysować zebrę tylko tam; fallback geometryczny tylko na skrzyżowaniach dróg ≥ tertiary, bez service i bez footway mid-block.
2. Latarnie: 990 realnych lamp ignorowane, w grze siatka co 18 m na każdym chodniku (także na osiedlowych ścieżkach i parkingach). Użyć POI `street_lamp` z danych (dosunięte do krawężnika), a proceduralne tylko tam, gdzie w promieniu 60 m nie ma żadnej lampy z OSM.
3. Słupy niskiego napięcia: `decor.ts:63–70` stawia `prop-electricity-pole` co 30 m wzdłuż każdego chodnika (proceduralnie, bez przewodów), niezależnie od 505 odcinków `lv` z OSM. Dubluje i fałszuje sieć. Hipoteza: to właśnie „słupy nie tam, gdzie trzeba”. Wyłączyć na mapach OSM (zostawić linie z danych).
4. Linie WN pochodzą z danych (wierzchołki = słupy), ale dane po `straighten.ts:338` są obracane o 27° razem z mapą; sprawdzić, czy słupy hv110/220 nie lądują w budynkach po prostowaniu ulic (pole-check liczy tylko drogi/chodniki/budynki dla ratchetu, testy przechodzą).
5. building:colour/roof:shape/height/roof:levels gubione w `convert.ts` (typy `OsmBuilding` w types.ts). Nawet jeśli dziś puste (colour 0), roof:shape 84 i height 8 by się przydały; a dane mogą się zapełnić.
6. 54% typów budynków zgadywane z landuse (`typeFrom: landuse`), 86% pięter domyślne: bloki z `building=yes` w osiedlu mogą wyjść jako domy. Warto dodać heurystykę: powierzchnia > 600 m² i landuse=residential → block (Silnik/#351).
7. Kolor dachu = `building % 4` (`modules.ts:166`): id sąsiednich budynków bywają kolejne, więc sąsiedzi dostają cykliczny wzór 1-2-3-4 zamiast losowego.
8. Paleta skinów ciemna i wąska (EXT_CELLS, `skins.ts:9–55`), jeden skin `shop` dla 401 sklepów i 648 biur.
9. Brak typu „kamienica/przedwojenny” i „public” (MDK, urzędy, sąd); kościoły (38) mają prosty bryłowy skin bez wieży.
10. Liczba zebr w grze dla `osm-stw`: test `crossing-placement.test.ts` loguje ją, ale vitest w tym repo tłumi console.log, więc jej nie policzyłem (ratchet wszystkich naruszeń = 0, czyli test pilnuje odstępów i kątów, nie zgodności z OSM).

## B. Specyfikacja wyglądu

### Typy i palety (szczegóły w look-palette.json)
| typ | kind generatora | ściany | dachy | obróbki |
|---|---|---|---|---|
| block | block | #d9d2c3 #c9d3cf #e0cfa9 #c7c2d0 #d6b8a6 #bfcab2 (pastele PRL) | płaski #5a5c5e #6b6d6a #4c4e50 | balkony #8b6a4e #7a7f84 #6c7a5c #94886a #5b7480 #a8704e |
| kamienica (wariant public/house z name/levels≥3 w centrum Rozwadowa) | — | #d8c49a #c9b08a #e2d6bd #b9a48a #cdbfa8 | #8e3b2c #5a4434 #3c3f42 | #efe9df #8a7a62 |
| house | house | #e6dcc6 #e8d9a8 #efebe3 #bdb8ae #d8c09a #cfc6b4 | czerwone #8e3b2c #6e3426, brąz #5a4434, grafit #3c3f42 #2f3132 | #efe9df #6e6458 #8a8178 |
| service | shop, office, pharmacy, fuel, gym | #d7d3cb #b9bcbc #cfc2a4 #c6cfd4 #a9a397 | płaski #4c4e50 #6b6d6a #3a3c3e | szyldy/pasy #3f5a6e #7d2f2a #4e6a4b |
| industrial | industrial | #9aa0a3 #b4b2a8 #8a8f86 #a5998a #7f878c | blacha #6f7376 #5f615c, rdza #7a5a45 | #4a6b8a #7d6b3c |
| public | church, school, hospital, police, fire-station, station | #e4dcc8 #d9c7a3 cegła #9e5a45 #cdd0cc #b8a690 | #8e3b2c #3c3f42 miedź #4f6a5c #6b6d6a | #f0ebe0 #7a6a55 |
| outbuilding | shed, garage | #8b7a63 #a8a196 #6f6656 #b7aa8e #7f8a7a | papa #2f3132, blacha #5f615c, rdza #6b4731 | #4a3f33 |

### Reguły wyboru
1. OSM pierwsze: building:colour, roof:colour, roof:shape, building:material (kolor przycięty do S≤45%, L 30–85%).
2. W przeciwnym razie `seed = hash32(osmWayId)`; indeks ważony z `weights`; dach i obróbki z osobnych bitów seedu.
3. Bloki: seed osiedla = id `landuse=residential` zawierającego blok (fallback: komórka 200×200 m). Kolor bazowy wspólny, akcent balkonów różni sąsiednie bloki.
4. Dom bliżej niż 15 m od sąsiada nie powtarza pary ściana+dach.
5. Zakaz jaskrawych kolorów: poza OSM tylko paleta.
6. Dach: roof:shape z OSM, inaczej `roofShapes` z wag; bloki zawsze płaskie.
7. Postarzenie: brud z atlasu detalu, siła 0–0,35 z seedu.

### Tekstury CC0 (ambientCG, licencja CC0 1.0 sprawdzona na docs.ambientcg.com/license; wszystkie id sprawdzone przez API ambientcg.com 27.10)
| typ | ściany | dach |
|---|---|---|
| block | Plaster001, Plaster003, Concrete034, Facade001 | Concrete031, Asphalt010 |
| house | Plaster002, Plaster004, Plaster005, Bricks059 | RoofingTiles006, RoofingTiles008, RoofingTiles010, SheetMetal004 (blachodachówka) |
| service | Plaster006, Facade005, Tiles074, PaintedMetal004 | Concrete033, Asphalt010 |
| industrial | CorrugatedSteel001, CorrugatedSteel002, Concrete046, Bricks066, MetalPlates006 | CorrugatedSteel003, SheetMetal001, MetalPlates009 |
| public / kamienica | Plaster003, Bricks060, Bricks085, Facade002, Facade006 | RoofingTiles002, SheetMetal004, Concrete031 |
| outbuilding | Wood026, Bricks090, Concrete034, CorrugatedSteel002 | SheetMetal001, Asphalt010, CorrugatedSteel001 |
Nie istnieją (sprawdzone): Bricks075/076, Concrete042/044/047, RoofingTiles011–014, CorrugatedSteel007, Facade018, Asphalt025.

### Nowe tekstury do wykonania (jeden atlas, bez nowych materiałów)
- `deadzone-facade-detail` 2048² (KTX2, wersje 1024/512 jak istniejące `textures/pbr/deadzone-pbr-*`): 16 komórek 512² w skali szarości (albedo-luminancja + normal + ORM) z powyższych materiałów ambientCG, zmniejszone i zkafelkowane: tynk gładki, tynk baranek, wielka płyta ze stykami, cegła, cegła ciemna, blacha trapezowa, blacha płaska, płyty metalowe, deski, beton, dachówka karpiówka, dachówka esówka, blachodachówka, papa, witryna, brud/zacieki.
- Kolor = komórka palety (istniejące UV do atlasu 16×16, nowe komórki od 236) albo atrybut wierzchołka `color`; detal mnożony w tym samym shaderze.
- Modele: wieża kościoła (2 warianty), attyka sklepu z szyldem, dach shed, dach sawtooth hali.

### Draw calle
Dziś ~182 (limit 250). Kolor per budynek w palecie/atrybucie, detal jako druga tekstura **tego samego** materiału budynku: +0 draw calli. Jedyny koszt: jeśli kolor wierzchołkowy rozbije batch per skin, to i tak mniej skinów (typ zamiast 15 skinów) = −5…−10. Nowe modele (wieża, attyka) instancjonowane: +2–4. Szacunek po zmianie: 175–190.

## C. Charakterystyczne budynki (OSM way id, współrzędne pierwszego węzła; opis z OSM/Wikipedia/Commons, do weryfikacji na zdjęciach tylko co do proporcji)
| # | budynek | OSM | lat, lon | osobny budynek w OSM | wygląd (orientacyjnie) |
|---|---|---|---|---|---|
| 1 | Konkatedra MB Królowej Polski (Stalowa Wola) | way 239040526, building=cathedral | 50.56888, 22.06704 | tak | duży kościół z jasnego kamienia/cegły, wysoka wieża z hełmem, dach dwuspadowy grafit; dominanta centrum |
| 2 | Kościół Opatrzności Bożej | way 291339267, church | 50.57835, 22.06218 | tak | współczesny (lata 90.), duża bryła, jasny tynk, stromy dach, wieża |
| 3 | Kościół św. Jana Pawła II | way 291311185 | 50.56407, 22.05831 | tak | nowoczesny, jasna elewacja, dach dwuspadowy |
| 4 | Kościół NSPJ (Charzewice/Rozwadów) | way 291337739 | 50.54322, 22.08495 | tak | murowany, czerwona cegła, wieża |
| 5 | Kościół Zwiastowania Pańskiego (Rozwadów) | way 291349371 | 50.58640, 22.04574 | tak | barokowy klasztor kapucynów, biały tynk, czerwony dach |
| 6 | Kościół MB Szkaplerznej (Rozwadów) | way 291346795 | 50.59184, 22.04878 | tak | zabytkowy, otynkowany, dach blaszany |
| 7 | Urząd Miasta Stalowej Woli | way 545291943, townhall | 50.56537, 22.06367 | tak | modernistyczny gmach z lat 30., 3–4 piętra, jasny tynk, płaski/niski dach |
| 8 | Muzeum Regionalne (pałac Lubomirskich, Rozwadów) | way 500390095 | 50.59404, 22.04256 | do sprawdzenia (obrys bez tagu building) | pałac, 2 kondygnacje, jasny tynk, czerwony dach czterospadowy |
| 9 | Miejski Dom Kultury | way 291332391, public | 50.56758, 22.05431 | tak | modernizm/socrealizm, 3 piętra, jasny tynk, kolumnowe wejście |
| 10 | Huta Stalowa Wola (teren) | way 33016950 landuse=industrial; hala 359131876 „Huta Stalowa Wola” | 50.55209, 22.06658 / 50.54411, 22.06067 | teren + pojedyncze hale | rozległe hale z blachy i cegły, dachy szedowe, kominy |
| 11 | Hala LiuGong (dawne M17) | way 334830938 | 50.54678, 22.04660 | tak | bardzo długa hala, blacha szara, dach płaski |
| 12 | Elektrociepłownia / Elektrownia Stalowa Wola | ways 331114795, 677099935 | 50.55355, 22.07872 | tak | blok energetyczny, wysoki komin, chłodnia, beton + blacha |
| 13 | Powiatowy Szpital Specjalistyczny | way 187430937 (amenity=hospital, teren) | 50.56377, 22.06763 | teren (budynki osobno bez nazwy) | wielokondygnacyjny blok szpitalny 6–8 pięter, jasny tynk, płaski dach |
| 14 | Komenda Powiatowa Policji | way 291332394 | 50.56725, 22.05614 | tak | 3–4 piętra, tynk, płaski dach |
| 15 | KP PSP (straż pożarna) | way 161065834 | 50.57741, 22.05890 | tak | remiza z bramami, wieża ćwiczeń, czerwone bramy |
| 16 | Dworzec PKP Stalowa Wola Rozwadów | way 309333352, train_station, roof:shape=gabled | 50.59189, 22.04161 | tak | piętrowy dworzec z czerwonej cegły, dach dwuspadowy |
| 17 | Dworzec PKS | way 298687078, bus_station | 50.56924, 22.05735 | tak | parterowy pawilon, wiaty |
| 18 | Hala Targowa | way 50740869 | 50.57220, 22.05541 | tak | parterowa hala, płaski dach |
| 19 | Politechnika Rzeszowska, Wydz. Mech.-Techn. | way 440911151, university | 50.55826, 22.05181 | tak | 3–4 piętra, jasna elewacja |
| 20 | Galeria / Nova Stalova (w budowie) | way 1512683793 construction | 50.56043, 22.06476 | teren budowy | duży obiekt handlowy, płaski dach |
| 21 | Stadion PKS San (Rozwadów) | way 187435576, pitch | 50.59133, 22.03750 | boisko (bez budynku trybun) | boisko + trybuna |
| 22 | Szkoła Podstawowa nr 2 | way 359173148, school | 50.56263, 22.06431 | tak | 3 piętra, typowa szkoła PRL, tynk jasny |
Uwaga: opisy wyglądu są orientacyjne (pamięć + typ budynku z OSM); przed modelowaniem sprawdzić proporcje na Wikimedia Commons / Mapillary, niczego nie kopiując. Stadion MOSiR (Hutnik) i główne trybuny nie są w OSM jako osobne budynki.
