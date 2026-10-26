# Backend: projekt (Deadzone)

> **Status:** stan na 4.10.2026. Nic z tego nie jest wdrożone. Migracje są w `supabase/migrations` (tylko pliki, testowane na PGlite), API `/v1/characters…` w `apps/server`. Zastosowanie migracji na hostowanym projekcie wymaga zgody Pawła (§10).
> **Etap:** 8 (konta, serwer i landing), z przygotowaniem pod multiplayer (po demo).
> **Właściciel:** Serwer. Dotyczy także: Symulacja (`packages/sim`, format zapisu, permadeath), Silnik (`apps/game`, IndexedDB), Designer (UI logowania, listy postaci i ekran śmierci).
> **Stan repo:** szkielet z PR #1 już istnieje: `apps/server` (Fastify, `GET /health`), `packages/protocol` (`PROTOCOL_VERSION`, `Command`), `packages/sim` (`createRng`, `TICK_RATE_HZ = 20`). Ten dokument go rozszerza i nie zmienia.

## 0. Najważniejsze rekomendacje

1. **Osobny projekt Supabase dla gry w osobnej organizacji** (np. org `deadzone`, projekt `deadzone-prod`, region UE). Istniejącego projektu `cpydztktoszrnlqiubqf` nie współdzielimy. Uzasadnienie w [§7](#7-hosting-i-koszty) i [§8](#8-decyzja-osobny-projekt-supabase-czy-współdzielony).
2. **Logowanie:** kod jednorazowy z maila (OTP, 6 cyfr, z magic linkiem w tej samej wiadomości) oraz Google OAuth. **Bez haseł na start.** Gra działa bez konta lokalnie. Po zalogowaniu gracz może przenieść postać do chmury.
3. **Model: jedna postać = jedna gra.** Konto może mieć wiele postaci. Świat, seed i ustawienia należą do wiersza postaci; świat nie jest osobnym rekordem.
4. **Jeden bieżący zapis na postać, nadpisywany przez serwer.** Tabela `saves` ma dokładnie jeden wiersz na `character_id`. Nie ma punktów przywracania, starszych wersji ani historii. Przed równoległym nadpisaniem chroni optimistic concurrency na polu `version`.
5. **Permadeath jest nieodwracalny.** Serwer ustawia `characters.status = dead` i `died_at`, usuwa plik oraz wiersz `saves`, a wiersz postaci zostawia jako nagrobek.
6. **Limity na konto:** 20 żywych postaci (nagrobki się nie liczą) oraz 50 MiB zapisów łącznie. Zmierzony zapis po około 50 h gry ma 0,75–1,96 MiB po kompresji, więc 20 postaci się mieści; serwer odrzuca przekroczenia.
7. **Klient tylko czyta dane z bazy, a wszystkie zapisy przechodzą przez `apps/server`.** RLS pozwala właścicielowi wyłącznie na odczyt własnych wierszy. Zmiany stanu wykonuje Fastify przez service role po walidacji.
8. **Autorytet:** w singleplayerze symulacja działa u klienta, serwer waliduje i utrwala DZSV; później w co-opie serwer będzie autorytatywny.
9. **`apps/server` zamiast Edge Functions.** Serwer jest potrzebny do multiplayera, działa w Node jak testy `sim` i nie ma limitu 2 s CPU na żądanie.
10. **Koszty:** około 0–12 USD/mies. dla zamkniętych testów i około 31–37 USD/mies. dla publicznego demo. Limit 20 żywych postaci nie zmienia wyniku wcześniejszej kalkulacji; szczegóły w [§7](#7-hosting-i-koszty).

---

## 1. Architektura

```
 przeglądarka
 ┌───────────────────────────────────────────────┐
 │ apps/web (landing, logowanie, profil, postacie)│
 │ apps/game ── Web Worker: packages/sim (20 Hz) │  singleplayer: sim u klienta
 │    │  IndexedDB: 1 rekord na postać (DZSV)     │  co-op: predykcja + render
 └────┼──────────────┬───────────────────────────┘
      │ supabase-js   │ HTTPS /v1/characters… (JWT)       później: WebSocket (wss)
      │ (Auth + odczyt│                                  │ komendy ↑ snapshoty ↓
      ▼ własnych wierszy)                                ▼
 ┌────────────────────────┐   service role   ┌─────────────────────────────────┐
 │ Supabase (projekt gry) │◀───────────────────│ apps/server (Node, Fastify)     │
 │ Auth (email OTP,       │                   │ http: walidacja i zapisy DZSV   │
 │   Google)              │  JWKS (public)   │ później: autorytatywna symulacja │
 │ Postgres + RLS         │──────────────────▶│   packages/sim, tick 20 Hz     │
 │ Storage: bucket saves  │                   └─────────────────────────────────┘
 └────────────────────────┘
```

- `packages/protocol`: wersjonowane typy i schematy zod dla koperty DZSV oraz API (`SaveEnvelopeHeader`, odpowiedzi HTTP), a później dla WebSocketu (`Command`, `CommandBatch`, `NetSnapshot`).
- `packages/sim`: `serializeState`, `deserializeState`, `migrateSave`, `SAVE_FORMAT_VERSION` oraz zdarzenia `CharacterDied` i `DayStarted`. Bez DOM i bez Node API, żeby działało w Workerze, Node i `worker_threads`.
- `apps/server`: walidacja kopert, limitów i stanu przez Fastify oraz zapis do Storage i Postgresa. Później punkt wejścia `realtime` może działać jako osobny proces.

### 1.1 Słownik

| Pojęcie | Znaczenie |
|---|---|
| **Postać** | Wiersz `public.characters`; jest jednocześnie właścicielem jednej gry i jej świata. `alive` albo nieodwracalnie `dead`. |
| **Świat postaci** | `world_seed`, `worldgen_version`, `world_settings` i zmieniony stan mapy zapisane dla postaci; nie jest osobnym wierszem ani tabelą. |
| **Snapshot zapisu** | Bieżący stan gry w kopercie DZSV. W chmurze istnieje najwyżej jeden na postać (`saves` + jeden plik Storage). |
| **Nagrobek** | Martwa postać zachowana z imieniem, liczbą przeżytych dni i datą śmierci. |
| **Snapshot sieciowy** | Tylko co-op. Stan obszaru zainteresowania w danym ticku; nigdy nie trafia do `saves`. |
| **Wersja zapisu** | Monotoniczny numer `saves.version`, używany do optimistic concurrency. |

## 2. Auth i gra lokalna

### 2.1 Metody logowania

| Metoda | Plusy | Minusy | Decyzja |
|---|---|---|---|
| **Email OTP** (kod 6 cyfr + link w tym samym mailu) | Bez haseł do wycieku i resetowania; kod działa także po otwarciu linku w innej przeglądarce | Wymaga własnego SMTP | **Tak** |
| Magic link sam w sobie | Prosty | Skanery poczty mogą zużyć link, a link może otworzyć inną przeglądarkę | Tylko razem z OTP |
| Email + hasło | Znane użytkownikom | Reset haseł i większa powierzchnia ataku | **Nie na start** |
| **Google OAuth** | Jedno kliknięcie | Wymaga konfiguracji Google Cloud, domeny i polityki prywatności | **Tak** |
| Anonimowe konta Supabase | Brak rejestracji | Nadużycia i zaśmiecanie bazy | **Nie**; gość gra lokalnie |

Przed wpuszczeniem osób spoza zespołu potrzebne są własny SMTP, SPF/DKIM/DMARC, CAPTCHA, PKCE, whitelist domen i redirectów, asymetryczne klucze JWT oraz MFA na koncie Supabase. JWT serwer weryfikuje lokalnie przez JWKS.

### 2.2 Lokalna postać i przeniesienie do chmury

- Bez logowania wszystko działa lokalnie. IndexedDB przechowuje jeden rekord na postać, nadpisywany przy każdym zapisie, w tym samym formacie DZSV co chmura: `{ characterId, name, envelope, meta, updatedAt, cloud }`.
- Lokalny permadeath ma te same reguły produktu, ale nie może być technicznie wymuszony, bo gracz może skopiować dane przeglądarki.
- Po zalogowaniu gracz jawnie wybiera „Przenieś do chmury”. Serwer waliduje DZSV, tworzy `characters` oraz pierwszy `saves` i zwraca `characterId`.
- Rekord lokalny staje się cache’em postaci w chmurze. Nie tworzymy drugiej kopii „na zapas”.
- Odczyt na innym urządzeniu to lista własnych postaci, otwarcie bieżącego zapisu, weryfikacja checksumy i migracja formatu.

## 3. Model danych (opis, bez migracji SQL)

### 3.1 Relacja

```
auth.users 1──N characters 1──1 saves
                      │          └── jeden bieżący plik DZSV w Storage
                      └── świat gry: seed, generator, ustawienia i nagrobek
```

Nie ma osobnego rekordu świata ani historii zapisów.

`public.profiles` (jeden wiersz na konto, tworzony przy rejestracji) trzyma też ustawienia gracza: `settings jsonb` (pusty = domyślne), `settings_version integer` (ETag, 0 = nigdy nie zapisane) i `settings_updated_at`. Właściciel ma tylko `select` (RLS), a zapisuje wyłącznie serwer przez `put_player_settings` (compare-and-swap, tylko service_role).

### 3.2 `public.characters`

| Pole | Typ / reguła |
|---|---|
| `id` | `uuid`, klucz główny |
| `user_id` | `uuid`, właściciel z `auth.users` |
| `name` | `text`, 1–40 znaków |
| `appearance` | `jsonb`, wygląd postaci |
| `world_seed` | seed świata nadany przez serwer |
| `worldgen_version` | wersja deterministycznego generatora |
| `world_settings` | `jsonb`, ustawienia świata |
| `status` | `alive` albo `dead` |
| `days_survived` | liczba przeżytych dni, nieujemna |
| `created_at` | czas utworzenia |
| `last_played_at` | ostatnia gra |
| `died_at` | czas śmierci; pusty dla `alive`, wymagany dla `dead` |
| `last_place`, `last_x`, `last_y`, `last_z`, `last_day` | ostatnia lokacja z ostatniego zapisu do karty postaci: miejscowość (`text`, 1–64 znaki, może być pusta), pozycja w metrach (`real`), piętro (`smallint`) i dzień gry; wszystkie puste do pierwszego zapisu z podsumowaniem |

Reguły:

- Jedno konto może mieć wiele postaci, ale najwyżej **20 z `status = alive`**. Nagrobki nie zużywają tego limitu.
- `world_seed`, `worldgen_version`, `user_id` i `created_at` są niezmienne po utworzeniu.
- Właściciel ma przez RLS wyłącznie `select` własnych wierszy. Nie ma grantów `insert`, `update` ani `delete` dla klienta.
- Wszystkie utworzenia, zmiany czasu gry, śmierć i usunięcia obsługuje `apps/server` z service role.

### 3.3 `public.saves`

Dokładnie jeden wiersz na postać:

| Pole | Typ / reguła |
|---|---|
| `character_id` | `uuid`, klucz główny i FK do `characters`, `on delete cascade` |
| `storage_path` | ścieżka jedynego bieżącego pliku DZSV |
| `version` | `int`, rosnąca wersja zapisu |
| `size_bytes` | rozmiar skompresowanej koperty |
| `checksum` | checksum całej koperty, SHA-256 |
| `game_day` | dzień gry, nieujemny |
| `minute_of_day` | minuta doby gry (0–1439) z zegara sima nad `tick` zwalidowanego stanu; pusta dla wierszy sprzed kolumny |
| `updated_at` | czas ostatniej aktualizacji |

Zapis nadpisuje poprzedni stan. Klient wysyła oczekiwaną `version`; serwer atomowo sprawdza zgodność i zwiększa wersję. Niezgodność zwraca **HTTP 409** (`save_version_conflict`) i nie zmienia ani pliku, ani wiersza. Nie ma punktów przywracania, ręcznego wczytywania starszej wersji ani historii.

### 3.4 RLS, Storage i odpowiedzialność serwera

- RLS włączamy na `characters` i `saves`; klient może czytać wyłącznie wiersze, których `user_id` równa się `auth.uid()` (dla `saves` przez właściciela `character_id`).
- Klient nie ma grantów zapisu do tych tabel ani bezpośredniego uploadu do Storage. Service role pozostaje wyłącznie w środowisku `apps/server`.
- Storage ma prywatny bucket `saves`. Serwer generuje ścieżkę `{user_id}/{character_id}/current.dzsv`, a klient pobiera plik przez krótko ważny podpisany URL.
- Przy nadpisaniu serwer najpierw waliduje nową kopertę, atomowo aktualizuje metadane i dopiero potem usuwa stary obiekt. W Storage zostaje tylko bieżący plik.
- Nie przechowujemy historii ani poprzedniego pliku do odzyskiwania przez gracza.

### 3.5 Permadeath

1. `sim` emituje `CharacterDied`; klient zatrzymuje grę i wysyła ostatni snapshot z informacją o śmierci.
2. Fastify ponownie waliduje stan. W jednej operacji serwer ustawia `characters.status = dead`, zapisuje `died_at` i `days_survived`.
3. Po zatwierdzeniu śmierci serwer usuwa plik zapisu z Storage oraz wiersz `saves`.
4. Wiersz `characters` zostaje jako nagrobek: imię, przeżyte dni, data utworzenia i śmierci oraz wygląd. Nie ma wskrzeszania ani ponownego zapisu tej postaci.
5. Przy błędzie sieci klient ponawia żądanie; po potwierdzeniu śmierci kolejne zapisy dostają odmowę. Lokalnie postać jest zablokowana od razu po zdarzeniu.

## 4. Format zapisu DZSV

### 4.1 Koperta

| Offset | Rozmiar | Pole |
|---|---:|---|
| 0 | 4 | magic `DZSV` (ASCII) |
| 4 | 2 | `envelopeVersion` u16 LE |
| 6 | 2 | `flags` u16 (bit0 = gzip) |
| 8 | 4 | `headerLength` u32 LE, maks. 8 KiB |
| 12 | N | nagłówek JSON UTF-8, schemat zod |
| 12+N | reszta | gzip kanonicznego JSON stanu gry |

Nagłówek zawiera co najmniej `formatVersion`, `simVersion`, `world_seed`, `worldgen_version`, `characterId`, `gameDay`, `reason`, `rawSize` i `createdAt`. Checksum jest liczony z całej koperty. To kontrola integralności, nie mechanizm anty-cheat.

### 4.2 Zawartość stanu

Stan to JSON z `saveWorld` w `packages/sim` (`format: "deadzone-save"`, `version` 1–3, bieżąca to 3).

- `seed` to seed symulacji, równy `world_seed` postaci. Serwer wymaga zgodności z nagłówkiem. `world` (`seed`, `generatorVersion`, `contentVersion`) opisuje generator; generator jest deterministyczny, więc nie zapisujemy mapy bazowej.
- Mapa ma **16 384 × 16 384 m** (16 × 16 km), czyli **512 × 512 chunków po 32 m** (`MAP_CHUNKS`, `CHUNK_SIZE_M` w `packages/protocol`).
- `lod` (#104) to delta świata zamiast pełnych chunków: siatka komórek `cellsW × cellsH` (każda najwyżej 512), liczniki zombie (`counts`, `cellsW·cellsH·types`), flagi `active` / `epoch`, flagi lootu chunków (`chunks`, najwyżej 512² wartości) w kodowaniu zero-run varint base64 oraz sygnatury żywych chunków `sig`. Serwer sprawdza długości przez `zeroRleStats` z `packages/sim`, bez alokowania tablic.
- `playerMaps[]`, czyli mapa postaci:
  - `discovered`: bitmapa odkrytych chunków `512 × 512`, około **32 KB** bez kompresji, w kodowaniu zero-run;
  - `trail`: ślad trasy z punktem co **16 m** (`PLAYER_MAP_TRAIL_SPACING_M`), najwyżej **20 000 punktów** (`PLAYER_MAP_TRAIL_MAX_POINTS`), całe metry w granicach mapy;
  - `markers`: najwyżej **200 znaczników** `[id, x, y, ikona, kolor, tekst]`. `ikona` to jedno z 8 id `base:marker-*` (`MAP_MARKER_ICONS`), `kolor` to jeden z 5 kolorów (`SAVE_MARKER_COLORS`), a `tekst` ma najwyżej 40 znaków (emoji liczy się jako 1) i nie zawiera znaków sterujących. `id` są unikalne i mniejsze od `nextId`. Od protokołu 22 znacznik może mieć opcjonalny 7. element (`false` = ukryty na minimapie) i 8. element `z` (piętro, liczba całkowita −32 768…32 767, brak = 0);
  - `rooms` (opcjonalne, protokół 22): pokoje planów pięter (`encodeRooms` sima) jako base64 do `MAX_MAP_ROOMS_CHARS` (`saveMapRoomsSchema` z `@deadzone/protocol/schema`). Serwer sprawdza format i długość, rekordy dekoduje sim przy wczytaniu.
- `items` (magazyn przedmiotów): w mapie przedmiotów (`items.items.$m`) serwer sprawdza tylko pola opcjonalne `ItemInstance`: `wear` (zużycie broni improwizowanej, protokół 21, liczba ≥ 0, brak = 0), `fuelL` ≥ 0, `vehicle`, `thawUntil` (rozmrażanie, protokół 25, `saveItemThawSchema`) i `buildingId` (klucze do budynków, `saveItemBuildingSchema`) i `burnt` (przypalone jedzenie, protokół 31, tylko `true`, `saveItemBurntSchema`). Na poziomie sekcji sprawdzane są opcjonalne media (`powered`, `water`, `powerOffDay`, `waterOffDay`; `saveUtilitiesSchema`, protokół 25) oraz zbiorniki wody mebli `waterTanks` (protokół 36, `saveWaterTanksRawSchema`; Mapa zapisana jako `{ $m: [["x,y,z,n", litry ≥ 0], …] }`, tylko niepełne zbiorniki, brak pola = wszystkie pełne). Reszta sekcji jest nieprzezroczysta.
- Opatrywanie ran (`stitched`, `cleanUntilAge`; `saveWoundCareSchema`, protokół 27) siedzi w sekcji `survival`, która pozostaje nieprzezroczysta — serwer tych pól nie sprawdza. Tak samo budzik snu `sleepUntil` (protokół 29, `saveSleepSchema`) i brud `dirt` (protokół 33, `saveHygieneSchema`) w `survival` oraz zasłony i światła `curtains`/`lightsOn` (protokół 32, `saveLightingSchema`) w sekcji `openings`, która poza zasłonami okien jest nieprzezroczysta. Zasłony okien `openings.covers` (protokół 47, `saveWindowCoversRawSchema`) serwer sprawdza: Mapa zapisana jako `{ $m: [[openingKey, { item, lightPass 0..1, blocksSight }], …] }`; brak pola = brak zasłon. Komend serwer nie waliduje (nie są częścią stanu zapisu). Pole `fixture` akcji w toku (protokół 36) siedzi w nieprzezroczystej sekcji `queue`.
- Pozostały stan symulacji (`components`, `survival`, `ai`, `combat`, `openings` z deskami i szybami z #106, `physics` oraz pojazdy i ich części z #114 i #128) serwer ogranicza tylko rozmiarem stanu. Pełne `loadWorld` wymaga contentu i generatora po stronie serwera.
- Stan jest danymi: bez funkcji, klas, `Date` i `Map`. Kanoniczny JSON zapewnia stabilny hash i determinizm.

Walidacja działa w `worker_threads` (`apps/server/src/save/state.ts`): rozmiar koperty i rozpakowanego JSON, delta LOD, bitmapa, ślad i znaczniki. Wszystkie limity pochodzą z `packages/protocol`, a kodeki z `packages/sim`. Tekst znaczników jest danymi użytkownika: przy wyświetlaniu zawsze go escapujemy i traktujemy jako zwykły tekst, nigdy jako HTML.

Rozmiar: według pomiaru Symulacji zapis po około 50 h gry ma **0,75–1,96 MiB** po gzip, więc 20 postaci mieści się w 50 MiB.

### 4.3 Wersjonowanie

- `SAVE_VERSION` (3) i `SAVE_READABLE_VERSIONS` (1–3) są w `packages/sim`. Brakujące sekcje starszych wersji `loadWorld` uzupełnia wartościami domyślnymi.
- Serwer przyjmuje każdą wersję, którą sim umie wczytać, aż do `SAVE_FORMAT_VERSION` (domyślnie 3, env może tylko obniżyć). Nagłówek `formatVersion` musi być równy `version` stanu. Starszy zapis zostaje przyjęty bez konwersji, a następny autozapis klienta zapisuje go już jako bieżącą wersję. Wersja nowsza od serwera albo taka, której sim już nie czyta, dostaje `426`.
- Zmiana formatu nie tworzy drugiej kopii i nie wprowadza historii zapisów.

## 5. API i walidacja

### 5.1 Endpointy `/v1` (schematy w `packages/protocol`)

| Metoda i ścieżka | Opis |
|---|---|
| `GET /v1/characters` | Lista własnych żywych postaci i nagrobków z metadanymi do UI |
| `POST /v1/characters` | Utworzenie postaci z `name`, `appearance` i `world_settings`; serwer nadaje seed i wersję generatora |
| `POST /v1/characters/:id/open` | Otwarcie bieżącego zapisu; zwraca `characterId`, `version`, podpisany URL i checksumę |
| `PUT /v1/characters/:id/save` | Nadpisanie bieżącego zapisu; body DZSV, `If-Match: <version>` i checksum |
| `POST /v1/characters/:id/death` | Zatwierdzenie śmierci po walidacji stanu, a następnie usunięcie zapisu |
| `DELETE /v1/characters/:id` | Trwałe usunięcie postaci na żądanie użytkownika, wraz z jej zapisem |
| `DELETE /v1/me` | Usunięcie konta i wszystkich danych (RODO) |
| `GET /v1/me/settings` | Ustawienia gracza: `{ settings, version, updatedAt }` i nagłówek `ETag: "<version>"` |
| `PUT /v1/me/settings` | Nadpisanie ustawień; body JSON (obiekt, najwyżej 16 KB), `If-Match: "<version>"` |
| `GET /v1/me/export` | Eksport danych konta (RODO): JSON do pobrania, podpisane URL-e zapisów na 10 min |

`GET /v1/characters` zwraca (typy `ListCharactersResponse` i `CharacterSummary` w `packages/protocol`):

- przy każdej postaci `lastLocation: { place, x, y, z, day } | null` — miejscowość (najwyżej 64 znaki albo `null`), pozycja w metrach na mapie (0–16 384), piętro, dzień gry. `null` dla nagrobków i przed pierwszym zapisem z podsumowaniem;
- `usage: { usedBytes, limitBytes, alive, aliveLimit }` do „12 / 50 MB” i licznika postaci: `usedBytes` z `account_save_bytes` (bieżące zapisy konta), `limitBytes` = 50 MiB, `alive` i `aliveLimit` = 20. Starszy blok `limits` zostaje dla zgodności.

Lokacji nie podaje klient. Przy `PUT .../save` worker walidacji, po pełnej walidacji stanu, wywołuje `saveSummary(state, { dayLengthMinutes })` z lekkiego wejścia `@deadzone/sim/save-summary` (bez bitecs i DOM-u; długość dnia z `world_settings.dayLengthMinutes` postaci). Wynik jest sprawdzany i przycinany (liczby skończone, x/y do mapy, piętro całkowite −128…127, dzień ≥ 0, nazwa bez znaków sterujących, przycięta do 64 znaków). `SaveError` (`not-a-save`, `unsupported-version`, `corrupt`), inny wyjątek albo złe wartości nie blokują zapisu, który przeszedł walidację: serwer loguje ostrzeżenie i nie zmienia lokacji. `commit_save` zapisuje lokację w tej samej transakcji co zapis. `place` to najbliższe miejsce (`nearestPlace` z `@deadzone/content/places`) w pliku miejsc mapy postaci: trasa bierze `world_settings.map`, wczytuje miejsca przez `createPlacesCache` z `@deadzone/content/node` (jeden odczyt pliku na mapę i proces) i przekazuje je workerowi. Mapy bez pliku miejsc (`test-town`, `plan-4`) mają `place` = `null`. Uszkodzony plik miejsc nie blokuje zapisu: serwer loguje ostrzeżenie, a `place` jest `null`.

Nie ma endpointu do listowania, pobierania ani przywracania starszych zapisów. Nie ma osobnego endpointu „Zapisz”, bo zapis wynika z poniższych wyzwalaczy.

Ustawienia (`/v1/me/settings`, typ `PlayerSettingsResponse` w `packages/protocol`): body `PUT` to **sam obiekt ustawień** (np. `{"version":1,"audio":{"muted":true}}`), bez opakowania `{settings}`; odpowiedź ma kształt `{ settings, version, updatedAt }`. Serwer sprawdza body funkcją `validatePlayerSettings` z `@deadzone/ui/settings` i zapisuje tylko jej wynik `data` (nieznane klucze usunięte, brakujące pola z domyślnymi). Brak `If-Match` daje `428 precondition_required`, nieaktualny `412 settings_version_conflict` (klient robi `GET` i scala). Body ponad 16 KB albo `reason: 'too-large'` daje `413 payload_too_large`, `reason: 'invalid'` daje `422 invalid_settings` z polem `issues` (`path`, `code`, `message`, najwyżej 20). Body niebędące obiektem JSON daje 400. Oba endpointy liczą się do limitu żądań na IP i wymagają istniejącego konta (inaczej 401). `DELETE /v1/me` usuwa ustawienia razem z profilem.

Konflikt zapisu: `409 save_version_conflict` z `PUT /v1/characters/:id/save` ma oprócz `error` i `message` pole `server: { version, gameDay, minuteOfDay, updatedAt } | null` — bieżący zapis na serwerze (null, gdy go nie ma; `minuteOfDay` null dla zapisów sprzed kolumny). Tak samo przy przegranym wyścigu w `commit_save`.

Eksport (`GET /v1/me/export`, typ `AccountExport` w `packages/protocol`): `{ format: 'deadzone-account-export', formatVersion: 1, exportedAt, profile: { id, displayName, createdAt }, settings: { settings, version, updatedAt }, usage, characters }`. `characters` to wszystkie postacie razem z nagrobkami: metadane jak w `CharacterSummary`, `lastLocation` (zapisana, także dla nagrobków) i `save: { version, sizeBytes, sha256, gameDay, minuteOfDay, updatedAt, downloadUrl, expiresInSeconds } | null` dla żywych z zapisem; `downloadUrl` to podpisany URL pliku DZSV z prywatnego bucketu, ważny 600 s (bez wklejania plików). Nagłówki: `Content-Disposition: attachment; filename=deadzone-export-<RRRR-MM-DD>.json`, `Cache-Control: no-store`. Wymaga istniejącego konta (401), limit 5 na godzinę na konto (`LIMIT_EXPORTS_PER_HOUR`) plus limit na IP.

CORS (gra na `https://jogifpv2.github.io`, API na `<ref>.supabase.co`): ścisła lista originów z env `CORS_ORIGINS` (po przecinku, same originy bez ścieżek i bez `*`; domyślnie `https://jogifpv2.github.io,http://localhost:5173`). Dla dozwolonego originu serwer odsyła ten sam origin w `Access-Control-Allow-Origin`, bez `Allow-Credentials` (tokeny Bearer), oraz `Access-Control-Expose-Headers: ETag, Content-Disposition, Retry-After`. Preflight (`OPTIONS` z `Access-Control-Request-Method`) dostaje od razu `204` z `Access-Control-Allow-Methods: GET, PUT, POST, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type, If-Match, X-DZSV-SHA256` i `Access-Control-Max-Age: 600`, przed auth i bez liczenia do limitów. `Vary: Origin` jest na każdej odpowiedzi. Nagłówki CORS są też na błędach (401, 409, 412, 413, 422, 428, 429). Obcy origin nie dostaje nagłówków CORS, a żądania bez `Origin` (curl, serwer) działają normalnie. Logika jest w `apps/server/src/cors.ts` bez zależności od Node i Fastify, do użycia w porcie na Edge Function (`supabase/functions/api`).

Kody: `400` (format), `401` (JWT), `403` (brak własności lub ban), `404` (postać), `409` (konflikt wersji, postać martwa, limit żywych postaci), `412` (nieaktualny ETag ustawień), `413` (rozmiar lub quota), `422` (walidacja stanu lub ustawień), `428` (brak `If-Match` ustawień), `426` (wersja formatu), `429` (rate limit).

### 5.2 Walidacja zapisu i optimistic concurrency

1. Serwer weryfikuje JWT przez JWKS; `user_id` zawsze pochodzi z tokenu, nigdy z body.
2. Fastify ogranicza body, parsuje kopertę, sprawdza magic, wersję, nagłówek i SHA-256.
3. W `worker_threads` z timeoutem i limitem sterty serwer rozpakowuje gzip z limitem wyjścia, parsuje JSON i waliduje stan przez zod oraz kodeki z `packages/sim` (§4.2).
4. Z danych stanu wyznacza `game_day`, postać i status śmierci. Wartości muszą odpowiadać nagłówkowi i wierszowi `characters`.
5. Serwer blokuje wiersz `saves`, sprawdza `If-Match` względem `version`, quota 50 MiB i właściciela postaci. Konflikt wersji kończy się kodem 409.
6. Nowy plik trafia do Storage, a metadane są zatwierdzane jako kolejna wersja. Po sukcesie usuwany jest poprzedni plik.
7. Każde odrzucenie jest logowane bez treści zapisu; body DZSV nie trafia do logów ani Sentry.

### 5.3 Wyzwalacze zapisu

Zapis lokalny i synchronizacja do chmury mają te same wyzwalacze:

- **Autozapis co dzień gry.**
- **Po 120 sekundach realnego, nieprzerwanego snu**, wyłącznie w singleplayerze. W co-opie sen nie uruchamia zapisu.
- **„Zapisz i wyjdź do menu”** w menu pauzy.

Osobnego przycisku ani endpointu „Zapisz” nie ma. Przy błędzie sieci aktualny lokalny rekord zostaje w kolejce synchronizacji i jest ponawiany z tą samą oczekiwaną wersją; konflikt wymaga ponownego otwarcia bieżącego zapisu.

### 5.4 Co-op później

W co-opie Escape **nie pauzuje gry**, tylko otwiera menu. Wyjście z menu nie zapisuje automatycznie; zapis wykonuje autorytatywny serwer według reguł ustalonych dla sesji. Sen nie uruchamia zapisu po stronie klienta.

### 5.5 Limity

Wartości startowe są konfigurowalne w env serwera, ale serwer nie może ich podnieść ponad reguły produktu bez osobnej decyzji.

| Limit | Wartość | Uzasadnienie |
|---|---:|---|
| Żywe postacie na konto | **20** | Ochrona przed masowym zakładaniem; nagrobki się nie liczą |
| Łączny rozmiar bieżących zapisów na konto | **50 MiB** | Limit kosztowy Storage; zmierzone 0,75–1,96 MiB po kompresji na postać po około 50 h gry |
| Zapis na postać | Jeden bieżący plik i jeden wiersz `saves` | Brak historii i punktów przywracania |
| Zmienione chunki | Tylko mapa 512 × 512 chunków po 32 m | Reszta wynika deterministycznie z seeda |
| Odkrycie mapy | Bitmapa 512 × 512, około 32 KB bez kompresji | Stały, przewidywalny koszt |
| Znaczniki | 200, tekst do 40 znaków, 5 kolorów | Walidacja Fastify i bezpieczne renderowanie |
| Zapisy HTTP | 120 na godzinę na konto, 200 MiB uploadu na dobę | Ochrona przed spamem; zwykła gra robi znacznie mniej |
| Żądania z IP | 300 na 5 min | Niezależnie od konta |
| Nowe postacie | 10 na dobę na konto | Ochrona przed spamem |
| Eksport danych konta | 5 na godzinę na konto | Podpisuje URL-e wszystkich zapisów |

Limit 20 żywych postaci zachowuje poprzedni wynik kalkulacji kosztów i pojemności. Nagrobki zajmują tylko małe metadane `characters`, a po śmierci nie mają pliku DZSV.

## 6. Granice ochrony i multiplayer

### 6.1 Singleplayer

Symulacja działa u klienta, więc serwer nie gwarantuje uczciwości wobec osoby, która kopiuje IndexedDB lub blokuje żądanie śmierci. Serwer gwarantuje natomiast jeden bieżący zapis, optimistic concurrency, brak historii w chmurze, walidację limitów i nieodwracalny status `dead` po przyjęciu śmierci.

### 6.2 Multiplayer

| | Singleplayer | Co-op (później) |
|---|---|---|
| Gdzie działa symulacja prawdy | Web Worker klienta | Tylko `apps/server/realtime` |
| Co wysyła klient | DZSV przy wyzwalaczach zapisu | Komendy (`CommandBatch`) |
| Co dostaje klient | Bieżący zapis przy otwarciu | Snapshoty sieciowe |
| Kto decyduje o śmierci | Klientowy `sim`, serwer weryfikuje | Serwerowy `sim` |
| Kto utrwala stan | `apps/server/http` | `apps/server/realtime` |

W co-opie serwer działa z tickiem 20 Hz, przyjmuje komendy, emituje snapshoty sieciowe i sam wykonuje autozapis co dzień gry. Snapshoty sieciowe nigdy nie trafiają do `saves`, a koperta DZSV nie idzie przez WebSocket.

## 7. Hosting i koszty

Ceny w USD netto (Supabase i inni mogą doliczać VAT), sprawdzone 30.09.2026. **Przed zakupem trzeba je sprawdzić ponownie.**

### 7.1 Supabase

| | Free | Pro |
|---|---:|---:|
| Cena | 0 USD/mies. | od 25 USD/mies. za organizację |
| Baza | 500 MB/projekt | 8 GB/projekt |
| Storage | 1 GB, maks. 50 MB/plik | 100 GB |
| Egress | 5 GB/organizację | 250 GB |
| MAU | 50 000 | 100 000 |
| Backupy | brak | dzienne, 7 dni |

Limit 50 MiB na konto i 20 żywych postaci nie zmienia wcześniejszego szacunku: zmierzony zapis po około 50 h gry ma 0,75–1,96 MiB na żywą postać, a nagrobki nie mają pliku. Przed publicznym demo potrzebny jest Pro.

### 7.2 `apps/server`

Rekomendacja pozostaje taka sama: Hostinger VPS KVM 1 w UE, Docker Compose i Caddy; przy co-opie KVM 2 albo osobny proces. Alternatywa bez administrowania to Fly.io. Front jest statyczny i może działać na Hostingerze, Cloudflare Pages albo Vercel.

### 7.3 Scenariusze

| Scenariusz | Supabase | `apps/server` | Sentry | Razem |
|---|---:|---:|---:|---:|
| Dev | 0 (lokalny Supabase) | 0 | 0 | **0 USD** |
| Zamknięte testy | 0 (Free) | około 5–12 | 0 | **około 5–12 USD** |
| Publiczne demo | 25 (Pro) | 6,49–11,99 | 0 | **około 31–37 USD** |
| Co-op (testy) | 25 | 8,99–14,99 | 0–26 | **około 34–66 USD** |

Model **20 żywych postaci na konto + 50 MiB** daje ten sam wynik finansowy co poprzedni model limitów. Koszty kontrolują quota Storage, spend cap i brak historii zapisów.

## 8. Decyzja: osobny projekt Supabase czy współdzielony

| Kryterium | Współdzielenie `cpydztktoszrnlqiubqf` | Osobny projekt (rekomendacja) |
|---|---|---|
| Użytkownicy | Wspólne `auth.users`, branding i limity | Osobna baza kont i konfiguracja |
| Bezpieczeństwo | Błąd RLS lub secret key dotyka obu produktów | Promień rażenia ograniczony do gry |
| Migracje i deploy | Ryzyko konfliktów | Niezależne środowisko |
| Limity Free | Wspólne zasoby | Zasoby per projekt; osobna org izoluje egress |
| Koszt | 0 lub wspólny Pro | 0 na Free, 25 USD na Pro |

**Rekomendacja:** osobny projekt `deadzone-prod` w nowej organizacji `deadzone`, region UE. Na etapach 0–7 używamy lokalnego Supabase; projekt produkcyjny zakładamy na początku etapu 8. Przed publicznym demo organizacja przechodzi na Pro ze spend capem.

## 9. Otwarte decyzje

Model zapisów jest **rozstrzygnięty: 1 postać = 1 gra, jeden bieżący zapis na postać, bez historii i punktów przywracania. Zatwierdził Szef sztabu 1.10.2026.**

| # | Decyzja | Rekomendacja | Kto |
|---|---|---|---|
| D1 | Osobny projekt w nowej organizacji `deadzone` | Tak, na starcie etapu 8 | Paweł |
| D2 | Region danych | UE (Frankfurt) | Paweł |
| D3 | *(zamknięta)* Klient nie zapisuje bezpośrednio | Wszystko przez `apps/server` | – |
| D4 | Email OTP + Google, bez haseł i anonimowych kont | Tak | Paweł |
| D5 | Dostawca SMTP i domena nadawcy | Wybrać przed testami zewnętrznymi | Paweł + Serwer |
| D6 | Domena gry i API | Do ustalenia | Paweł |
| D7 | Hosting `apps/server` | Hostinger KVM 1, UE | Paweł |
| D8 | Co-op: własna warstwa WS vs Colyseus | Własna cienka warstwa na `sim` | Serwer + Symulacja |
| D9 | Limity: 20 żywych postaci, 50 MiB na konto | Jak w [§5.5](#55-limity) | Szef sztabu |
| D10 | Kiedy przejść na Supabase Pro | Przed publicznym udostępnieniem | Paweł |
| D11 | `display_name` unikalne czy nie | Nieunikalne na start | Szef sztabu |
| D12 | Długość dnia gry | 1 h jak domyślnie w PZ, do ustalenia w GDD | Szef sztabu + Symulacja |
| D13 | Co po śmierci | Nagrobek zostaje; nowa gra wymaga nowej postaci | Szef sztabu |
| D14 | Poprzednia rewizja do odzyskania przez admina | Nie; brak historii | Szef sztabu |
| D15 | Nieczyste wyjście | Tylko lokalny mechanizm ponowienia zapisu; bez historii w chmurze | Paweł |
| D16 | Gra offline | Tak, na bieżącym zapisie; konflikt oznacza 409 | Szef sztabu |
| D17 | Sentry Developer vs Team | Developer do demo | Paweł |

## 10. Plan wdrożenia

Legenda: **[ZGODA]** oznacza krok wymagający wyraźnej zgody Pawła (zmiany w Supabase lub produkcji, koszty, konta zewnętrzne). Ten dokument jest wyłącznie opisem; nie tworzy migracji ani nie uruchamia SQL.

1. Zatwierdzenie tego dokumentu i decyzji z [§9](#9-otwarte-decyzje).
2. `packages/protocol`: schematy koperty DZSV, typy API postaci i komunikaty co-op.
3. `packages/sim`: `serializeState`, `deserializeState`, `SAVE_FORMAT_VERSION`, migracje, `CharacterDied`, `DayStarted`, fixture’y i test determinizmu.
4. Lokalny zapis IndexedDB: jeden rekord na postać, te same wyzwalacze i format DZSV co chmura.
5. `apps/server`: auth przez JWKS, moduł postaci, walidacja Fastify, optimistic concurrency, quota, Storage i audyt bez body zapisów. **Zrobione**, łącznie z rate limitem (120 zapisów/h i 200 MiB uploadu/dobę na konto, 300 żądań/5 min na IP; liczniki w pamięci za interfejsem `RateLimitStore`, później Redis; `429` z `Retry-After`) oraz `DELETE /v1/characters/:id` i `DELETE /v1/me` (najpierw pliki w Storage, potem wiersze przez `delete_character` / `delete_account_data`, na końcu użytkownik Auth przez admin API). Walidacja DZSV (koperta, gunzip, JSON, schemat stanu) działa w puli `worker_threads` z timeoutem (`VALIDATION_TIMEOUT_MS`, przekroczenie daje 422) i limitem sterty (`VALIDATION_HEAP_MB`, co najmniej 4× `LIMIT_STATE_BYTES`, przekroczenie daje 413). Pełne `deserializeState` z `packages/sim` dojdzie, gdy serwer dostanie content i mapę. Token usuniętego konta (brak wiersza `profiles`) dostaje 401 na każdym endpoincie. Ścieżka pliku: `{user_id}/{character_id}/v{version}-{losowe}.dzsv`, żeby nowy plik powstał przed usunięciem starego.
6. **[ZGODA]** Utworzenie organizacji `deadzone` i projektu `deadzone-prod` w regionie UE.
7. **[ZGODA]** Konfiguracja Auth: Google OAuth, SMTP, CAPTCHA, redirect URLs i klucze JWT.
8. **[ZGODA]** Zastosowanie przygotowanych migracji na `deadzone-prod` dopiero po osobnym review i zgodzie.
9. **[ZGODA]** VPS/Fly.io, DNS `api.<domena>` i sekrety serwera.
10. **[ZGODA]** Smoke test: konto, nowa postać, gra, autozapis, sen, zapis i wyjście, powrót z innego urządzenia, śmierć i nagrobek.
11. **[ZGODA]** Sentry i backup bazy do celów awaryjnych, nie do przywracania zapisów graczy.
12. **[ZGODA]** Przejście organizacji `deadzone` na Pro przed publicznym demo.
13. Później: `apps/server/realtime` i autorytatywny co-op, z Escape otwierającym menu bez pauzy.

### 10.1. API jako Supabase Edge Function (`supabase/functions/api`)

Zgodnie z planem „serwer jako Edge Functions, koszt 0” to samo API działa jako funkcja `api` w projekcie `deadzone-prod` (`https://<ref>.supabase.co/functions/v1/api/...`, np. `/functions/v1/api/v1/characters`). Kod jest wspólny z serwerem Node:

- `apps/server/src/http/core.ts` i `http/api.ts`: rdzeń bez frameworka (router, CORS z `cors.ts`, limit na IP, mapowanie błędów). Trasy (`routes/*.ts`) dostają `RouteContext` zamiast obiektów Fastify.
- `app.ts`: Fastify jest tylko transportem dla serwera Node i testów (`app.inject`).
- `http/fetch.ts`: adapter `Request` → rdzeń → `Response` dla Deno. Zdejmuje prefiks `/functions/v1/api` lub `/api`, a IP klienta bierze z `X-Forwarded-For` z `TRUST_PROXY_HOPS` (domyślnie 1 na Edge).
- `edge.ts`: wejście funkcji. Walidacja DZSV działa inline w tym samym izolacie (`createInlineValidator`), bo Edge nie ma `worker_threads`. Zamiast timeoutu i limitu sterty workera działają limity platformy (CPU na żądanie, pamięć izolatu), a domyślny `LIMIT_STATE_BYTES` na Edge to 32 MiB (env może go zmienić). Pliki miejsc (`lastLocation.place`) są wbudowane w bundel (`edge-places.ts`), bo funkcja nie ma dysku. Każdy nowy plik w `PLACES_FILES` trzeba dopisać do `BUNDLED_PLACES_FILES`, czego pilnuje test.
- Limity w pamięci (`MemoryRateLimitStore`) działają na Edge osobno w każdym izolacie, więc są tylko pierwszą linią obrony. Limit żywych postaci, quota 50 MiB, permadeath i wersje zapisów pilnuje baza (triggery i RPC).

Wdrożenie:

1. Zbuduj bundel: `pnpm install`, `pnpm exec turbo run build --filter @deadzone/server`, a potem `pnpm --filter @deadzone/server build:edge`. Powstaje `supabase/functions/api/server.js` (ignorowany przez git, około 1 MB), który zawiera pakiety workspace, zależności npm i pliki miejsc. Na zewnątrz zostają tylko `node:crypto` i `node:zlib` z Edge Runtime.
2. Wdróż funkcję z wyłączoną weryfikacją JWT w bramce, bo API samo sprawdza tokeny przez JWKS, a preflight CORS nie ma nagłówka `Authorization`: `supabase functions deploy api --no-verify-jwt --project-ref <ref>`. Z MCP: `deploy_edge_function` z plikami `index.ts` i `server.js` oraz `verify_jwt: false`.
3. Sekrety funkcji (`supabase secrets set ...` albo panel › Edge Functions › Secrets):
   - `SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` Supabase wstrzykuje sam. Nie ustawiaj ich ręcznie, bo nazwy z prefiksem `SUPABASE_` są zarezerwowane.
   - `CORS_ORIGINS`: opcjonalny. Domyślnie `https://jogifpv2.github.io,http://localhost:5173`.
   - `JWT_ISSUER` i `JWKS_URL`: tylko gdy `SUPABASE_URL` w funkcji nie jest publicznym URL-em projektu (np. lokalne `supabase functions serve`). Domyślnie `${SUPABASE_URL}/auth/v1`.
   - Limity `LIMIT_*` jak w `apps/server/.env.example`. Mogą tylko obniżać wartości produktu.
4. Smoke test: `GET /functions/v1/api/health`, preflight `OPTIONS` z `Origin: https://jogifpv2.github.io`, potem konto testowe i pełna ścieżka z §5.1.

Lokalnie: `deno run -A supabase/functions/api/index.ts` z `SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` w env. Serwer Node (`pnpm --filter @deadzone/server dev`) działa dalej i używa puli workerów.

## 11. Źródła

- Supabase pricing: https://supabase.com/pricing
- Supabase billing: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase production checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase passwordless: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase JWT / JWKS: https://supabase.com/docs/guides/auth/signing-keys
- Supabase Edge Functions limits: https://supabase.com/docs/guides/functions/limits
- Fly.io: https://fly.io/pricing/
- Railway: https://railway.com/pricing
- Hostinger VPS: https://www.hostinger.com/vps-hosting
- Sentry: https://sentry.io/pricing/
