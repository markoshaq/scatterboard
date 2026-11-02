import type { Doc, ID } from '../state/schema';

export type Lang = 'en' | 'es' | 'fr' | 'pt' | 'de';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY';

// Local preferences ride on the workspace record; additive since
// version 1, loaders must default them for old saves.
export interface Prefs {
  theme?: 'light' | 'dark';
  uiScale?: number;
  welcomed?: boolean;
  lang?: Lang;
  // Formatting: table number/currency/datetime cells. browserLang on
  // (default) uses the navigator locale; off uses the lang pref.
  browserLang?: boolean;
  currency?: Currency;
  // Canvas behaviour toggles.
  noOverlap?: boolean;
  ink?: boolean;
  undoArrows?: boolean;
  // Alignment-guide stroke opacity: 1 full, 0.5 faint, 0 hidden.
  guideAlpha?: number;
  // Create-palette customization: display order (item keys) and hidden
  // keys. Missing order keys append at the end.
  railOrder?: string[];
  railHidden?: string[];
  // One-time helper offers that were already shown, keyed
  // 'doc:<elementId>' / 'title:<elementId>'.
  helpers?: Record<string, true>;
  // Comment unread badges: comment element id -> items seen.
  commentSeen?: Record<ID, number>;
  // Recently viewed board ids, most recent first.
  recentBoards?: ID[];
  // Online extra (off by default): fetch link-card previews.
  unfurl?: boolean;
}

export interface PersistedWorkspace {
  version: number;
  doc: Doc;
  savedAt: number;
  prefs?: Prefs;
}

// Implemented by localStorage and the sqlite worker adapter.
export interface StorageAdapter {
  load(): Promise<PersistedWorkspace | null>;
  save(w: PersistedWorkspace): Promise<void>;
}

// The app's full adapter surface: storage plus the size meter and the
// last-board pointer. SqliteAdapter keeps both in kv rows cached in
// memory so these stay synchronous.
export interface DocStorage extends StorageAdapter {
  docBytes(): number;
  lastBoard(): string | null;
  setLastBoard(id: string): void;
  // Small per-board position write so pan/zoom never triggers a full
  // doc serialize. Rows are reapplied over doc.boards on load.
  saveBoardPos(id: string, pos: { x: number; y: number; z: number }): Promise<void> | void;
  clear(): Promise<void>;
}
