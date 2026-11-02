import type { Doc, ID } from '../state/schema';
import { blobRefOf, iconBlobRef } from '../state/schema';

// Binary assets live in IndexedDB, outside the doc JSON. blobRefs are
// plain element content; the store is best-effort: a missing blob renders
// a placeholder, never an error.
// Database name keeps the planboard name for data continuity.
const DB_NAME = 'planboard-blobs';
const STORE = 'blobs';

let dbp: Promise<IDBDatabase> | null = null;

// Reset-everything path: close the cached handle and drop the store.
export async function clearBlobs() {
  if (dbp) {
    (await dbp.catch(() => null))?.close();
    dbp = null;
  }
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
}

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }).catch((e) => {
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
// Object URLs pin whole blobs in memory: cap the cache and evict
// least-recently-used. An evicted URL stays valid for already-loaded
// images; a later ask just re-reads IndexedDB.
const URL_CAP = 64;

export async function putBlob(id: ID, blob: Blob): Promise<void> {
  await run('readwrite', (s) => s.put(blob, id));
}

export function getBlob(id: ID): Promise<Blob | undefined> {
  return run('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
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

function blobRefsInDoc(doc: Doc): Set<ID> {
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

export async function purgeOrphanBlobs(doc: Doc): Promise<void> {
  try {
    const keep = blobRefsInDoc(doc);
    for (const id of await listBlobIds()) {
      if (!keep.has(id)) await deleteBlob(id);
    }
  } catch {
    /* best-effort */
  }
}

// Release blobs held by trash entries that are being purged, unless a live
// element still shares the ref.
export async function releaseTrashBlobs(doc: Doc, ids: ID[]): Promise<void> {
  const refs = new Set<ID>();
  for (const id of ids) {
    const r = blobRefOf(doc.trash[id]!.el);
    if (r) refs.add(r);
  }
  const live = blobRefsInDoc({ ...doc, trash: {} });
  for (const id of refs) {
    if (!live.has(id)) await deleteBlob(id).catch(() => {});
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
