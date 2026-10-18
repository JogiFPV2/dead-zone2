# Deadzone: styl realistyczny (PBR), przewodnik i budżet

Pilot z 2026-10-18 (Designer). Referencja: `deadzone-shots/style-real.png`, kontrola: `deadzone-shots/real-pilot.png` i `real-pilot-quality.png` (na boxie, poza repo).

Pliki w repo, ścieżki względne do `apps/game/public`:
- tekstury: `textures/pbr/deadzone-pbr-{albedo,normal,orm}-{1024,512}.ktx2` i `textures/pbr/layers.json`;
- modele: `models/deadzone-pbr/<id>.glb` (wynik `assets build`, w `manifest.json`); źródła `*.pbr.glb` w `tools/assets/pbr/` (ścieżka względem repo).

Źródła i narzędzia (poza repo, na boxie):
- `/workspace/assets-src/pbr/`: `build_textures.py`, `build.sh`;
- `/workspace/dz-html/style/pbr/`: `pbr-lib.js`, `export.cjs`, `pbr-material.js`, scena kontrolna `pilot.html`.

Licencje są w `ASSETS.md`, w sekcji „Styl realistyczny (PBR)”.
Kamera izometryczna (yaw 45°, pitch atan(1/√2)). Gracz ogląda świat z ok. 30–60 m, więc liczy się czytelna sylwetka i duża plama koloru. Drobne detale schodzą na drugi plan.

## 1. Materiał i kontrakt geometrii (`deadzone-pbr`)
Jeden materiał dla całego świata: MeshStandardMaterial z `onBeforeCompile` (wzorzec: `pbr-material.js` Designera).
- Tekstury: trzy tekstury tablicowe 2D (`sampler2DArray`), każda po 13 warstw:
  - `deadzone-pbr-albedo-*.ktx2`: sRGB.
  - `deadzone-pbr-normal-*.ktx2`: linear. Zapisana w Basis `--normal-mode`, więc **X jest w kanale R (=G=B), a Y w kanale A**. Z liczymy w shaderze.
  - `deadzone-pbr-orm-*.ktx2`: linear. R = AO, G = roughness, B = metalness.
- Atrybuty GLB:
  | atrybut | znaczenie |
  |---|---|
  | `TEXCOORD_0` | rzut pudełkowy ze świata, w metrach / `tileMeters` warstwy (UV się powtarzają, bez atlasu, bez przeciekania mipów) |
  | `TEXCOORD_1` | (x = indeks warstwy 0–12, y = brud 0–1) |
  | `COLOR_0` | liniowy tint, 1,0 = tekstura bez zmian |
- Silnik musi przemianować atrybuty `uv` na `pbrUv` i `uv1` na `pbrL` (robi to `preparePBRGeometry`), bo inaczej three.js dokłada własne próbkowanie map.
- Normalne mapy mają ramkę TBN z pochodnych ekranowych, więc atrybut tangent nie jest potrzebny.

## 2. Warstwy, skala tekstur i paleta
| # | id | źródło | kafel (m) | tryb | śr. albedo lin. | śr. roughness |
|---|---|---|---|---|---|---|
| 0 | asfalt | Asphalt031 | 3,0 | natural | 0,14 | 0,88 |
| 1 | plyty (chodnik z płyt) | PavingStones136 | 2,0 | natural | 0,29 | 0,85 |
| 2 | kostka | PavingStones128 | 1,2 | natural | 0,28 | 0,86 |
| 3 | trawa (też liście) | Grass004 | 2,0 | natural | 0,10 | 0,85 |
| 4 | ziemia (też maska brudu/makro) | Ground037 | 3,0 | natural | 0,24 | 0,87 |
| 5 | beton (wielka płyta) | Concrete034 | 3,0 | tint, neutral 0,70 | 0,45 | 0,83 |
| 6 | tynk jasny | Plaster001 | 2,0 | tint, neutral 0,82 | 0,64 | 0,94 |
| 7 | cegla | Bricks085 | 1,5 | natural | 0,24 | 0,87 |
| 8 | papa | Asphalt033 | 2,0 | natural | 0,07 | 0,95 |
| 9 | blacha trapezowa | CorrugatedSteel005 | 2,0 | tint, neutral 0,72, metal ×0,5 | 0,48 | 0,58 |
| 10 | drewno | Planks021 | 1,5 | natural | 0,24 | 0,90 |
| 11 | szklo | proceduralne | 1,0 | tint | 0,03 | 0,08 |
| 12 | gladki (lakier, plastik, malowany metal) | proceduralne | 2,0 | tint, neutral 0,80 | 0,60 | 0,42 |

