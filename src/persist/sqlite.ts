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

// Storage keys and the OPFS file keep the planboard name for data
// continuity.
const DB_FILE = 'file:planboard.sqlite3?vfs=opfs-sahpool';
const WORKER_URL = './jswasm/sqlite3-worker1.mjs';
const WS_KEY = 'workspace';
const LAST_KEY = 'last-board';
const MIGRATED = 'migrated';
const LS_KEY = 'planboard:v1';
const LS_LAST = 'planboard:last-board';

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
    setTimeout(() => onFail(new Error('sqlite worker timeout')), 8000);
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
      await a.migrate();
      a.last = (await a.get(LAST_KEY)) ?? null;
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
        this.broken = true;
      }
    });
    return this.queue;
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
    await this.put(MIGRATED, '1');
  }

  async load(): Promise<PersistedWorkspace | null> {
    try {
      const raw = await this.get(WS_KEY);
      if (!raw) return null;
      this.bytes = new Blob([raw]).size;
      return JSON.parse(raw) as PersistedWorkspace;
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

  docBytes(): number {
    return this.bytes;
  }

  lastBoard(): string | null {
    return this.last;
  }

  setLastBoard(id: string) {
    this.last = id;
    void this.put(LAST_KEY, id);
  }
}
