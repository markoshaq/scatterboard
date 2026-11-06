// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBlob, putBlob, rekeyBlobs } from '../src/persist/blobs';
import {
  clearEncMeta,
  isEnvelope,
  loadEncMeta,
  saveEncMeta,
  setBox,
  setupPassphrase,
  unlockWithPassphrase,
  verifyPassphrase,
} from '../src/persist/crypto';
import { locked, pack, unpack } from '../src/persist/envelope';
import { LocalStorageAdapter } from '../src/persist/local';
import { createSnapshot, readSnapshot, rekeySnapshots } from '../src/persist/snapshots';
import type { PersistedWorkspace } from '../src/persist/storage';
import { createBoard, createNote, emptyDoc } from '../src/state/schema';

class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const mem = new MemStorage();
vi.stubGlobal('localStorage', mem);

// Minimal in-memory IndexedDB fake covering put/get/delete/getAllKeys/openCursor.
const idbDatabases = new Map<string, Map<string, Map<string, unknown>>>();

function makeFakeIdb() {
  return {
    open(dbName: string) {
      const req: Record<string, unknown> = {
        result: null,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        let stores = idbDatabases.get(dbName);
        const isNew = !stores;
        if (!stores) {
          stores = new Map();
          idbDatabases.set(dbName, stores);
        }
        const db = {
          objectStoreNames: {
            contains: (s: string) => stores!.has(s),
          },
          createObjectStore: (s: string) => {
            if (!stores!.has(s)) stores!.set(s, new Map());
          },
          close: () => {},
          transaction: (storeName: string) => {
            if (!stores!.has(storeName)) stores!.set(storeName, new Map());
            const map = stores!.get(storeName)!;
            const tx: Record<string, unknown> = {
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              objectStore: () => ({
                put(val: unknown, key: string) {
                  map.set(key, val);
                  const r = { result: key };
                  queueMicrotask(() => (tx.oncomplete as (() => void) | null)?.());
                  return r;
                },
                get(key: string) {
                  const r = { result: map.get(key) };
                  queueMicrotask(() => (tx.oncomplete as (() => void) | null)?.());
                  return r;
                },
                delete(key: string) {
                  map.delete(key);
                  const r = { result: undefined };
                  queueMicrotask(() => (tx.oncomplete as (() => void) | null)?.());
                  return r;
                },
                getAllKeys() {
                  const r = { result: [...map.keys()] };
                  queueMicrotask(() => (tx.oncomplete as (() => void) | null)?.());
                  return r;
                },
                openCursor() {
                  const entries = [...map.entries()];
                  let idx = 0;
                  const curReq: Record<string, unknown> = {
                    result: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                  };
                  const step = () => {
                    if (idx < entries.length) {
                      const [k, v] = entries[idx++]!;
                      curReq.result = {
                        key: k,
                        value: v,
                        continue: () => queueMicrotask(step),
                      };
                      (curReq.onsuccess as (() => void) | null)?.();
                    } else {
                      curReq.result = null;
                      (curReq.onsuccess as (() => void) | null)?.();
                      queueMicrotask(() => (tx.oncomplete as (() => void) | null)?.());
                    }
                  };
                  queueMicrotask(step);
                  return curReq;
                },
              }),
            };
            return tx;
          },
        };
        req.result = db;
        if (isNew) (req.onupgradeneeded as (() => void) | null)?.();
        (req.onsuccess as (() => void) | null)?.();
      });
      return req;
    },
    deleteDatabase(dbName: string) {
      idbDatabases.delete(dbName);
      const req: Record<string, unknown> = { onsuccess: null };
      queueMicrotask(() => (req.onsuccess as (() => void) | null)?.());
      return req;
    },
  };
}

vi.stubGlobal('indexedDB', makeFakeIdb());

function sampleWorkspace(): PersistedWorkspace {
  const doc = emptyDoc();
  doc.boards.home = createBoard({ id: 'home', title: 'Secret Board' });
  const n = createNote(doc, 'home', 10, 20, 'Top secret note');
  doc.elements[n.id] = n;
  return { version: 1, doc, savedAt: 1000 };
}

beforeEach(() => {
  mem.clear();
  idbDatabases.clear();
  setBox(null);
});

