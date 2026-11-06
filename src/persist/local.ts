import type { PersistedWorkspace, StorageAdapter } from './storage';

const KEY = 'scatterboard:v1';
const LAST_BOARD = 'scatterboard:last-board';
const POS_PREFIX = 'scatterboard:pos:';
const CORRUPT_KEY = 'scatterboard:v1.corrupt';
const OLD_POS_PREFIX = 'planboard:pos:';

// One-time rename from the pre-rename planboard:* keys. Runs in boot()
// before the adapters so both only ever see the new names.
export function migrateStorageKeys() {
  try {
    for (const [oldKey, newKey] of [
      ['planboard:v1', KEY],
      ['planboard:last-board', LAST_BOARD],
      ['planboard:lang', 'scatterboard:lang'],
      ['planboard:theme', 'scatterboard:theme'],
    ] as const) {
      const v = localStorage.getItem(oldKey);
      if (v === null) continue;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v);
      localStorage.removeItem(oldKey);
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(OLD_POS_PREFIX)) continue;
      const v = localStorage.getItem(k);
      const nk = `${POS_PREFIX}${k.slice(OLD_POS_PREFIX.length)}`;
      if (v !== null && localStorage.getItem(nk) === null) localStorage.setItem(nk, v);
      localStorage.removeItem(k);
    }
  } catch {
    // localStorage can throw in hardened modes; leave the keys alone.
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  private corruptRaw: string | null = null;

  corrupt(): string | null {
    return this.corruptRaw;
  }

  async load(): Promise<PersistedWorkspace | null> {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
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
      // Parse failure is not 'no data': quarantine the bytes under a
      // backup key so the seed's first autosave can't destroy them.
      if (raw !== null) {
        try {
          localStorage.setItem(CORRUPT_KEY, raw);
          localStorage.removeItem(KEY);
        } catch {}
        this.corruptRaw = raw;
      }
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
      if (
        k === KEY ||
        k === LAST_BOARD ||
        k?.startsWith(POS_PREFIX) ||
        // The pref mirrors must go too: after a reset, boot resolves
        // lang/theme from the browser/OS, not a stale explicit choice.
        k === 'scatterboard:lang' ||
        k === 'scatterboard:theme'
      ) {
        del.push(k);
      }
    }
    for (const k of del) localStorage.removeItem(k);
  }
}
