import type { PersistedWorkspace, StorageAdapter } from './storage';

// Storage keys keep the planboard name for data continuity.
const KEY = 'planboard:v1';
const LAST_BOARD = 'planboard:last-board';

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<PersistedWorkspace | null> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as PersistedWorkspace) : null;
    } catch {
      return null;
    }
  }

  async save(w: PersistedWorkspace): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(w));
  }

  // localStorage doc size for the settings storage meter.
  docBytes(): number {
    const raw = localStorage.getItem(KEY);
    return raw ? new Blob([raw]).size : 0;
  }

  lastBoard(): string | null {
    return localStorage.getItem(LAST_BOARD);
  }

  setLastBoard(id: string) {
    localStorage.setItem(LAST_BOARD, id);
  }
}
