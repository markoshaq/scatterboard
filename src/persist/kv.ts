// Small IndexedDB key-value store for data that does not belong in the
// doc JSON: the folder-backup handle and workspace snapshots. Kept out
// of the blob database so its schema stays untouched.
const DB_NAME = 'scatterboard-extra';
const STORE = 'kv';

let dbp: Promise<IDBDatabase> | null = null;

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

export function kvGet<T>(key: string): Promise<T | undefined> {
  return run('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function kvPut(key: string, value: unknown): Promise<void> {
  return run('readwrite', (s) => s.put(value, key)).then(() => undefined);
}

export function kvDel(key: string): Promise<void> {
  return run('readwrite', (s) => s.delete(key)).then(() => undefined);
}

export async function kvKeys(prefix: string): Promise<string[]> {
  const keys = await run('readonly', (s) => s.getAllKeys());
  return keys.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix));
}

// Settings "Reset everything" wipes this along with the doc and blobs.
export async function clearExtra(): Promise<void> {
  if (dbp) {
    (await dbp.catch(() => null))?.close();
    dbp = null;
  }
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => res();
    // Resolving on a blocked delete would fake success while a second
    // tab keeps the old store alive to resurrect on reload.
    req.onblocked = () => {
      console.warn(`scatterboard: kv store delete of ${DB_NAME} is blocked by another tab`);
    };
  });
}
