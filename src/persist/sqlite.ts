import type { LocalStorageAdapter } from './local';
import type { DocStorage, PersistedWorkspace } from './storage';

// sqlite-wasm storage: the vendored worker1 script + wasm in
// public/jswasm, on the opfs-sahpool VFS (no SharedArrayBuffer needed).
// A ~60-line promiser replaces the package's bundled one so the sqlite
// js glue stays out of the app chunks entirely. local.ts stays as the
// first-boot migration source: on create, if the kv table has no
// migrated flag the localStorage workspace is copied across.

interface WReply {
  type: string;
  messageId?: number;
  dbId?: string;
  result?: Record<string, unknown>;
}

// Pre-rename installs keep their data under the planboard file/keys;
// create() copies it forward once, then deletes the old file.
const DB_FILE = 'file:scatterboard.sqlite3?vfs=opfs-sahpool';
const OLD_DB_FILE = 'file:planboard.sqlite3?vfs=opfs-sahpool';
const WORKER_URL = './jswasm/sqlite3-worker1.mjs';
const WS_KEY = 'workspace';
const LAST_KEY = 'last-board';
const MIGRATED = 'migrated';
const POS_PREFIX = 'pos:';
const LS_KEY = 'scatterboard:v1';
const LS_LAST = 'scatterboard:last-board';
const LS_POS = 'scatterboard:pos:';

// JSON parse off the main thread on load only. Saves stringify on the
// main thread: cloning a 550KB workspace object into the worker cost
// ~20ms, more than the ~9ms stringify itself. The save text travels as
// a plain string, which clones near-free.
class JsonCodec {
  private worker = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<{ id: number; out?: unknown; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error !== undefined) p.reject(new Error(e.data.error));
      else p.resolve(e.data.out);
    };
    this.worker.onerror = () => {
      for (const p of this.pending.values()) p.reject(new Error('json worker failed'));
      this.pending.clear();
    };
  }

  parse(s: string): Promise<unknown> {
    return this.call('parse', s);
  }

  private call(op: string, payload: unknown): Promise<unknown> {
    const id = this.nextId++;
    const p = new Promise<unknown>((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
    this.worker.postMessage({ id, op, payload });
    return p;
  }
}

// Minimal worker1 client: {type, messageId, args} out, {type, messageId,
// dbId, result} or {type:'error'} back. Calls wait for the ready post.
class WorkerDb {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve(v: WReply): void; reject(e: Error): void }>();
  ready: Promise<void>;

  constructor() {
    this.worker = new Worker(WORKER_URL, { type: 'module' });
    let onReady: () => void;
    let onFail: (e: Error) => void;
    this.ready = new Promise<void>((res, rej) => {
      onReady = res;
      onFail = rej;
    });
    this.worker.onmessage = (e: MessageEvent<WReply>) => {
      const msg = e.data;
      if (msg.type === 'sqlite3-api' && msg.result === ('worker1-ready' as unknown as Record<string, unknown>)) {
        onReady();
        return;
      }
      if (msg.messageId === undefined) return;
      const p = this.pending.get(msg.messageId);
      if (!p) return;
      this.pending.delete(msg.messageId);
      if (msg.type === 'error') {
        p.reject(new Error(String(msg.result?.message ?? 'sqlite error')));
      } else {
        p.resolve(msg);
      }
    };
    this.worker.onerror = (e) => {
      onFail(new Error(e.message));
      for (const p of this.pending.values()) p.reject(new Error('sqlite worker failed'));
      this.pending.clear();
    };
    const watchdog = setTimeout(() => onFail(new Error('sqlite worker timeout')), 8000);
    void this.ready.then(() => clearTimeout(watchdog), () => clearTimeout(watchdog));
  }

  call(type: string, args?: Record<string, unknown>, dbId?: string): Promise<WReply> {
    const messageId = this.nextId++;
    const p = new Promise<WReply>((res, rej) => this.pending.set(messageId, { resolve: res, reject: rej }));
    this.worker.postMessage({ type, messageId, args, dbId });
    return p;
  }

  exec(dbId: string | undefined, sql: string, bind?: unknown[]): Promise<Record<string, unknown>[]> {
    const resultRows: Record<string, unknown>[] = [];
    return this.call(
      'exec',
      {
        sql,
        ...(bind ? { bind } : {}),
        rowMode: 'object',
        resultRows,
      },
      dbId,
    ).then((res) => (res.result?.resultRows as Record<string, unknown>[]) ?? []);
  }
}

export class SqliteAdapter implements DocStorage {
  private db: WorkerDb | null = null;
  private dbId: string | undefined;
  private bytes = 0;
  private last: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private broken = false;
  private codec: JsonCodec | null | undefined;
  private pos = new Map<string, { x: number; y: number; z: number }>();
  private corruptRaw: string | null = null;

  corrupt(): string | null {
    return this.corruptRaw;
  }
  // Fires once when a write fails and saves degrade to localStorage.
  onDegraded?: () => void;

  private constructor(private local: LocalStorageAdapter) {}