describe('encryption at rest', () => {
  it('seals and opens text, detects envelopes, and rejects wrong passphrases', async () => {
    const { box, meta } = await setupPassphrase('correct-horse', 1000);
    const sealed = await box.seal('hello scatterboard');
    expect(isEnvelope(sealed)).toBe(true);
    expect(isEnvelope('{"version":1}')).toBe(false);
    expect(isEnvelope('not json')).toBe(false);
    expect(await box.open(sealed)).toBe('hello scatterboard');

    const verified = await verifyPassphrase('correct-horse', meta);
    expect(verified).not.toBeNull();
    expect(await verified!.open(sealed)).toBe('hello scatterboard');

    const wrong = await verifyPassphrase('wrong-passphrase', meta);
    expect(wrong).toBeNull();

    const { box: otherBox } = await setupPassphrase('other-pass', 1000);
    await expect(otherBox.open(sealed)).rejects.toThrow();
  });

  it('persists verifier metadata in kv and unlocks', async () => {
    const { meta } = await setupPassphrase('my-secret', 1000);
    await saveEncMeta(meta);
    const loaded = await loadEncMeta();
    expect(loaded).toEqual(meta);

    expect(await unlockWithPassphrase('bad')).toBeNull();
    const box = await unlockWithPassphrase('my-secret');
    expect(box).not.toBeNull();

    await clearEncMeta();
    expect(await loadEncMeta()).toBeNull();
  });

  it('seals workspace in LocalStorageAdapter and distinguishes locked from corrupt', async () => {
    const adapter = new LocalStorageAdapter();
    const w = sampleWorkspace();
    const { box } = await setupPassphrase('vault-key', 1000);
    setBox(box);

    await adapter.save(w);
    const raw = localStorage.getItem('scatterboard:v1')!;
    expect(isEnvelope(raw)).toBe(true);
    expect(raw).not.toContain('Top secret note');

    // While locked (no box in memory), load() returns null, sets locked() = true, and does NOT quarantine as corrupt.
    setBox(null);
    expect(locked(raw)).toBe(true);
    expect(await adapter.load()).toBeNull();
    expect(adapter.locked()).toBe(true);
    expect(adapter.corrupt()).toBeNull();
    expect(localStorage.getItem('scatterboard:v1')).toBe(raw);

    // After unlocking, load() opens the envelope and returns the workspace.
    setBox(box);
    expect(locked(raw)).toBe(false);
    const unlocked = await adapter.load();
    expect(adapter.locked()).toBe(false);
    expect(unlocked).toEqual(w);
  });

  it('supports mixed plaintext and encrypted blobs and rekeys them cleanly', async () => {
    const plainBlob = new Blob(['plain-bytes'], { type: 'text/plain' });
    await putBlob('b-plain', plainBlob);

    const { box } = await setupPassphrase('blob-pass', 1000);
    setBox(box);
    const encBlob = new Blob(['secret-bytes'], { type: 'text/plain' });
    await putBlob('b-enc', encBlob);

    // Mixed store: both plaintext and encrypted blobs read back while box is set.
    expect(await (await getBlob('b-plain'))!.text()).toBe('plain-bytes');
    expect(await (await getBlob('b-enc'))!.text()).toBe('secret-bytes');

    // Without box: plaintext still reads, encrypted blob returns undefined.
    setBox(null);
    expect(await (await getBlob('b-plain'))!.text()).toBe('plain-bytes');
    expect(await getBlob('b-enc')).toBeUndefined();

    // Rekey all blobs to encrypted, then back to plaintext.
    setBox(box);
    await rekeyBlobs(box, box);
    setBox(null);
    expect(await getBlob('b-plain')).toBeUndefined();

    await rekeyBlobs(box, null);
    expect(await (await getBlob('b-plain'))!.text()).toBe('plain-bytes');
    expect(await (await getBlob('b-enc'))!.text()).toBe('secret-bytes');
  });

  it('packs, unpacks, and rekeys snapshots', async () => {
    const w = sampleWorkspace();
    const snap = await createSnapshot(w.doc, {}, 'Before enc', false);

    const { box } = await setupPassphrase('snap-pass', 1000);
    setBox(box);
    await rekeySnapshots(null, box);

    // Locked without box: readSnapshot returns null.
    setBox(null);
    expect(await readSnapshot(snap.id)).toBeNull();

    // With box: readSnapshot decrypts.
    setBox(box);
    const read = await readSnapshot(snap.id);
    expect(read?.doc.boards.home?.title).toBe('Secret Board');

    // Rekey back to plaintext.
    setBox(null);
    await rekeySnapshots(box, null);
    const plainRead = await readSnapshot(snap.id);
    expect(plainRead?.doc.boards.home?.title).toBe('Secret Board');

    // Direct pack/unpack round-trip
    setBox(box);
    const packed = await pack(w);
    expect(isEnvelope(packed)).toBe(true);
    expect(await unpack(packed)).toEqual(w);
  });
});