Kafel w metrach oznacza, ile metrów świata przypada na jedno powtórzenie tekstury. Nie zmieniaj skali per asset, bo cegła ma mieć ten sam rozmiar na każdym domu.

**Tryby tintu:**
- `tint`: warstwa jest zneutralizowana do szarości. Kolor daje `COLOR_0 = kolor_projektowy_lin / meanLinear`.
- `natural`: tekstura ma własny kolor. `COLOR_0` to szary mnożnik w zakresie 0,55–1. Można go zabarwić delikatnie, maksymalnie o ±15% na kanał.

**Paleta (sRGB) użyta w pilocie:**
- Trawa: `#5d6a3c` dziko, `#66733f` trawnik.
- Liście: `#4a6630`, `#55723a`, `#3f5a2a`, `#62803f`. Kora: `#4f4338`.
- Asfalt: `#5b5b5d`. Krawężnik (beton): `#a3a09a`. Linie na jezdni: `#cfcabb`.
- Wielka płyta i domy: kolory z oryginalnych modeli (szaro-beżowy beton, jasny tynk). Balkony w stonowanych pastelach PRL: zgaszona zieleń, ochra, ceglasty, szaroniebieski.
- Lakier aut: `#7b2e26` (bordo), `#3e5a6b` (szaroniebieski). Słupy i latarnie: `#5d6366`, `#3f4447`.
- Niebo i mgła: `#a9b8c2` i `#b9c3c8`. Słońce: `#ffe9cc`, 3,4. Hemi: `#cfe0f0` / `#5a5448`. Tone mapping: ACES.
- Zasada: nasycenie umiarkowane, bo to polskie miasto na jesień. Żadnych czystych kolorów, jasność albedo w przedziale 0,04–0,75 linear. Jedynym akcentem nasyconym mogą być auta i pojedyncze balkony.

## 3. Zużycie i brud
Shader dodaje trzy efekty z jednego źródła (warstwa 4, ziemia), dzięki czemu nie trzeba osobnych tekstur:
1. **Brud** (`TEXCOORD_1.y`): maska w dużej skali (ok. 22 m) razy wartość z wierzchołka. Przyciemnia albedo maksymalnie do ok. ×0,65 z brązowym odcieniem (R 0,70, G 0,67, B 0,62) i podbija roughness o +0,15.
   - Domyślnie w eksporcie: powierzchnie poziome 0,25, ściany `1 − h/1,6` (brud od cokołu w górę do ok. 1,6 m).
   - Ręcznie: zacieki pod parapetami i balkonami 0,4–0,6, fasady od strony ulicy 0,5, dachy z papy 0,3.
2. **Makrowariacja** (wszystkie warstwy): moduluje albedo ×0,85–1,15 w skali ok. 75 m. Usuwa efekt kafelkowania na dużych płaszczyznach (asfalt, trawa).
3. **Wydeptane plamy w trawie**: tylko warstwa trawa, gdy brud > 0. Wprowadza ziemię w łaty ok. 50 m. Trawniki przy ścieżkach dostają brud 0,2–0,35.

Zasady:
- Zniszczenie (apokalipsa) robimy decalami: krew, plamy oleju, gruz. Nie zapiekamy go w warstwach.
- Rdza na blasze: tint w stronę `#8a5a3c` i brud ≥ 0,6.
- Szkło: zawsze ciemne (odbija niebo), brud 0,3–0,5. Nie robimy przezroczystości, bo wnętrza widać tylko w trybie przekroju.