  // Returns null when the worker or OPFS is unavailable; callers fall
  // back to LocalStorageAdapter.
  static async create(local: LocalStorageAdapter): Promise<SqliteAdapter | null> {
    try {
      const a = new SqliteAdapter(local);
      const db = new WorkerDb();
      await db.ready;
      const open = await db.call('open', { filename: DB_FILE });
      a.dbId = open.dbId;
      if (!a.dbId) return null;
      a.db = db;
      await db.exec(a.dbId, 'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
      if ((await a.get(WS_KEY)) === null) await a.inheritOldDb();
      await a.migrate();
      a.last = (await a.get(LAST_KEY)) ?? null;
      const posRows = await db.exec(a.dbId, 'SELECT key, value FROM kv WHERE key LIKE ?', [`${POS_PREFIX}%`]);
      for (const r of posRows) {
        try {
          a.pos.set(String(r.key).slice(POS_PREFIX.length), JSON.parse(String(r.value)) as { x: number; y: number; z: number });
        } catch {
          // Bad row: ignored, next save rewrites it.
        }
      }
      return a;
    } catch {
      return null;
    }
  }

  private async get(key: string): Promise<string | null> {
    const rows = await this.db!.exec(this.dbId, 'SELECT value FROM kv WHERE key = ?', [key]);
    return (rows[0]?.value as string) ?? null;
  }

  private put(key: string, value: string) {
    this.queue = this.queue.then(async () => {
      try {
        await this.db!.exec(this.dbId, 'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
      } catch {
        if (!this.broken) this.onDegraded?.();
        this.broken = true;
      }
    });
    return this.queue;
  }

  // Copy kv rows out of the pre-rename OPFS file, then delete it.
  // open() creates the file when it is absent, so the empty-schema
  // check doubles as the "was it there" test and close(unlink) drops
  // the phantom either way.
  private async inheritOldDb() {
    const open = await this.db!.call('open', { filename: OLD_DB_FILE }).catch(() => null);
    const oldId = open?.dbId;
    if (!oldId) return;
    try {
      const has = await this.db!.exec(oldId, "SELECT name FROM sqlite_master WHERE name = 'kv'");
      if (has.length) {
        const rows = await this.db!.exec(oldId, 'SELECT key, value FROM kv');
        for (const r of rows) await this.put(String(r.key), String(r.value));
      }
    } catch {
      // Unreadable old file: nothing to inherit.
    } finally {
      await this.db!.call('close', { unlink: true }, oldId).catch(() => {});
    }
  }

  private async migrate() {
    if (await this.get(MIGRATED)) return;
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      await this.put(WS_KEY, raw);
      this.bytes = new Blob([raw]).size;
    }
    const last = localStorage.getItem(LS_LAST);
    if (last) await this.put(LAST_KEY, last);
    // Per-board viewport rows postdate the doc serialize; without them
    // every board reopens at a stale position after the first sqlite boot.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(LS_POS)) continue;
      const v = localStorage.getItem(k);
      if (v === null) continue;
      const bid = k.slice(LS_POS.length);
      await this.put(`${POS_PREFIX}${bid}`, v);
      try {
        this.pos.set(bid, JSON.parse(v) as { x: number; y: number; z: number });
      } catch {
        // Bad row: ignored, next save rewrites it.
      }
    }
    await this.put(MIGRATED, '1');
  }

  private json(): JsonCodec | null {
    if (this.codec === undefined) {
      try {
        this.codec = new JsonCodec();
      } catch {
        this.codec = null;
      }
    }
    return this.codec;
  }

  async load(): Promise<PersistedWorkspace | null> {
    try {
      const raw = await this.get(WS_KEY);
      let w: PersistedWorkspace | null = null;
      if (raw) {
        const c = this.json();
        w = (c ? await c.parse(raw) : JSON.parse(raw)) as PersistedWorkspace;
      }
      // A previous session may have degraded to localStorage after a
      // failed put(): whichever copy saved later wins, and a winning
      // local copy is pushed back into sqlite so the stores reconverge.
      const lw = await this.local.load().catch(() => null);
      if (lw && (!w || (lw.savedAt ?? 0) > (w.savedAt ?? 0))) {
        w = lw;
        void this.put(WS_KEY, JSON.stringify(lw));
      }
      if (!w || typeof w.doc !== 'object' || !w.doc) {
        // Parseable-or-nothing: a corrupt payload is quarantined to a
        // sidecar row and flagged so boot can offer a rescue download.
        if (raw) {
          this.corruptRaw = raw;
          await this.put(`${WS_KEY}.corrupt`, raw);
          await this.put(WS_KEY, '');
        }
        return null;
      }
      this.bytes = new Blob([JSON.stringify(w)]).size;
      // Position rows may postdate the doc serialize; the newest wins.
      for (const [bid, p] of this.pos) {
        const b = w.doc.boards?.[bid];
        if (b) b.position = p;
      }
      return w;
    } catch {
      return null;
    }
  }

  async save(w: PersistedWorkspace): Promise<void> {
    if (this.broken) {
      await this.local.save(w);
      return;
    }
    const json = JSON.stringify(w);
    this.bytes = new Blob([json]).size;
    await this.put(WS_KEY, json);
  }

  saveBoardPos(id: string, pos: { x: number; y: number; z: number }) {
    this.pos.set(id, pos);
    if (this.broken) {
      this.local.saveBoardPos(id, pos);
      return;
    }
    return this.put(`${POS_PREFIX}${id}`, JSON.stringify(pos));
  }

  docBytes(): number {
    return this.bytes;
  }

  lastBoard(): string | null {
    return this.last;
  }

  setLastBoard(id: string) {
    this.last = id;
    if (this.broken) {
      this.local.setLastBoard(id);
      return;
    }
    void this.put(LAST_KEY, id);
  }

  async clear() {
    try {
      await this.db!.exec(this.dbId, 'DELETE FROM kv');
    } catch {
      this.broken = true;
    }
    this.last = null;
    this.bytes = 0;
    this.pos.clear();
    await this.local.clear();
  }
}
