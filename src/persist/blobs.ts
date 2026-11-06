import type { Doc, ID } from '../state/schema';
import { blobRefOf, iconBlobRef } from '../state/schema';
import { getBox, isSealedBlob, type CryptoBox } from './crypto';

// Binary assets live in IndexedDB, outside the doc JSON. blobRefs are
// plain element content; the store is best-effort: a missing blob renders
// a placeholder, never an error.
const DB_NAME = 'scatterboard-blobs';
// Pre-rename database; its contents are copied forward once.
const OLD_DB_NAME = 'planboard-blobs';
const STORE = 'blobs';

let dbp: Promise<IDBDatabase> | null = null;

// Reset-everything path: close the cached handle and drop the store.
export async function clearBlobs() {
  if (dbp) {
    (await dbp.catch(() => null))?.close();
    dbp = null;
  }
  for (const name of [DB_NAME, OLD_DB_NAME]) {
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = () => res();
      // A second open tab holds the DB: the delete stays queued until
      // it closes rather than resolving as if it succeeded.
      req.onblocked = () => {
        console.warn(`scatterboard: blob store delete of ${name} is blocked by another tab`);
      };
    });
  }
}

function openBlobDb(name: string, withStore: boolean): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(name, 1);
    if (withStore) {
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
    }
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// One-time rename: copy every entry out of the pre-rename database,
// then delete it. Opening the old name on a fresh install creates an
// empty database with no store; the store check skips the copy and
// deleteDatabase drops the phantom.
async function inheritOldBlobDb(next: IDBDatabase): Promise<void> {
  const old = await openBlobDb(OLD_DB_NAME, false).catch(() => null);
  if (!old) return;
  try {
    if (old.objectStoreNames.contains(STORE)) {
      // Two phases: a write transaction fed from cursor callbacks would
      // auto-commit between tasks and dead-lock the copy.
      const entries = await new Promise<[IDBValidKey, unknown][]>((res, rej) => {
        const tx = old.transaction(STORE, 'readonly');
        const out: [IDBValidKey, unknown][] = [];
        const cur = tx.objectStore(STORE).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          out.push([c.key, c.value]);
          c.continue();
        };
        tx.oncomplete = () => res(out);
        tx.onerror = tx.onabort = () => rej(tx.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = next.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        for (const [k, v] of entries) st.put(v, k);
        tx.oncomplete = () => res();
        tx.onerror = tx.onabort = () => rej(tx.error);
      });
    }
  } finally {
    old.close();
  }
  indexedDB.deleteDatabase(OLD_DB_NAME);
}

