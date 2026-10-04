import type { CharacterRow, SaveRow } from './types.js';

/** supabase-js schema types for the tables and functions of supabase/migrations. */
/** Mapped copy: supabase-js needs type aliases (index-signature compatible), not interfaces. */
type Plain<T> = { [K in keyof T]: T[K] };

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null; created_at: string };
        Insert: { id: string; display_name?: string | null };
        Update: { display_name?: string | null };
        Relationships: [];
      };
      characters: {
        Row: Plain<CharacterRow>;
        Insert: Plain<
          Omit<
            CharacterRow,
            'id' | 'status' | 'days_survived' | 'created_at' | 'last_played_at' | 'died_at'
          >
        >;
        Update: Plain<Partial<Pick<CharacterRow, 'name' | 'appearance' | 'world_settings'>>>;
        Relationships: [];
      };
      saves: {
        Row: Plain<SaveRow>;
        Insert: Plain<Omit<SaveRow, 'updated_at'>>;
        Update: Plain<Partial<Omit<SaveRow, 'character_id' | 'updated_at'>>>;
        Relationships: [
          {
            foreignKeyName: 'saves_character_id_fkey';
            columns: ['character_id'];
            isOneToOne: true;
            referencedRelation: 'characters';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      account_save_bytes: { Args: { p_user: string }; Returns: number };
      commit_save: {
        Args: {
          p_user: string;
          p_character: string;
          p_expected_version: number;
          p_storage_path: string;
          p_size_bytes: number;
          p_checksum: string;
          p_game_day: number;
        };
        Returns: { version: number; previous_path: string | null }[];
      };
      mark_character_dead: {
        Args: { p_user: string; p_character: string; p_days_survived: number };
        Returns: { storage_path: string | null; died_at: string }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