## 4. Zasady dla nowych assetów
1. Modeluj w metrach, z osią Y w górę. Pivot na środku podstawy.
2. Dla każdego trójkąta wybierz warstwę z tabeli. Nowa warstwa to decyzja projektowa, bo każda kosztuje +0,6 MB przy 1024.
3. UV nie trzeba rozkładać ręcznie. Eksporter (`pbr-lib.js → buildPBR`) robi rzut pudełkowy w metrach. Dla roślin używaj `proj: 'blob'` (ciągłe UV bez szwów).
4. Kolor dawaj przez tint (`COLOR_0`). Nie twórz osobnych tekstur na wariant koloru.
5. Liczba trójkątów:
   | typ | budżet |
   |---|---|
   | blok | ≤ 7 tys. |
   | dom | ≤ 2 tys. |
   | auto | ≤ 2,5 tys. |
   | drobny prop | ≤ 600 |
   | drzewo | ≤ 1,5 tys. (instancjonowane) |
   | krzak | ≤ 400 |
6. Jedna siatka i jeden materiał na GLB, czyli 1 draw call. Części ruchome (drzwi, koła) jako osobne węzły, ale z tym samym materiałem.
7. Krawędzie: fazuj tylko to, co czyta się z 40 m (narożniki bloków, krawężniki). Resztę detalu dają normal mapy.
8. Kontrola: sprawdź render w scenie kontrolnej (`pilot.html`) albo w grze z `?style=real` (pilot klienta, #230) na presetach low i high. Albedo nie może się przepalać (biel ≤ 0,8 sRGB), a cień musi być czytelny na trawie i asfalcie.

## 5. Budżet wydajności
**Tekstury (KTX2 Basis ETC1S, mipmapy, transkodowanie na GPU do BC7/ETC2/ASTC):**
| zestaw | albedo | normal | ORM | razem pobranie |
|---|---|---|---|---|
| 1024² × 13 warstw | 2,29 MB | 4,10 MB | 1,78 MB | **8,2 MB** |
| 512² × 13 warstw | 0,59 MB | 0,97 MB | 0,48 MB | **2,0 MB** |

- Pamięć GPU po transkodowaniu do BC7: ok. 18 MB na 1024 i ok. 4,5 MB na 512.
- Normal mapy to połowa pobrania. Opcja: UASTC + zstd dla normali (lepsza jakość, ok. 2× większe) albo normal 512 także na medium.
- Pobranie GLB w pilocie to 2,07 MB (8 plików). Nowe modele zwykle ważą 50–250 KB/szt., bloki ok. 0,6 MB. Gzip lub Brotli na serwerze daje ok. −50%. Meshopt to opcjonalnie ok. −70%.

**Presety jakości (ustawienia z pilota; cele GPU orientacyjne, niezmierzone, bo render szedł przez swiftshader):**
| | low | medium | high |
|---|---|---|---|
| tekstury | 512² | 1024², aniso 4 | 1024², aniso 8 |
| cienie | 1024, PCF r1 | 2048, PCF r2.5 | 4096, PCF r4 |
| SSAO | brak (tylko AO z tekstury ×0,8) | GTAO ½ rozdz., 8 próbek | GTAO pełna rozdz., 16 próbek |
| env | brak | brak | RoomEnvironment 0,12 |
| normal map | ×0,8 | ×1 | ×1 |
| cel GPU | iGPU, 60 fps @ 1080p | GTX 1060-klasa, 60 fps @ 1440p | RTX 2060+, 60 fps @ 1440p |

- Wspólne: PCFShadowMap, `shadow.normalBias 0.09`, `bias −0.0005`, kaskada 1. Ortho frustum cieni dopasowane do widoku ok. ±60 m.
- Draw calle w pilocie: 14 na low (8 siatek + cienie). Na scenę miejską cel to ≤ 250 draw calli i ≤ 600 tys. trójkątów z cieniami.
- Drzewa, krzaki i auta: obowiązkowo `InstancedMesh`.