function db(): Promise<IDBDatabase> {
  dbp ??= openBlobDb(DB_NAME, true)
    .then(async (d) => {
      try {
        await inheritOldBlobDb(d);
      } catch {
        // Best-effort: a failed copy leaves the old db for next boot.
      }
      return d;
    })
    .catch((e) => {
      // A failed open must not poison every later op; next call retries.
      dbp = null;
      throw e;
    });
  return dbp;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

const urls = new Map<ID, string>();
const inflight = new Map<ID, Promise<string | null>>();
// putBlob resolves before the owning element lands in the doc; the
// orphan purge must not reclaim a ref written in this grace window.
const recentWrites = new Map<ID, number>();
const RECENT_WRITE_MS = 60000;
// Object URLs pin whole blobs in memory: cap the cache and evict
// least-recently-used. An evicted URL stays valid for already-loaded
// images; a later ask just re-reads IndexedDB.
const URL_CAP = 64;

export async function putBlob(id: ID, blob: Blob): Promise<void> {
  recentWrites.set(id, Date.now());
  const box = getBox();
  if (box) {
    const sealed = await box.sealBytes(await blob.arrayBuffer(), blob.type);
    await run('readwrite', (s) => s.put(sealed, id));
    return;
  }
  await run('readwrite', (s) => s.put(blob, id));
}

export async function getBlob(id: ID): Promise<Blob | undefined> {
  const v = await run('readonly', (s) => s.get(id) as IDBRequest<unknown>);
  if (v === undefined) return undefined;
  if (v instanceof Blob) return v;
  if (isSealedBlob(v)) {
    const box = getBox();
    if (!box) return undefined;
    try {
      const { bytes, type } = await box.openBytes(v);
      return new Blob([bytes], { type });
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function rekeyBlobs(oldBox: CryptoBox | null, newBox: CryptoBox | null): Promise<void> {
  for (const id of await listBlobIds()) {
    const v = await run('readonly', (s) => s.get(id) as IDBRequest<unknown>).catch(() => undefined);
    if (v === undefined) continue;
    let blob: Blob | undefined;
    if (v instanceof Blob) {
      blob = v;
    } else if (isSealedBlob(v) && oldBox) {
      try {
        const { bytes, type } = await oldBox.openBytes(v);
        blob = new Blob([bytes], { type });
      } catch {
        continue;
      }
    }
    if (!blob) continue;
    if (newBox) {
      const sealed = await newBox.sealBytes(await blob.arrayBuffer(), blob.type);
      await run('readwrite', (s) => s.put(sealed, id));
    } else {
      await run('readwrite', (s) => s.put(blob, id));
    }
  }
}

async function deleteBlob(id: ID): Promise<void> {
  const u = urls.get(id);
  if (u) {
    URL.revokeObjectURL(u);
    urls.delete(id);
  }
  await run('readwrite', (s) => s.delete(id));
}

async function listBlobIds(): Promise<ID[]> {
  const keys = await run('readonly', (s) => s.getAllKeys());
  return keys.filter((k): k is string => typeof k === 'string');
}

// Object-URL cache for rendering; resolves null for missing blobs.
// Concurrent calls share one in-flight lookup so only one URL is made.
export function blobUrl(id: ID): Promise<string | null> {
  const hit = urls.get(id);
  if (hit) {
    urls.delete(id);
    urls.set(id, hit);
    return Promise.resolve(hit);
  }
  let p = inflight.get(id);
  if (!p) {
    p = (async () => {
      const b = await getBlob(id).catch(() => undefined);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urls.set(id, u);
      if (urls.size > URL_CAP) {
        const [oldest, ou] = urls.entries().next().value!;
        urls.delete(oldest);
        URL.revokeObjectURL(ou);
      }
      return u;
    })().finally(() => {
      inflight.delete(id);
    });
    inflight.set(id, p);
  }
  return p;
}

export function blobRefsInDoc(doc: Doc): Set<ID> {
  const out = new Set<ID>();
  for (const el of Object.values(doc.elements)) {
    const r = blobRefOf(el);
    if (r) out.add(r);
  }
  for (const entry of Object.values(doc.trash)) {
    const r = blobRefOf(entry.el);
    if (r) out.add(r);
  }
  for (const b of Object.values(doc.boards)) {
    const r = iconBlobRef(b.icon);
    if (r) out.add(r);
  }
  for (const tpl of Object.values(doc.templates ?? {})) {
    const r = iconBlobRef(tpl.board.icon);
    if (r) out.add(r);
    for (const el of tpl.elements) {
      const rr = blobRefOf(el);
      if (rr) out.add(rr);
    }
  }
  return out;
}

export async function purgeOrphanBlobs(doc: Doc, keep?: Set<ID>): Promise<void> {
  try {
    // Boot does not await this: the doc keeps mutating while it runs,
    // so liveness is re-derived right before each delete rather than
    // once up front (a blob written mid-purge must survive). `keep`
    // holds refs live snapshots still need even when the doc does not.
    const now = Date.now();
    for (const [id, ts] of recentWrites) if (now - ts > RECENT_WRITE_MS) recentWrites.delete(id);
    for (const id of await listBlobIds()) {
      if (keep?.has(id)) continue;
      if (recentWrites.has(id)) continue;
      if (!blobRefsInDoc(doc).has(id)) await deleteBlob(id);
    }
  } catch {
    /* best-effort */
  }
}

// Total bytes across stored blobs, for the settings storage meter.
export async function blobTotalSize(): Promise<number> {
  try {
    const d = await db();
    return await new Promise<number>((res, rej) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      let total = 0;
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          res(total);
          return;
        }
        const v = cur.value;
        if (v instanceof Blob) total += v.size;
        else if (isSealedBlob(v)) total += Math.floor((v.ct.length * 3) / 4);
        cur.continue();
      };
      req.onerror = () => rej(req.error);
    });
  } catch {
    return 0;
  }
}

export async function downloadBlobRef(id: ID, name: string): Promise<void> {
  const u = await blobUrl(id);
  if (!u) return;
  const a = document.createElement('a');
  a.href = u;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.name = 'clipboard-helper';
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}
