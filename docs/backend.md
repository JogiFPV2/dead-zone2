# Backend: projekt (Deadzone)

> **Status:** tylko projekt, stan na 30.09.2026. Nic z tego nie jest wdrożone. Cały SQL poniżej to **szkic do review** (sprawdzony parserem Postgresa), a nie migracja. Nie uruchamiać go na żadnym projekcie Supabase bez zgody Pawła (patrz [Plan wdrożenia](#10-plan-wdrożenia)).
> **Etap:** 8 (Konta, serwer i landing), z przygotowaniem pod multiplayer (po demo).
> **Właściciel:** Serwer. Dotyczy także: Symulacja (`packages/sim`, format zapisu, permadeath), Silnik (`apps/game`, IndexedDB), Designer (UI logowania, listy światów, ekranu śmierci).
> **Stan repo:** szkielet z PR #1 już istnieje: `apps/server` (Fastify, `GET /health`), `packages/protocol` (`PROTOCOL_VERSION`, `Command`), `packages/sim` (`createRng`, `TICK_RATE_HZ = 20`). Ten dokument go rozszerza i nie zmienia.

## 0. Najważniejsze rekomendacje

1. **Osobny projekt Supabase dla gry w osobnej organizacji** (np. org `deadzone`, projekt `deadzone-prod`, region UE). Istniejącego projektu `cpydztktoszrnlqiubqf` nie współdzielimy. Uzasadnienie w [§8](#8-decyzja-osobny-projekt-supabase-czy-współdzielony).
2. **Logowanie:** kod jednorazowy z maila (OTP, 6 cyfr, z magic linkiem w tej samej wiadomości) oraz Google OAuth. **Bez haseł na start.** Gra działa bez konta, na światach lokalnych. Po zalogowaniu gracz może przenieść świat do chmury.
3. **Model: światy zamiast slotów.**
   - Konto może mieć dowolną liczbę światów. Jedyne ograniczenia to miękki limit przeciw nadużyciom (20 aktywnych) i łączny rozmiar zapisów na konto (50 MiB).
   - W świecie żyje najwyżej jedna postać naraz. **Permadeath:** martwej postaci nie da się wskrzesić, a świat trwa dalej z nową postacią albo zostaje zarchiwizowany.
4. **Jeden bieżący zapis na świat, nadpisywany przez serwer.** Nie ma historii dostępnej dla gracza, ręcznego wczytywania starszych wersji ani slotów. Przed cofaniem stanu chronią:
   - numer `revision`;
   - rosnący `game_tick`;
   - sesja świata (tylko ostatnio otwarte urządzenie może zapisywać);
   - nieodwracalny status `dead` w bazie.
5. **Autozapis co dzień gry** oraz zapis przy wyjściu i przy śmierci. Rate limit jest do tego dopasowany: kubełek 3 zapisów na świat, uzupełniany 1 na minutę.
6. **Klient tylko czyta, wszystkie zmiany przechodzą przez `apps/server`.** Klient przez Data API czyta wyłącznie swoje wiersze (RLS, bez kolumn technicznych) i zmienia swoje `display_name`. Zmiany stanu robi `apps/server` (Fastify) atomowo przez funkcje SQL, po walidacji na tym samym `packages/sim`.
7. **Autorytet:**
   - Singleplayer: symulacja działa u klienta, a serwer tylko **waliduje i utrwala** snapshoty zapisu, łącznie z regułami permadeath.
   - Multiplayer: **serwer jest autorytatywny.** Symulacja prawdy działa tylko na serwerze, klienci wysyłają komendy i dostają snapshoty sieciowe.
   - Oba tryby używają tego samego `serializeState` i tego samego schematu `worlds`/`characters`. Szczegóły w [§6](#6-multiplayer-serwer-autorytatywny-i-snapshoty).
8. **`apps/server` zamiast Edge Functions.** Serwer i tak jest potrzebny do multiplayera, działa w Node jak testy `sim` i nie ma limitu 2 s CPU.
9. **Hosting `apps/server`:** VPS Hostinger (KVM 1, a przy multiplayerze KVM 2) z Dockerem i Caddy. Cena jest stała i przewidywalna, a Paweł ma już konto. Alternatywa bez administrowania serwerem to Fly.io.
10. **Koszty:** do zamkniętych testów około 0–12 USD/mies., publiczne demo około 31–37 USD/mies. (przed publicznym udostępnieniem potrzebny jest Supabase Pro). Nowy model zapisów nie zmienia kosztów istotnie, szczegóły w [§7](#7-hosting-i-koszty).

---

## 1. Architektura

```
 przeglądarka
 ┌───────────────────────────────────────────────┐
 │ apps/web (landing, logowanie, profil, światy) │
 │ apps/game ── Web Worker: packages/sim (20 Hz) │  singleplayer: sim u klienta
 │    │  IndexedDB: 1 rekord na świat (DZSV)     │  multiplayer: tylko predykcja + render
 └────┼──────────────┬───────────────────────────┘
      │ supabase-js   │ HTTPS /v1/worlds… (JWT)          później: WebSocket (wss)
      │ (Auth + odczyt│                                  │ komendy ↑  snapshoty sieciowe ↓
      ▼ własnych wierszy)                                ▼
 ┌────────────────────────┐   secret key   ┌───────────────────────────────────┐
 │ Supabase (projekt gry) │◀───────────────│ apps/server (Node, Fastify)       │
 │  Auth (email OTP,      │                │  http: walidacja snapshotów zapisu│
 │   Google)              │  JWKS (public) │  później realtime: autorytatywna  │
 │  Postgres + RLS        │───────────────▶│   pętla packages/sim, tick 20 Hz  │
 │  Storage: bucket worlds│                └───────────────────────────────────┘
 └────────────────────────┘
```

- `packages/protocol`: typy i schematy zod dla HTTP API (`SaveEnvelopeHeader`, odpowiedzi) oraz dla wiadomości WebSocket (`Command`, `CommandBatch`, `NetSnapshot`). Istniejące `PROTOCOL_VERSION` i `Command` są punktem wyjścia.
- `packages/sim`: udostępnia `serializeState`, `deserializeState`, `migrateSave`, `SAVE_FORMAT_VERSION` i zdarzenia takie jak `CharacterDied` i `DayStarted`. Bez DOM i bez Node API, żeby działało w Workerze, w Node i w `worker_threads`.
- `apps/server`: jedna baza kodu z dwoma punktami wejścia. `http` (API światów) i później `realtime` (serwer gry) mogą być **osobnymi procesami**, żeby walidacja zapisów nigdy nie spowalniała ticku.

### 1.1 Słownik (żeby nie mylić pojęć)

| Pojęcie | Znaczenie |
|---|---|
| **Świat** | Instancja gry: seed, mapa, ustawienia i stan chunków. Wiersz `public.worlds`. |
| **Postać** | Wiersz `public.characters`. W świecie jest co najwyżej jedna żywa (`alive`). `dead` jest nieodwracalne. |
| **Snapshot zapisu** | Pełny stan świata z `serializeState`, zapakowany w kopertę DZSV. W chmurze jest **jeden bieżący** na świat (Storage + metadane w `worlds`). |
| **Snapshot sieciowy** | Tylko multiplayer. Stan obszaru zainteresowania gracza w danym ticku: pełny przy dołączeniu, potem delta względem potwierdzonego baseline’u. Nigdy nie trafia do bazy. |
| **Sesja świata** | Identyfikator wydawany przy otwarciu świata. Zapisywać może tylko posiadacz bieżącej sesji. |
| **Komenda** | Intencja gracza (`Command` z `packages/protocol`). Jedyny sposób zmiany stanu w `sim`. |

## 2. Auth

### 2.1 Metody logowania: rekomendacja

| Metoda | Plusy | Minusy | Decyzja |
|---|---|---|---|
| **Email OTP** (kod 6 cyfr + link w tym samym mailu) | Nie ma haseł do wycieku ani resetowania. Kod działa, gdy link otworzy się w innej przeglądarce niż gra. Supabase zaleca passwordless jako ochronę przed nadużyciami przy rejestracji. | Każde logowanie to mail, więc potrzebny własny SMTP. | **Tak** |
| Magic link sam w sobie | Prosty | Link otwiera nową kartę, czasem w innej przeglądarce niż gra. Skanery poczty mogą „zużyć” jednorazowy link. | Tylko jako link w mailu z OTP |
| Email + hasło | Znane użytkownikom | Reset haseł i support. **Ochrona przed wyciekniętymi hasłami jest dopiero w Pro.** Większa powierzchnia ataku. | **Nie na start** (można dodać później) |
| **Google OAuth** | Jedno kliknięcie, bez maili | Wymaga ekranu zgody w Google Cloud, weryfikacji domeny i polityki prywatności | **Tak** |
| Anonimowe konta Supabase | Chmura bez rejestracji | Liczą się do MAU, są celem nadużyć, zaśmiecają bazę | **Nie.** Gość gra tylko lokalnie |

Konfiguracja (przy wdrożeniu, po zgodzie):
- **Własny SMTP jest obowiązkowy przed wpuszczeniem kogokolwiek spoza zespołu.** Domyślny SMTP Supabase wysyła maile tylko na adresy członków organizacji i ma niski limit godzinowy. Do wyboru Resend, Postmark, AWS SES lub Brevo (cennika nie sprawdzałem, patrz decyzja D5). Trzeba skonfigurować SPF, DKIM i DMARC, osobną subdomenę (`auth.<domena>`) i wyłączyć śledzenie linków.
- **CAPTCHA** (Cloudflare Turnstile albo hCaptcha) na rejestracji i przy wysyłce OTP.
- Rate limity Auth: OTP raz na 60 s na adres (domyślnie), ważność OTP ≤ 1 h. Limit maili z własnym SMTP startuje od 30/h i trzeba go podnieść świadomie przed publicznym startem.
- **PKCE flow**, whitelist `Site URL` i Redirect URLs tylko dla naszych domen (plus `localhost` wyłącznie w projekcie dev).
- **Asymetryczne klucze podpisu JWT** (domyślne w nowych projektach). Serwer weryfikuje JWT lokalnie przez JWKS, bez sekretu JWT.
- Włączone potwierdzanie maila. Nigdy go nie wyłączać pod presją nadużyć.
- MFA na koncie Supabase Pawła (dostęp do dashboardu).

### 2.2 Gra bez konta i przeniesienie świata do chmury

- Bez logowania wszystko działa lokalnie. Każdy świat to **jeden rekord** w IndexedDB, nadpisywany przy każdym zapisie, w tym samym formacie DZSV co w chmurze: `{ worldId: uuid, name, envelope: Uint8Array, meta, updatedAt, cloud: null | { worldId, revision } }`.
- Permadeath lokalnie działa według tych samych reguł (jeden rekord, martwa postać zostaje martwa). Nie da się jej jednak wymusić, bo gracz może skopiować dane przeglądarki. To akceptujemy ([§5.6](#56-granice-ochrony-przed-save-scummingiem)).
- Przepływ po zalogowaniu:
  1. `apps/game` listuje światy z `cloud == null` i proponuje „Przenieś do chmury”. **Nic nie wysyła się automatycznie**, bo na współdzielonym komputerze gracz mógłby wgrać cudzy świat na swoje konto.
  2. Klient wywołuje `POST /v1/worlds/import` (koperta DZSV + `importFingerprint = sha256(localWorldId ‖ seed ‖ createdAt)`). Serwer waliduje stan, zakłada wiersze `worlds` i `characters` (żywą postać albo martwą, jeśli już nie żyje) i zwraca `worldId`.
  3. **Rekord lokalny staje się cache’em świata w chmurze** (`cloud` ustawione). Nie zostaje osobna kopia „na zapas”, bo to byłby gotowy save-scum.
  4. Ten sam `importFingerprint` można zaimportować na konto tylko raz (unikalny indeks), więc nie da się wielokrotnie wgrywać tego samego lokalnego świata.
- Wczytanie na innym komputerze: lista światów z `public.worlds`, potem `POST /v1/worlds/:id/open` (sesja + podpisany URL), weryfikacja SHA-256, migracja formatu i gra. To realizuje warunek „Gotowe” etapu 8.

## 3. Schemat bazy (szkic SQL, NIE uruchamiać)

Zasady (Supabase best practices):
- RLS włączony na każdej tabeli w schemacie `public`. Najpierw `revoke all` z `anon` i `authenticated`, potem minimalne granty (także kolumnowe), bo same polityki nie odbierają domyślnych grantów.
- W politykach `(select auth.uid())` zamiast `auth.uid()` (initPlan, jedno wywołanie na zapytanie) i zawsze `to authenticated`.
- Osobna polityka na każdą operację (bez `for all`). Indeks na każdej kolumnie filtrowanej w politykach, jako pierwsza kolumna btree.
- Funkcje `security definer` tylko w nieeksponowanym schemacie `private`, z `set search_path = ''` i w pełni kwalifikowanymi nazwami.
- Funkcje wołane przez `apps/server` przez RPC są w `public`, ale jako `security invoker`, z `execute` **odebranym** `public`, `anon` i `authenticated` i nadanym tylko `service_role`.
- Autoryzacja nie opiera się na `user_metadata`.
- Testy pgTAP w `supabase/tests/*.test.sql` (allow i deny dla `anon` i `authenticated` na każdej operacji, a do tego reguły permadeath), uruchamiane lokalnie przez `supabase test db` i w CI.

Migracje będą w `supabase/migrations/` w repo. Ten dokument ich nie tworzy.

### 3.1 Model

```
auth.users 1──1 profiles
auth.users 1──N worlds 1──N characters    (maks. 1 postać 'alive' na świat: unikalny indeks częściowy)
worlds ──> jeden bieżący obiekt w Storage: worlds/{user_id}/{world_id}/r{revision}.dzsv
```

Stan postaci (ekwipunek, rany, umiejętności) jest **w snapshocie świata** (`players[characterId]`), jak w multiplayerze. `characters` trzyma tożsamość, status życia i statystyki na ekran śmierci. Serwer wylicza je ze snapshotu, nie przyjmuje od klienta.

### 3.2 Schemat `private`, `profiles`, trigger rejestracji

```sql
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text check (display_name is null
                                   or display_name ~ '^[[:alnum:]_ .-]{3,24}$'),
  -- pola autorytatywne: klient NIE ma grantu update
  max_active_worlds    smallint not null default 20
                       check (max_active_worlds between 0 and 1000),         -- miękki limit anty-nadużyciowy
  storage_quota_bytes  bigint not null default 52428800
                       check (storage_quota_bytes between 0 and 10737418240), -- 50 MiB łącznie na konto
  banned_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ( (select auth.uid()) = id );

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );
```

Trigger musi być minimalny, bo jego błąd blokuje rejestrację. `display_name` gracz ustawia sam.

### 3.3 `public.worlds` (świat + metadane jedynego bieżącego zapisu)

```sql
create table public.worlds (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 40),
  mode                  text not null default 'sp' check (mode in ('sp', 'mp')),
  status                text not null default 'active' check (status in ('active', 'archived')),
  seed                  bigint not null,                        -- nadaje serwer
  map_id                text not null check (char_length(map_id) <= 64),
  settings              jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  import_fingerprint    text check (import_fingerprint ~ '^[0-9a-f]{64}$'),
  -- bieżący zapis (revision 0 = jeszcze brak zapisu)
  revision              integer not null default 0 check (revision >= 0),
  state_path            text unique,
  state_size_bytes      integer check (state_size_bytes between 1 and 4194304),       -- 4 MiB po kompresji
  state_raw_size_bytes  integer check (state_raw_size_bytes between 1 and 67108864),  -- 64 MiB po rozpakowaniu
  state_sha256          text check (state_sha256 ~ '^[0-9a-f]{64}$'),
  format_version        integer check (format_version > 0),
  sim_version           text check (char_length(sim_version) <= 32),
  content_hash          text check (content_hash ~ '^[0-9a-f]{64}$'),
  game_tick             bigint not null default 0 check (game_tick >= 0),
  game_day              integer not null default 0 check (game_day >= 0),
  state_updated_at      timestamptz,
  alive_character_id    uuid,                                   -- FK niżej
  -- sesja: zapisywać może tylko ostatnio otwarte urządzenie; null = brak otwartej sesji
  session_id            uuid,
  session_opened_at     timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint worlds_state_complete check (
    state_path is null
    or (revision > 0 and state_size_bytes is not null
        and state_raw_size_bytes is not null and state_sha256 is not null
        and format_version is not null and sim_version is not null and content_hash is not null)
  ),
  constraint worlds_archived_has_no_state check (status = 'active' or state_path is null)
);

create index worlds_user_id_updated_idx on public.worlds (user_id, updated_at desc);   -- RLS + lista
create unique index worlds_import_fingerprint_uq
  on public.worlds (user_id, import_fingerprint) where import_fingerprint is not null;

create trigger worlds_set_updated_at
  before update on public.worlds
  for each row execute function private.set_updated_at();

-- miękki limit aktywnych światów (blokada wiersza profilu serializuje równoległe inserty)
create function private.enforce_world_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max    smallint;
  v_banned timestamptz;
  v_count  integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  select p.max_active_worlds, p.banned_at into v_max, v_banned
  from public.profiles p where p.id = new.user_id
  for update;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;
  if v_banned is not null then
    raise exception 'account_banned' using errcode = 'P0001';
  end if;
  select count(*) into v_count
  from public.worlds w where w.user_id = new.user_id and w.status = 'active';
  if v_count >= v_max then
    raise exception 'world_limit_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger worlds_enforce_limit
  before insert or update of status on public.worlds
  for each row execute function private.enforce_world_limit();

-- rewizja i czas gry tylko rosną (ochrona przed cofaniem, także przy błędzie serwera)
create function private.enforce_world_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision < old.revision then
    raise exception 'revision_regression' using errcode = 'P0001';
  end if;
  if new.game_tick < old.game_tick or new.game_day < old.game_day then
    raise exception 'game_time_regression' using errcode = 'P0001';
  end if;
  if new.user_id <> old.user_id or new.seed <> old.seed then
    raise exception 'world_identity_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger worlds_enforce_monotonic
  before update on public.worlds
  for each row execute function private.enforce_world_monotonic();

alter table public.worlds enable row level security;
revoke all on table public.worlds from anon, authenticated;
-- tylko kolumny potrzebne w UI; bez state_path, sha, seed, session_id, import_fingerprint
grant select (id, user_id, name, mode, status, map_id, settings, revision, game_day,
              state_size_bytes, state_updated_at, alive_character_id, created_at, updated_at)
  on table public.worlds to authenticated;

create policy worlds_select_own on public.worlds
  for select to authenticated
  using ( (select auth.uid()) = user_id );
-- brak grantów i polityk insert/update/delete: wszystko przez apps/server
```

Uwaga: przez grant kolumnowy klient musi podawać listę kolumn (`select('id,name,…')`), bo `select *` zwróci `42501`.

### 3.4 `public.characters` (permadeath)

```sql
create table public.characters (
  id                uuid primary key default gen_random_uuid(),
  world_id          uuid not null references public.worlds (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 40),
  profession        text not null check (char_length(profession) <= 64),
  traits            text[] not null default '{}' check (cardinality(traits) <= 40),
  status            text not null default 'alive' check (status in ('alive', 'dead')),
  born_game_day     integer not null default 0 check (born_game_day >= 0),
  days_survived     integer not null default 0 check (days_survived >= 0),
  died_at           timestamptz,
  cause_of_death    text check (char_length(cause_of_death) <= 64),
  unclean_exits     integer not null default 0 check (unclean_exits >= 0),  -- sesje bez zapisu wyjścia
  stats             jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(stats) = 'object' and pg_column_size(stats) <= 8192),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint characters_death_consistent check ((status = 'dead') = (died_at is not null))
);

create unique index characters_one_alive_per_world
  on public.characters (world_id) where status = 'alive';
create index characters_world_id_idx on public.characters (world_id, created_at);
create index characters_user_id_idx on public.characters (user_id, created_at desc);   -- RLS

alter table public.worlds
  add constraint worlds_alive_character_fk
  foreign key (alive_character_id) references public.characters (id)
  on delete set null deferrable initially deferred;

create trigger characters_set_updated_at
  before update on public.characters
  for each row execute function private.set_updated_at();

-- permadeath: wiersz martwej postaci jest niezmienny, a przejście jest tylko alive -> dead
create function private.enforce_permadeath()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'dead' then
    raise exception 'character_dead_immutable' using errcode = 'P0001';
  end if;
  if new.world_id <> old.world_id or new.user_id <> old.user_id then
    raise exception 'character_identity_immutable' using errcode = 'P0001';
  end if;
  if new.days_survived < old.days_survived then
    raise exception 'days_survived_regression' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger characters_enforce_permadeath
  before update on public.characters
  for each row execute function private.enforce_permadeath();

alter table public.characters enable row level security;
revoke all on table public.characters from anon, authenticated;
grant select on table public.characters to authenticated;

create policy characters_select_own on public.characters
  for select to authenticated
  using ( (select auth.uid()) = user_id );
```

Martwe postacie zostają w bazie na zawsze, także po archiwizacji świata. To historia gracza („Przeżyte dni: 23, zabity przez hordę”). W multiplayerze `characters.user_id` to gracz, nie właściciel świata. Dojdzie wtedy tabela `world_members` z polityką przez funkcję `security definer` w `private`, żeby uniknąć rekursji RLS.

### 3.5 Funkcje zmian stanu (tylko `service_role`, wołane przez `apps/server`)

```sql
-- otwarcie świata: nowa sesja unieważnia poprzednią; niezamknięta sesja = unclean exit
create function public.open_world_session(p_world_id uuid, p_user_id uuid)
returns table (session_id uuid, revision integer, state_path text, state_sha256 text, unclean boolean)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  w public.worlds%rowtype;
  v_session uuid := gen_random_uuid();
begin
  select * into w from public.worlds
  where id = p_world_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'world_not_found' using errcode = 'P0001';
  end if;
  if w.status <> 'active' then
    raise exception 'world_archived' using errcode = 'P0001';
  end if;
  if w.session_id is not null and w.alive_character_id is not null then
    update public.characters c set unclean_exits = c.unclean_exits + 1
    where c.id = w.alive_character_id;
  end if;
  update public.worlds set session_id = v_session, session_opened_at = now()
  where id = w.id;
  return query select v_session, w.revision, w.state_path, w.state_sha256, (w.session_id is not null);
end;
$$;

-- zatwierdzenie nowego snapshotu zapisu (po uploadzie obiektu do Storage i walidacji w apps/server)
create function public.commit_world_state(
  p_world_id        uuid,
  p_user_id         uuid,
  p_session_id      uuid,
  p_base_revision   integer,
  p_reason          text,        -- 'day' | 'exit' | 'death' | 'new_character'
  p_state_path      text,
  p_size_bytes      integer,
  p_raw_size_bytes  integer,
  p_sha256          text,
  p_format_version  integer,
  p_sim_version     text,
  p_content_hash    text,
  p_game_tick       bigint,
  p_game_day        integer,
  p_character_id    uuid,
  p_character_dead  boolean,
  p_days_survived   integer,
  p_cause_of_death  text,
  p_stats           jsonb
)
returns table (new_revision integer, old_state_path text)
language plpgsql
set search_path = ''
as $$
declare
  w       public.worlds%rowtype;
  v_quota bigint;
  v_used  bigint;
begin
  if p_reason not in ('day', 'exit', 'death', 'new_character') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  -- najpierw profil (ta sama kolejność blokad co w triggerze limitu światów)
  select p.storage_quota_bytes into v_quota
  from public.profiles p where p.id = p_user_id and p.banned_at is null
  for update;
  if not found then
    raise exception 'account_unavailable' using errcode = 'P0001';
  end if;
  select * into w from public.worlds
  where id = p_world_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'world_not_found' using errcode = 'P0001';
  end if;
  if w.status <> 'active' then
    raise exception 'world_archived' using errcode = 'P0001';
  end if;
  if w.session_id is distinct from p_session_id then
    raise exception 'session_invalid' using errcode = 'P0001';     -- świat otwarty na innym urządzeniu
  end if;
  if w.revision <> p_base_revision then
    raise exception 'revision_conflict' using errcode = 'P0001';
  end if;
  if p_game_tick <= w.game_tick then
    raise exception 'game_time_not_advancing' using errcode = 'P0001';
  end if;
  if w.alive_character_id is null or w.alive_character_id is distinct from p_character_id then
    raise exception 'no_matching_alive_character' using errcode = 'P0001';
  end if;
  if p_character_dead <> (p_reason = 'death') then
    raise exception 'death_reason_mismatch' using errcode = 'P0001';
  end if;
  -- ostatnia linia obrony przed spamem (główny rate limit jest w apps/server)
  if p_reason = 'day' and w.state_updated_at > now() - interval '20 seconds' then
    raise exception 'too_frequent' using errcode = 'P0001';
  end if;
  select coalesce(sum(x.state_size_bytes), 0) into v_used
  from public.worlds x
  where x.user_id = p_user_id and x.id <> p_world_id and x.state_path is not null;
  if v_used + p_size_bytes > v_quota then
    raise exception 'storage_quota_exceeded' using errcode = 'P0001';
  end if;

  update public.characters c set
    days_survived  = p_days_survived,
    stats          = p_stats,
    status         = case when p_character_dead then 'dead' else 'alive' end,
    died_at        = case when p_character_dead then now() else null end,
    cause_of_death = case when p_character_dead then p_cause_of_death else null end
  where c.id = p_character_id and c.status = 'alive';

  update public.worlds x set
    revision             = w.revision + 1,
    state_path           = p_state_path,
    state_size_bytes     = p_size_bytes,
    state_raw_size_bytes = p_raw_size_bytes,
    state_sha256         = p_sha256,
    format_version       = p_format_version,
    sim_version          = p_sim_version,
    content_hash         = p_content_hash,
    game_tick            = p_game_tick,
    game_day             = p_game_day,
    state_updated_at     = now(),
    alive_character_id   = case when p_character_dead then null else w.alive_character_id end,
    -- wyjście i śmierć zamykają sesję
    session_id           = case when p_reason in ('exit', 'death') then null else w.session_id end
  where x.id = w.id;

  return query select w.revision + 1, w.state_path;
end;
$$;

-- nowa postać w istniejącym świecie (po śmierci poprzedniej); cechy waliduje apps/server z packages/content
create function public.create_character(
  p_world_id uuid, p_user_id uuid, p_name text, p_profession text, p_traits text[]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  w public.worlds%rowtype;
  v_id uuid;
begin
  select * into w from public.worlds
  where id = p_world_id and user_id = p_user_id and status = 'active'
  for update;
  if not found then
    raise exception 'world_not_found' using errcode = 'P0001';
  end if;
  if w.alive_character_id is not null then
    raise exception 'world_has_alive_character' using errcode = 'P0001';
  end if;
  insert into public.characters (world_id, user_id, name, profession, traits, born_game_day)
  values (w.id, p_user_id, p_name, p_profession, p_traits, w.game_day)
  returning id into v_id;
  update public.worlds set alive_character_id = v_id where id = w.id;
  return v_id;
end;
$$;

revoke execute on function public.open_world_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.commit_world_state(uuid, uuid, uuid, integer, text, text, integer,
  integer, text, integer, text, text, bigint, integer, uuid, boolean, integer, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.create_character(uuid, uuid, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.open_world_session(uuid, uuid) to service_role;
grant execute on function public.commit_world_state(uuid, uuid, uuid, integer, text, text, integer,
  integer, text, integer, text, text, bigint, integer, uuid, boolean, integer, text, jsonb)
  to service_role;
grant execute on function public.create_character(uuid, uuid, text, text, text[]) to service_role;
```

- Tworzenie świata (`insert worlds` + `create_character`) i archiwizacja (`status = 'archived'`, `state_path = null`, usunięcie obiektu) to proste operacje `apps/server` w transakcji lub RPC. Trigger limitu i constrainty pilnują reguł.
- Po `commit_world_state` serwer usuwa obiekt `old_state_path` ze Storage. Stary obiekt znika dopiero **po** commicie nowego wiersza, więc wiersz nigdy nie wskazuje na brakujący plik.
- Kolejność blokad jest zawsze taka sama: `profiles`, potem `worlds`, potem `characters` (brak deadlocków z triggerem limitu).

### 3.6 `public.world_audit`

```sql
create table public.world_audit (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  world_id    uuid,
  action      text not null check (action in ('create', 'import', 'open', 'commit', 'death',
                                              'new_character', 'archive', 'delete', 'reject')),
  size_bytes  integer,
  reason      text check (char_length(reason) <= 200),     -- np. 'revision_conflict', 'rate_limited'
  ip_hash     text,                                         -- HMAC(IP, sekret serwera)
  created_at  timestamptz not null default now()
);
create index world_audit_user_created_idx on public.world_audit (user_id, created_at desc);

alter table public.world_audit enable row level security;
revoke all on table public.world_audit from anon, authenticated;
-- brak polityk = brak dostępu dla klientów; pisze apps/server; retencja 90 dni
```

### 3.7 Storage: bucket `worlds`

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('worlds', 'worlds', false, 4194304, array['application/octet-stream']);
-- ŻADNYCH polityk na storage.objects dla klientów: upload tylko apps/server,
-- pobranie przez podpisany URL (60 s) wydany przy open_world_session.
```

- Ścieżka `{user_id}/{world_id}/r{revision}.dzsv` jest generowana wyłącznie przez serwer. W buckecie leży tylko bieżąca rewizja (plus przez chwilę nowa, przed commitem).
- Nie ma historii wersji dostępnej dla gracza. Czy trzymać jedną poprzednią rewizję tylko do ręcznego odzyskania przez admina po błędzie gry, to decyzja D14 (domyślnie: nie).
- `DELETE /v1/me` najpierw usuwa obiekty, potem `auth.admin.deleteUser`, a kaskada czyści resztę. Storage nie ma kaskady z `auth.users`.

## 4. Format zapisu

### 4.1 Koperta DZSV (wspólna dla IndexedDB i chmury, definicja w `packages/protocol`)

| Offset | Rozmiar | Pole |
|---|---|---|
| 0 | 4 | magic `DZSV` (ASCII) |
| 4 | 2 | `envelopeVersion` u16 LE (=1) |
| 6 | 2 | `flags` u16 (bit0 = gzip) |
| 8 | 4 | `headerLength` u32 LE (maks. 8 KiB) |
| 12 | N | nagłówek: JSON UTF-8 (schemat zod `SaveEnvelopeHeader`) |
| 12+N | reszta | payload: gzip(kanoniczny JSON `SaveStateV{formatVersion}`) |

Nagłówek: `{ formatVersion, simVersion, contentHash, mods: [{id, version}], worldId, seed, tick, gameDay, reason, rawSize, createdAt }`.
SHA-256 liczony z **całej koperty**. Klient wysyła go w nagłówku HTTP `X-Save-Sha256`, serwer liczy ponownie. To kontrola integralności, a nie zabezpieczenie przed cheatowaniem.

### 4.2 Serializacja stanu (`packages/sim`)

- `serializeState(world): SaveState` zwraca czyste dane:
  - stan RNG (rozszerzenie istniejącego `createRng` o serializację pozycji);
  - `tick`, dzień i czas gry;
  - encje ECS (bitecs) jako tablice komponentów z **trwałymi ID encji**;
  - `players: Record<characterId, PlayerState>` (ekwipunek, rany, umiejętności, moodle, pole `dead`), także w singleplayerze;
  - **diff chunków** względem mapy bazowej („seed + diff chunków”);
  - kolejka akcji czasowych.
- Bez funkcji, klas, `Date` i `Map` w stanie. Kanoniczny JSON daje stabilny hash w testach determinizmu.
- Ten sam `serializeState` służy do snapshotu zapisu i (w wersji przyciętej do obszaru) do snapshotu sieciowego w multiplayerze ([§6](#6-multiplayer-serwer-autorytatywny-i-snapshoty)).
- Kompresja: `CompressionStream('gzip')` w przeglądarce i `zlib` w Node. JSON jest na start. MessagePack można wprowadzić w nowej `formatVersion`, a koperta się nie zmienia.
- Budżet orientacyjny (do zmierzenia w etapie 7): świat demo po kilku dniach gry to rząd 50–500 KiB po gzipie. Świat rośnie z liczbą odwiedzonych chunków, stąd limit 4 MiB na świat i łączny limit na konto.

### 4.3 Migracje formatu

- `SAVE_FORMAT_VERSION` to liczba całkowita w `packages/sim`. `migrations/v{n}_to_v{n+1}.ts` to czyste funkcje, z fixture’ami dla każdej wersji i testem „stara wersja → migracja → wczytanie → N ticków”.
- `MIN_SUPPORTED_FORMAT_VERSION`: starsze zapisy dostają czytelny komunikat.
- Serwer przyjmuje **tylko `formatVersion` = bieżąca wersja serwera** (klient migruje przed zapisem). Nowszą odrzuca z `426`. Starszy snapshot w Storage zostaje, dopóki klient nie zapisze świata w nowym formacie. Migracja nie tworzy drugiej kopii.

## 5. API światów i walidacja

### 5.1 `apps/server` czy Edge Function

| Kryterium | `apps/server` (Node + Fastify) | Supabase Edge Function (Deno) |
|---|---|---|
| Współdzielenie `packages/sim` i `protocol` | Import z monorepo, ten sam runtime co testy | Możliwe, ale trzeba bundlować pod Deno. Ryzyko różnic runtime |
| Limity | Nasze (RAM i CPU VPS) | 256 MB RAM, **2 s CPU na żądanie**, 150 s idle timeout ([limity](https://supabase.com/docs/guides/functions/limits)) |
| Walidacja przez dry-run `deserializeState` | Tak, w `worker_threads` z timeoutem | Ryzyko przekroczenia 2 s CPU przy większych zapisach |
| Rate limit | `@fastify/rate-limit` w pamięci + `world_audit` | Trzeba trzymać stan w Postgresie przy każdym wywołaniu |
| Multiplayer (długie WebSockety, tick 20 Hz) | Tak, ten sam serwer | Nie (limit czasu życia workera) |
| Koszt | VPS/Fly od kilku USD/mies. | W cenie (500 tys. wywołań na Free, 2 mln na Pro) |
| Utrzymanie | Aktualizacje OS, TLS, deploy | Zero infrastruktury |

**Rekomendacja: `apps/server`.** Serwer i tak powstanie dla multiplayera, a dwie implementacje walidacji (Deno teraz, Node później) to podwójna praca i ryzyko rozjazdu. Edge Functions zostawiamy na drobne zadania bez `sim` (np. webhook), jeśli się pojawią.

### 5.2 Endpointy (wersjonowane `/v1`, schematy w `packages/protocol`; istniejący `GET /health` zostaje)

| Metoda i ścieżka | Opis |
|---|---|
| `GET /v1/worlds` | Lista światów i postaci (to samo co odczyt przez Data API z RLS) |
| `POST /v1/worlds` | Nowy świat + pierwsza postać `{ name, mapId, settings, character: { name, profession, traits } }`. Serwer nadaje `seed`, waliduje cechy i bilans punktów z `packages/content`, zwraca `{ worldId, characterId, seed, sessionId }` |
| `POST /v1/worlds/import` | Import świata lokalnego (DZSV + `importFingerprint`), raz na fingerprint |
| `POST /v1/worlds/:id/open` | Nowa sesja (unieważnia poprzednią) i podpisany URL (60 s) do **bieżącego** zapisu. Zwraca `{ sessionId, revision, downloadUrl, sha256, unclean }` |
| `PUT /v1/worlds/:id/state` | Nowy snapshot zapisu. Body DZSV. Nagłówki: `If-Match: <revision>`, `X-Session-Id`, `X-Save-Sha256`, `X-Save-Reason: day \| exit \| death \| new_character`. Zwraca `{ revision }` |
| `POST /v1/worlds/:id/characters` | Nowa postać po śmierci poprzedniej (`create_character` + `open_world_session`). Zwraca `{ characterId, sessionId }`, a pierwszy zapis idzie z `reason = new_character` |
| `POST /v1/worlds/:id/archive` | Zakończenie świata: usuwa snapshot, zostawia wiersz świata i historię postaci |
| `DELETE /v1/worlds/:id` | Trwałe usunięcie świata i postaci |
| `DELETE /v1/me` | Usunięcie konta i wszystkich danych (RODO) |

Nie ma endpointu do listowania ani pobierania starszych rewizji. Nie ma też „wczytaj zapis X”, bo istnieje tylko bieżący stan świata.

Kody: `400` (format), `401` (JWT), `403` (ban), `409` (`revision_conflict`, `session_invalid`, `world_has_alive_character`), `410` (świat zarchiwizowany), `413` (rozmiar, `storage_quota_exceeded`), `422` (walidacja sim, `no_matching_alive_character`, `game_time_not_advancing`), `426` (format), `429` (rate limit, `Retry-After`).

### 5.3 Kroki `PUT /v1/worlds/:id/state`

1. JWT przez JWKS (`jose`, `createRemoteJWKSet` na `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`): `iss`, `aud = authenticated`, `exp`, a `sub` to `user_id`. Nigdy nie bierzemy `user_id` z body.
2. Rate limit ([§5.5](#55-limity)), a potem limit body 4 MiB (także w Caddy) i SHA-256.
3. Parsowanie koperty (magic, wersje, nagłówek ≤ 8 KiB, zod). Nagłówek `worldId` musi równać się `:id`.
4. `zlib.gunzip({ maxOutputLength: 64 MiB })` (ochrona przed zip bombą), `JSON.parse`, zod na `SaveStateV{n}`.
5. Dry-run `deserializeState` w `worker_threads` (pula, timeout 1 s). Z **wczytanego stanu** serwer wyznacza:
   - `tick` i `gameDay`, które muszą zgadzać się z nagłówkiem;
   - postać gracza, której ID musi równać się `alive_character_id`;
   - `dead` oraz `days_survived`, `cause_of_death` i `stats` na ekran śmierci.
   Jeśli postać w stanie jest martwa, a `reason ≠ death`, żądanie jest odrzucane (i odwrotnie).
6. Upload do Storage pod `r{revision+1}`, potem `commit_world_state(...)`. Błąd oznacza usunięcie świeżego obiektu i odpowiedni kod. Sukces oznacza usunięcie starego obiektu.
7. Wpis w `world_audit` (także przy odrzuceniu).

### 5.4 Permadeath: śmierć, co dalej, wyjście

**Śmierć postaci:**
1. `sim` emituje `CharacterDied`. Klient zatrzymuje symulację, nadpisuje rekord lokalny stanem ze śmiercią i od razu wysyła `PUT …/state` z `reason = death`.
2. Serwer weryfikuje śmierć w stanie i w jednej transakcji ustawia `characters.status = 'dead'` (nieodwracalne, pilnuje tego trigger), `worlds.alive_character_id = null` i zamyka sesję.
3. Od tej chwili każdy zapis z tą postacią dostaje odmowę (`no_matching_alive_character`). Jeśli wysyłka się nie uda (offline), klient ponawia ją przy następnym połączeniu. Lokalnie świat jest już zablokowany jako „postać nie żyje”.
4. Klient pokazuje ekran śmierci (przeżyte dni i statystyki z `characters`).

**Co dalej ze światem (propozycja, decyzja D13):**
- Domyślnie **świat trwa**, a gracz może zacząć nową postacią w tym samym świecie (`POST …/characters`), jak w Project Zomboid. Nowa postać startuje w nowym miejscu spawnu, a ciało poprzedniej (jako zombie lub zwłoki z ekwipunkiem) zostaje w stanie świata. To naturalna, uczciwa „druga szansa” bez cofania czasu. Dzień gry i stan świata idą dalej.
- Alternatywnie **„Zakończ świat”** (`archive`) usuwa snapshot, a zostaje historia postaci. Zwalnia to miejsce w limicie.
- Tryb **Hardcore** (ustawienie świata, opcja na później): śmierć automatycznie archiwizuje świat.

**Wyjście i sesje (anty-save-scumming):**
- „Zapisz i wyjdź” wysyła `reason = exit` i zamyka sesję.
- Otwarcie świata z niezamkniętą sesją (zamknięta karta, crash albo celowe przerwanie tuż przed śmiercią) wczytuje ostatni zapis, ale zwiększa `characters.unclean_exits`. Licznik jest widoczny na karcie postaci i ekranie śmierci („Przerwane sesje: 2”). To transparentność zamiast kary, bo crashe się zdarzają (D15).
- Otwarcie świata na drugim urządzeniu unieważnia sesję pierwszego. Stare urządzenie dostaje `409 session_invalid` i nie może „rozwidlić” świata.
- Gra offline w świecie z chmury jest dozwolona tylko na bieżącej sesji i rewizji. Zapis przejdzie, jeśli na serwerze nic się w międzyczasie nie zmieniło (`If-Match`). W przeciwnym razie wygrywa serwer, a lokalny postęp przepada (D16).

**Autozapis:**
- `sim` emituje `DayStarted`, a klient zapisuje lokalnie i do chmury (`reason = day`).
- Koalescencja: najwyżej 1 autozapis na 60 s czasu rzeczywistego. Przy śnie lub przyspieszaniu czasu, gdy mija kilka dni w kilka sekund, zapis idzie po przebudzeniu.
- Zapis nieudany (sieć, 429) zostaje w kolejce i jest ponawiany. Lokalny rekord jest zawsze aktualny.

### 5.5 Limity

Startowe wartości, konfigurowalne w env serwera. Rozmiar i liczba światów są też w constraintach bazy.

| Limit | Wartość | Uzasadnienie |
|---|---|---|
| Aktywne światy na konto | 20 (miękki, `profiles.max_active_worlds`, admin może podnieść) | Wyłącznie ochrona przed masowym zakładaniem światów. Zarchiwizowane się nie liczą |
| Łączny rozmiar bieżących zapisów na konto | 50 MiB (`profiles.storage_quota_bytes`) | Realny limit kosztowy: około 100 światów po 0,5 MiB |
| Snapshot po kompresji / po rozpakowaniu | 4 MiB / 64 MiB | Świat rośnie z odkrytą mapą |
| Zapisy per świat | Kubełek 3, uzupełnianie 1/min. `death` i `exit` zawsze przechodzą (raz na sesję lub postać). W bazie min. 20 s między `day` | Autozapis co dzień gry (D12: długość dnia) plus zapas na wyjście i śmierć |
| Zapisy per konto | 120 na godzinę, 200 MiB wgranych na dobę | Kilka światów równolegle na kilku kartach to i tak jedna sesja na świat |
| `open` per konto | 60 na godzinę | Każde otwarcie to podpisany URL i egress |
| Nowe światy i importy per konto | 10 na dobę | Ochrona przed spamem |
| Żądania z IP | 300 na 5 min | Niezależnie od konta |

Szacunek obciążenia: przy dniu gry = 1 h czasu rzeczywistego (domyślna długość dnia w Project Zomboid, D12) aktywny gracz robi około 1–3 zapisy na godzinę, czyli pomijalny ruch.

### 5.6 Granice ochrony przed save-scummingiem

W singleplayerze symulacja działa u klienta, więc serwer **nie może** zagwarantować uczciwości. Zapewnia natomiast, że:
- w chmurze istnieje tylko jeden bieżący stan świata, bez żadnej ścieżki do starszych wersji;
- czas gry i rewizja tylko rosną, a zapis po śmierci jest niemożliwy;
- dwa urządzenia nie rozwidlą świata, a nieczyste wyjścia są liczone i widoczne.

Czego nie zatrzymamy: ręcznego kopiowania danych przeglądarki, edycji zapisu, blokowania wysyłki śmierci i ponownego otwarcia (to ostatnie zostawia ślad w `unclean_exits`). Pełna gwarancja permadeath i wszelkie rankingi wymagają **serwera autorytatywnego** ([§6](#6-multiplayer-serwer-autorytatywny-i-snapshoty)). Dlatego rankingi i tryb „Ranked Hardcore” są wyłącznie na serwerze.

### 5.7 Ochrona przed nadużyciami i bezpieczeństwo

- **Secret key tylko w env `apps/server`**, nigdy w kliencie, repo ani logach. W kliencie jest wyłącznie publishable key. Rotacja przy każdym podejrzeniu wycieku.
- CORS: whitelist domen gry. HTTPS wszędzie (Caddy i Let's Encrypt). Nagłówki bezpieczeństwa.
- Bez zaufania do klienta:
  - `user_id` bierzemy z JWT, a ścieżki w Storage nadaje serwer;
  - `seed` przy tworzeniu świata nadaje serwer;
  - statystyki, śmierć i czas gry wylicza serwer ze stanu;
  - cechy i bilans punktów walidujemy z `packages/content`.
- Stan zmieniają wyłącznie funkcje SQL z `execute` tylko dla `service_role`. Klienci nie mają grantów zapisu na żadną tabelę.
- CAPTCHA na Auth, rate limity Auth, własny SMTP z DKIM, SPF i DMARC.
- Supabase: Security Advisor i Performance Advisor przed każdym wydaniem, testy pgTAP RLS i permadeath w CI, MFA na koncie, SSL enforcement. Network restrictions ograniczamy do IP VPS, jeśli `apps/server` łączy się z Postgresem bezpośrednio.
- Sentry: scrubbing `Authorization`, cookies, emaili i IP. Bez body zapisów w eventach.
- RODO: minimum danych (email, `display_name`), region UE, polityka prywatności (wymagana też przez Google OAuth), usunięcie konta z profilu (`DELETE /v1/me`).
- Backupy: **Free nie ma automatycznych backupów** ([checklista produkcyjna](https://supabase.com/docs/guides/deployment/going-into-prod)). Do czasu Pro robimy cotygodniowy, szyfrowany `pg_dump` z serwera. Backupy bazy nie są drogą do cofania zapisów graczy (tylko awarie, decyzja admina).

## 6. Multiplayer: serwer autorytatywny i snapshoty

### 6.1 Kto ma autorytet

| | Singleplayer (etapy 1–9) | Multiplayer (po demo) |
|---|---|---|
| Gdzie działa symulacja prawdy | Klient (Web Worker) | **Tylko `apps/server/realtime`** |
| Co klient wysyła | Snapshoty zapisu (DZSV) przy autozapisie, wyjściu i śmierci | Wyłącznie komendy (`CommandBatch`) |
| Co klient dostaje | Bieżący snapshot zapisu przy otwarciu świata | Snapshoty sieciowe (pełny + delty) |
| Kto decyduje o śmierci | Klientowy `sim`, a serwer weryfikuje stan | Serwerowy `sim`, bez udziału klienta |
| Kto utrwala świat | `apps/server/http` po walidacji | `apps/server/realtime` sam, na tych samych funkcjach (`commit_world_state`) |
| Permadeath i rankingi | Best effort ([§5.6](#56-granice-ochrony-przed-save-scummingiem)) | Gwarantowane |

Ten sam `packages/sim` działa po obu stronach. W multiplayerze klient uruchamia go tylko do **predykcji ruchu własnej postaci** i interpolacji. Jego wynik nie jest źródłem prawdy.

### 6.2 Pętla serwera

- **Tick 20 Hz** (`TICK_RATE_HZ` z `packages/sim`). Klient wysyła `CommandBatch { seq, clientTick, commands[] }`. Serwer przypisuje komendy do najbliższego przyszłego ticku, a `sim` waliduje każdą (np. zasięg, stamina, czy przedmiot istnieje). Nieprawidłowe są odrzucane. Serwer potwierdza `ackSeq`.
- Kolejność w ticku: zbierz komendy, `step(world, commands)`, zdarzenia (`CharacterDied`, `DayStarted`), snapshoty sieciowe do klientów.
- `CharacterDied` od razu zapisuje świat (`commit_world_state` z `reason = death` dla tej postaci). Gracz dostaje ekran śmierci i może dołączyć nową postacią.
- `DayStarted` wywołuje autozapis świata **przez serwer** (ta sama koperta DZSV, ten sam bucket, `worlds.mode = 'mp'`). Serwerowy zapis nie zależy od klientów. Sesja świata należy wtedy do procesu serwera, a nie do urządzenia gracza.

### 6.3 Snapshoty sieciowe

- **Pełny** przy dołączeniu: `serializeState` przycięty do **obszaru zainteresowania** (chunki wokół gracza) plus stan własnej postaci.
- **Delta** w każdym ticku (albo co 2–3 ticki przy obciążeniu) względem ostatniego snapshotu **potwierdzonego** przez klienta (`ackTick`). Brak potwierdzenia przez N ticków skutkuje nowym pełnym snapshotem.
- Klient: rekonsyliacja własnej postaci (cofnięcie do stanu serwera i ponowne zastosowanie niepotwierdzonych komend), interpolacja pozostałych encji o 1–2 ticki wstecz.
- Kodowanie: JSON na start, potem binarny (MessagePack lub własny) za `PROTOCOL_VERSION`. Snapshot sieciowy nigdy nie trafia do bazy, a snapshot zapisu nigdy nie idzie przez WebSocket.

### 6.4 Transport i auth

- **WebSocket** (`ws` albo `uWebSockets.js`), osobny proces `realtime`. Colyseus czy własna warstwa to decyzja D8. Rekomenduję własną cienką warstwę, bo stan i serializację mamy w `sim`.
- Przeglądarka nie ustawi nagłówka w WebSocket, a tokenu w URL nie chcemy (trafia do logów). Pierwsza wiadomość to `hello { accessToken, protocolVersion, simVersion, contentHash, worldId }` w ciągu 5 s, weryfikowana przez JWKS jak w HTTP. Przed `exp` klient wysyła `reauth`, inaczej serwer rozłącza. Niezgodna wersja lub content daje czytelny błąd.
- Dostęp do świata daje członkostwo (`world_members`, dojdzie z multiplayerem) i sprawdza go serwer.

### 6.5 Co musi być w kodzie od etapu 1 (żeby nie przepisywać)

1. Cały wpływ na stan idzie przez komendy z `playerId`/`characterId`, także w singleplayerze. Jedna funkcja `step(world, commandsForTick)`.
2. Brak `Math.random`, `Date.now` i `performance.now` w `sim` (reguła ESLint). RNG pochodzi z `createRng` w stanie. Unikamy zależności wyniku od funkcji, które mogą różnić się między silnikami JS.
3. Stan jako dane z trwałymi ID encji. `serializeState` obsługuje zapis, pełny snapshot sieciowy i testy. Przycinanie do obszaru i delty to osobna warstwa nad nim.
4. `world` oddzielony od `players[characterId]`, a śmierć i dzień jako zdarzenia `sim`, a nie logika UI.
5. `packages/protocol`: wersjonowane schematy zod (`PROTOCOL_VERSION`, `SAVE_FORMAT_VERSION`, `Command`, `CommandBatch`, `NetSnapshot`), zmiany tylko kompatybilne wstecz.
6. Test determinizmu w CI: seed + log komend dają ten sam hash stanu po N tickach w Node i w przeglądarce.
7. `apps/server`: moduły `auth/` (JWKS) i `worlds/` oraz miejsce na `realtime/`. Tick nigdy nie dzieli procesu z ciężką walidacją zapisów.

## 7. Hosting i koszty

Ceny w USD netto (Supabase i inni mogą doliczać VAT), sprawdzone 30.09.2026. **Ceny się zmieniają, a promocje wygasają.** Przed zakupem trzeba je sprawdzić na stronach źródłowych.

### 7.1 Supabase ([pricing](https://supabase.com/pricing), [billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [FAQ](https://supabase.com/docs/guides/platform/billing-faq))

| | Free | Pro |
|---|---|---|
| Cena | 0 | od 25 USD/mies. za organizację, w tym 10 USD kredytów compute (1× Micro). **Każdy kolejny projekt to +10 USD** (Micro) |
| Baza | 500 MB na projekt | 8 GB dysku na projekt, potem 0,125 USD/GB |
| Storage | 1 GB, maks. 50 MB na plik | 100 GB, potem 0,0213 USD/GB |
| Egress | 5 GB (na **organizację**) | 250 GB, potem 0,09 USD/GB |
| MAU | 50 000 | 100 000, potem 0,00325 USD/MAU |
| Pauzowanie | po 1 tygodniu nieaktywności | nigdy |
| Backupy | brak | dzienne, 7 dni |
| Ochrona przed wyciekniętymi hasłami | brak | jest |
| Limit projektów | 2 aktywne darmowe **na konto** (liczone we wszystkich organizacjach, gdzie jesteś Owner/Admin) | bez limitu (każdy projekt płatny) |
| Spend cap | nie dotyczy | domyślnie włączony (ochrona kosztów) |

Stan konta (sprawdzony read-only): organizacja `cursor2026` jest na planie **Free**, a `get_cost` dla nowego projektu zwraca 0 USD/mies. Liczby aktywnych projektów nie sprawdzałem, patrz D1.

### 7.2 Hosting `apps/server`

| Opcja | Cena (źródło) | Plusy | Minusy |
|---|---|---|---|
| **Hostinger VPS KVM 1** (1 vCPU, 4 GB RAM, 50 GB NVMe) | 6,49 USD/mies. w promocji (**płatne z góry** za okres), odnowienie 11,99 USD/mies. ([hostinger.com/vps-hosting](https://www.hostinger.com/vps-hosting)) | Stała cena bez niespodzianek, dużo RAM, Docker, cotygodniowe backupy, Paweł ma konto (i MCP do zarządzania) | Samodzielna administracja: aktualizacje, firewall, TLS. Zobowiązanie na okres |
| Hostinger VPS KVM 2 (2 vCPU, 8 GB) | 8,99 USD/mies. promo, odnowienie 14,99 USD/mies. (j.w.) | Zapas pod multiplayer | j.w. |
| Fly.io shared-cpu-1x 256 MB / shared-cpu-2x 512 MB | 1,94 / 3,89 USD/mies. (region bazowy), **od 1.10.2026 2,19 / 4,39 USD**. Frankfurt ×1,154. Egress EU 0,02 USD/GB. Wymagana karta ([fly.io/pricing](https://fly.io/pricing/), [aktualizacja cen](https://fly.io/pricing-update/), [docs](https://fly.io/docs/about/pricing/)) | Zarządzany TLS i deploy z Dockera, blisko użytkowników, płatność za użycie | Rachunek zależy od użycia, 256 MB to mało na walidację w workerach, ceny RAM właśnie rosną |
| Railway Hobby | 5 USD/mies. z 5 USD użycia; RAM ≈10 USD/GB/mies., CPU ≈20 USD/vCPU/mies., egress 0,05 USD/GB ([railway.com/pricing](https://railway.com/pricing)) | Najprostszy deploy | Przy stałym procesie 1 GB RAM wychodzi drożej niż VPS. Rachunek zależy od użycia |

**Rekomendacja:** Hostinger VPS KVM 1 w centrum danych w UE: Docker Compose (`apps/server` + Caddy), SSH tylko po kluczu, firewall z portami 22/80/443, automatyczne aktualizacje bezpieczeństwa. Przy multiplayerze skalujemy do KVM 2 albo stawiamy osobną maszynę pod `realtime`. Jeśli nikt nie chce administrować VPS, wybieramy Fly.io shared-cpu-2x 512 MB (region `fra` lub `ams`) z alertem kosztowym.
Front (`apps/web`, `apps/game`) to statyczne pliki: Hostinger, Cloudflare Pages albo Vercel (decyzja Silnika i Szefa sztabu; tych cenników tu nie sprawdzałem).

### 7.3 Sentry ([sentry.io/pricing](https://sentry.io/pricing/))

- Developer: 0 USD, 1 użytkownik. Limit to 5 000 błędów/mies. według zewnętrznych zestawień ([last9](https://last9.io/blog/sentry-pricing/), [costbench](https://costbench.com/software/developer-tools/sentry/free-plan/)); na oficjalnej stronie tego nie potwierdziłem. Po przekroczeniu eventy są odrzucane, nie ma dopłat.
- Team: 26 USD/mies. przy płatności rocznej (50 tys. błędów, wielu użytkowników).
- Rekomendacja: Developer na demo, z sample rate dla tracingu, bez session replay na start i z uploadem source map w CI (token jako sekret CI).

### 7.4 Wpływ modelu światów na Storage i egress

- Rośnie liczba zapisów (autozapis co dzień gry), ale **nie** rośnie zajętość, bo jest jeden bieżący snapshot na świat, a stary obiekt jest usuwany po commicie. Supabase nie nalicza opłat za operacje Storage, tylko za rozmiar i egress ([pricing](https://supabase.com/pricing)).
- Upload z `apps/server` do Supabase to ruch przychodzący dla Supabase. Po stronie hostingu to wyjście: Hostinger KVM 1 ma 4 TB transferu, a na Fly.io 100 aktywnych graczy × 3 zapisy/h × 1 MiB × 3 h dziennie to około 27 GB/mies., czyli około 0,54 USD przy 0,02 USD/GB.
- Egress Supabase to głównie pobranie snapshotu przy `open` (0,5–4 MiB). 1 000 otwarć to około 0,5–4 GB, więc Free (5 GB na organizację) wystarczy na testy, a Pro (250 GB) z dużym zapasem.
- Pojemność przy limicie 50 MiB na konto:
  - Free (1 GB Storage): typowo (1–3 światy po około 0,5 MiB) kilkaset kont. W najgorszym przypadku (każdy wyczerpuje limit) około 20 kont.
  - Pro (100 GB): w najgorszym przypadku około 2 000 kont, typowo kilkadziesiąt tysięcy.
  - Wniosek się nie zmienia: przed publicznym demo trzeba przejść na Pro.

### 7.5 Scenariusze miesięczne (szacunek, ± niepewność cen i VAT)

| Scenariusz | Supabase | `apps/server` | Sentry | Razem |
|---|---|---|---|---|
| A. Dev (teraz, etapy 0–7) | 0 (lokalnie `supabase start`) | 0 (lokalnie) | 0 | **0 USD** |
| B. Zamknięte testy etapu 8/9 (< 100 osób) | 0 (Free, ryzyko pauzy, brak backupów, więc własny `pg_dump`) | 6,49 (KVM 1 promo) lub około 4,4–5 (Fly 512 MB, fra) | 0 | **około 5–12 USD** |
| C. Publiczne demo | 25 (Pro, 1 projekt Micro w organizacji gry) | 6,49–11,99 (KVM 1) | 0 | **około 31–37 USD** (+ SMTP, domena) |
| D. Multiplayer (testy) | 25 | 8,99–14,99 (KVM 2) | 0–26 | **około 34–66 USD** |

Model światów nie zmienia tych kwot w skali testów i demo. Ryzyko kosztowe pilnuje łączny limit rozmiaru na konto i spend cap w Pro.

## 8. Decyzja: osobny projekt Supabase czy współdzielony

| Kryterium | Współdzielenie `cpydztktoszrnlqiubqf` | Osobny projekt (rekomendacja) |
|---|---|---|
| Użytkownicy | `auth.users` wspólne dla dwóch produktów: jeden Site URL, jedne szablony maili, jeden ekran zgody Google, jeden SMTP i te same rate limity | Osobna baza kont, własny branding maili i Google OAuth |
| Bezpieczeństwo | Błąd RLS, wyciek secret key albo zła migracja uderza w oba produkty. Secret key `apps/server` dawałby dostęp do danych innego produktu | Promień rażenia ograniczony do gry |
| Migracje i deploy | Dwa zespoły na jednym schemacie, ryzyko konfliktów | Niezależne `supabase/migrations` |
| Limity Free | 500 MB bazy, 1 GB Storage i 5 GB egressu dzielone z drugim produktem | Baza i Storage per projekt. **Egress per organizacja**, więc osobna organizacja izoluje także egress |
| Pauzowanie i usuwanie | Nie da się pauzować ani usunąć gry niezależnie | Niezależnie |
| Koszt Free | 0, nie zajmuje drugiego slotu | 0, ale **zajmuje drugi z 2 darmowych aktywnych projektów na koncie** |
| Koszt Pro | 25 USD łącznie | Osobna org Pro dla gry: 25 USD. Druga organizacja (produkt Pawła) może zostać na Free. Oba projekty w jednej org Pro kosztowałyby 35 USD, a drugi produkt musiałby też przejść na Pro, bo planów nie da się mieszać w organizacji |

**Rekomendacja:** osobny projekt `deadzone-prod` w **nowej organizacji** `deadzone`, region UE (np. Frankfurt `eu-central-1`, decyzja D2).
- Na etapach 0–7 projekt w chmurze nie jest potrzebny: developujemy na lokalnym Supabase (`supabase start`, Docker), a migracje i testy RLS idą w CI. Projekt zakładamy dopiero na początku etapu 8, więc slot Free nie jest zajęty i projekt nie pauzuje się miesiącami bez sensu.
- Przed publicznym demo organizacja gry przechodzi na Pro (backupy, brak pauzowania, 100 GB Storage, ochrona haseł) ze **spend capem włączonym**. Drugi produkt zostaje nietknięty w swojej organizacji.
- Jeśli oba darmowe sloty na koncie są zajęte, mamy trzy opcje: zapauzować nieużywany projekt, iść od razu w Pro dla organizacji gry albo (awaryjnie i tymczasowo) użyć osobnego schematu w istniejącym projekcie. Tej ostatniej opcji nie rekomenduję (patrz tabela).
- Nie stosujemy „pingów utrzymujących projekt Free przy życiu”. Jeśli pauzowanie przeszkadza, to sygnał do przejścia na Pro.

## 9. Otwarte decyzje (dla Pawła / Szefa sztabu)

Model światów, permadeath i autozapis co dzień gry są **przyjęte** (zasady Szefa sztabu, 30.09.2026). Poniżej zostaje to, co jeszcze otwarte.

| # | Decyzja | Rekomendacja | Kto |
|---|---|---|---|
| D1 | Osobny projekt w nowej organizacji `deadzone` i sprawdzenie, czy na koncie jest wolny slot Free | Tak, projekt założyć na starcie etapu 8 | Paweł |
| D2 | Region danych | UE (Frankfurt) | Paweł |
| D3 | *(zamknięta)* Klient nie zapisuje ani nie usuwa niczego bezpośrednio | Wszystko przez `apps/server` | – |
| D4 | Metody logowania: email OTP + Google, bez haseł i bez anonimowych kont | Tak | Paweł |
| D5 | Dostawca SMTP (Resend / Postmark / SES / Brevo) i domena nadawcy | Wybrać po sprawdzeniu cenników, osobna subdomena `auth.` | Paweł + Serwer |
| D6 | Domena gry (landing, API `api.`, auth) | Do ustalenia | Paweł |
| D7 | Hosting `apps/server`: Hostinger VPS (nowy czy istniejący?) vs Fly.io | Hostinger KVM 1, EU | Paweł |
| D8 | Multiplayer: własna warstwa WS vs Colyseus | Własna cienka warstwa na `sim` | Serwer + Symulacja |
| D9 | Limity: 20 aktywnych światów (miękki), 50 MiB na konto, 4 MiB na snapshot, kubełek 3 + 1/min na świat | Jak w [§5.5](#55-limity), korekta po pomiarach z etapu 7 | Szef sztabu |
| D10 | Kiedy przejść na Supabase Pro | Przed pierwszym publicznym udostępnieniem (etap 9) | Paweł |
| D11 | `display_name` unikalne czy nie | Nieunikalne na start | Szef sztabu |
| D12 | Długość dnia gry w czasie rzeczywistym (wpływa na częstotliwość autozapisu) | 1 h jak domyślnie w PZ, do ustalenia w GDD | Szef sztabu + Symulacja |
| D13 | Co po śmierci postaci | Świat trwa, nowa postać w tym samym świecie albo „Zakończ świat”. Tryb Hardcore (auto-archiwizacja) później | Paweł |
| D14 | Czy trzymać 1 poprzednią rewizję tylko do odzyskania przez admina po błędzie gry | Nie na start (prostota, zero ścieżki do cofania) | Szef sztabu |
| D15 | Nieczyste wyjście: tylko licznik `unclean_exits` czy kara | Tylko licznik, widoczny na ekranie śmierci | Paweł |
| D16 | Gra offline w świecie z chmury | Tak, na bieżącej sesji. Konflikt oznacza, że wygrywa serwer | Szef sztabu |
| D17 | Sentry Developer (1 użytkownik) vs Team | Developer do demo | Paweł |

## 10. Plan wdrożenia

Legenda: **[ZGODA]** oznacza krok wymagający wyraźnej zgody Pawła (zmiany w Supabase lub produkcji, koszty, konta zewnętrzne). Bez oznaczenia są prace w repo, przez PR z review.

1. Zatwierdzenie tego dokumentu i decyzji z [§9](#9-otwarte-decyzje-dla-pawła--szefa-sztabu).
2. `packages/protocol`: schematy zod koperty DZSV, typy API światów, `CommandBatch` i `NetSnapshot` (szkic).
3. `packages/sim`: `serializeState`, `deserializeState`, `SAVE_FORMAT_VERSION`, migracje, zdarzenia `CharacterDied` i `DayStarted`, fixture’y i test determinizmu. Lokalny zapis IndexedDB z etapu 7 od razu używa DZSV i modelu „1 rekord na świat”.
4. `supabase/` w repo: `config.toml`, migracje z §3, testy pgTAP (RLS, granty, permadeath, monotoniczność, limity). Uruchamiane **wyłącznie lokalnie** (`supabase start`, `supabase test db`) i w CI na efemerycznej bazie.
5. `apps/server`: moduły `auth` (JWKS) i `worlds` (walidacja w `worker_threads`, limity, audyt), testy integracyjne na lokalnym Supabase.
6. **[ZGODA]** Utworzenie organizacji `deadzone` i projektu `deadzone-prod` (Free, region UE). Koszt 0 USD, ale zajmuje slot Free.
7. **[ZGODA]** Konfiguracja Auth: Google OAuth, własny SMTP, CAPTCHA, redirect URLs, rate limity, asymetryczne klucze JWT.
8. **[ZGODA]** Zastosowanie migracji na `deadzone-prod` (z CI po review), potem Security Advisor i Performance Advisor.
9. **[ZGODA]** VPS Hostinger albo Fly.io, DNS `api.<domena>`, sekrety na serwerze.
10. **[ZGODA]** Pierwszy deploy `apps/server` i smoke test: konto, nowy świat, gra, autozapis, wyjście, powrót z innego komputera, śmierć i nowa postać.
11. **[ZGODA]** Sentry i cotygodniowy `pg_dump`, dopóki jest Free.
12. **[ZGODA]** Przejście organizacji `deadzone` na Pro (25 USD/mies., spend cap włączony) przed publicznym demo.
13. Później (po demo): `apps/server/realtime` (serwer autorytatywny, [§6](#6-multiplayer-serwer-autorytatywny-i-snapshoty)), `world_members`, **[ZGODA]** na dodatkowy hosting.

## 11. Źródła

- Supabase pricing: https://supabase.com/pricing
- Supabase billing (limit 2 darmowych projektów na konto, planów nie da się mieszać w organizacji): https://supabase.com/docs/guides/platform/billing-on-supabase, https://supabase.com/docs/guides/platform/billing-faq
- Supabase RLS (granty, `(select auth.uid())`, indeksy, `security definer`, testy pgTAP): https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase production checklist (rate limity Auth, SMTP, CAPTCHA, backupy Free): https://supabase.com/docs/guides/deployment/going-into-prod
- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase passwordless (magic link / OTP): https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase JWT / `getClaims` / JWKS: https://supabase.com/docs/reference/javascript/auth-getclaims, https://supabase.com/docs/guides/auth/signing-keys
- Supabase Edge Functions limits: https://supabase.com/docs/guides/functions/limits
- Fly.io: https://fly.io/pricing/, https://fly.io/pricing-update/, https://fly.io/docs/about/pricing/
- Railway: https://railway.com/pricing
- Hostinger VPS: https://www.hostinger.com/vps-hosting
- Sentry: https://sentry.io/pricing/
