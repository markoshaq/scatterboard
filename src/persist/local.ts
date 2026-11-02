import type { PersistedWorkspace, StorageAdapter } from './storage';

// Storage keys keep the planboard name for data continuity.
const KEY = 'planboard:v1';
const LAST_BOARD = 'planboard:last-board';
const POS_PREFIX = 'planboard:pos:';

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<PersistedWorkspace | null> {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const w = JSON.parse(raw) as PersistedWorkspace;
      // Position rows may postdate the doc serialize; newest wins.
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(POS_PREFIX)) continue;
        const b = w.doc.boards[k.slice(POS_PREFIX.length)];
        try {
          const p = JSON.parse(localStorage.getItem(k)!) as { x: number; y: number; z: number };
          if (b && typeof p.x === 'number') b.position = p;
        } catch {
          // Bad row: ignored, next save rewrites it.
        }
      }
      return w;
    } catch {
      return null;
    }
  }

  async save(w: PersistedWorkspace): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(w));
  }

  saveBoardPos(id: string, pos: { x: number; y: number; z: number }) {
    localStorage.setItem(`${POS_PREFIX}${id}`, JSON.stringify(pos));
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

  async clear() {
    const del: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === KEY || k === LAST_BOARD || k?.startsWith(POS_PREFIX)) del.push(k);
    }
    for (const k of del) localStorage.removeItem(k);
  }
}
