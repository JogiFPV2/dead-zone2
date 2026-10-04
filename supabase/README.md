# Supabase (Deadzone)

Migracje bazy gry (docs/backend.md §3). **Tylko pliki**: nie stosujemy ich na żadnym hostowanym
projekcie bez wyraźnej zgody Pawła (docs/backend.md §10, krok 8).

- `migrations/20261004120000_characters_and_saves.sql`: `profiles` (trigger przy rejestracji),
  `characters`, `saves`, RLS (właściciel tylko czyta), funkcje `commit_save`,
  `mark_character_dead`, `account_save_bytes` (tylko `service_role`), prywatny bucket `saves`.
- `migrations/20261004180000_delete_character_and_account.sql`: `delete_character` (postać lub
  nagrobek razem z zapisem) i `delete_account_data` (RODO: wszystkie postacie, zapisy i profil),
  tylko `service_role`.
- Test: `apps/server/src/migrations.test.ts` uruchamia migracje na PGlite z zaślepkami `auth` i
  `storage`.
- Lokalnie z Supabase CLI: `supabase start`, potem `supabase db reset`.
