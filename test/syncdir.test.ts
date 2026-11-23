// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderSync } from '../src/app/syncdir';
import { clearBlobs, getBlob, putBlob } from '../src/persist/blobs';
import { isEnvelope, isSealedBlob, setBox, setupPassphrase } from '../src/persist/crypto';
import { kvDel } from '../src/persist/kv';
import type { PersistedWorkspace } from '../src/persist/storage';
import { readBackup, restoreMedia, saveSyncDirHandle, writeBackup } from '../src/persist/syncdir';
import { createBoard, createFile, createImage, createNote, emptyDoc, type Doc, type Element } from '../src/state/schema';
import type { App } from '../src/app';

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
// File System Access exists (the picker itself is never invoked).
vi.stubGlobal('showDirectoryPicker', () => Promise.resolve(null));

// In-memory FileSystemDirectoryHandle covering the surface
// persist/syncdir.ts and app/syncdir.ts touch.
interface FakeDir {
  name: string;
  kind: 'directory';
  queryPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    kind: 'file';
    name: string;
    getFile(): Promise<{ type: string; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
    createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }>;
  }>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterableIterator<string>;
  files: Map<string, string | Blob>;
  dirs: Map<string, FakeDir>;
}

function fakeDir(name = 'backup'): FakeDir {
  const dir: FakeDir = {
    name,
    kind: 'directory',
    files: new Map(),
    dirs: new Map(),
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
    getFileHandle(n, opts) {
      if (!dir.files.has(n)) {
        if (!opts?.create) return Promise.reject(new Error('not found'));
        dir.files.set(n, '');
      }
      return Promise.resolve({
        kind: 'file' as const,
        name: n,
        getFile: () => {
          const d = dir.files.get(n)!;
          return Promise.resolve({
            type: d instanceof Blob ? d.type : '',
            text: () => (d instanceof Blob ? d.text() : Promise.resolve(d)),
            arrayBuffer: () =>
              d instanceof Blob ? d.arrayBuffer() : Promise.resolve(new TextEncoder().encode(d).buffer as ArrayBuffer),
          });
        },
        createWritable: () =>
          Promise.resolve({
            write: (data: string | Blob) => {
              dir.files.set(n, data);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
      });
    },
    getDirectoryHandle(n, opts) {
      let d = dir.dirs.get(n);
      if (!d) {
        if (!opts?.create) return Promise.reject(new Error('not found'));
        d = fakeDir(n);
        dir.dirs.set(n, d);
      }
      return Promise.resolve(d);
    },
    removeEntry(n) {
      if (!dir.files.delete(n) && !dir.dirs.delete(n)) return Promise.reject(new Error('not found'));
      return Promise.resolve();
    },
    async *keys() {
      yield* dir.files.keys();
      yield* dir.dirs.keys();
    },
  };
  return dir;
}

function docWithMedia() {
  const doc = emptyDoc();
  doc.boards.home = createBoard({ id: 'home', title: 'Home' });
  const n = createNote(doc, 'home', 10, 20, 'remember the milk');
  doc.elements[n.id] = n;
  const img = createImage(doc, 'home', 300, 20, 'blob-img', 'cat.png', 1.5);
  doc.elements[img.id] = img;
  const f = createFile(doc, 'home', 600, 20, 'blob-file', 'spec.pdf', 9, 'application/pdf');
  doc.elements[f.id] = f;
  return doc;
}

async function seedBlobs() {
  await putBlob('blob-img', new Blob(['png-bytes'], { type: 'image/png' }));
  await putBlob('blob-file', new Blob(['pdf-bytes'], { type: 'application/pdf' }));
}

async function mediaDir(dir: FakeDir) {
  return dir.dirs.get('media');
}

async function mediaNames(dir: FakeDir) {
  const media = await mediaDir(dir);
  if (!media) return [];
  const out: string[] = [];
  for await (const k of media.keys()) out.push(k);
  return out.sort();
}

async function indexJson(dir: FakeDir) {
  const media = await mediaDir(dir);
  const raw = media?.files.get('index.json');
  return raw ? (JSON.parse(raw as string) as Record<string, unknown>) : null;
}

beforeEach(async () => {
  idbDatabases.clear();
  setBox(null);
  await clearBlobs();
  await kvDel('syncdir').catch(() => {});
  document.body.innerHTML = '';
});

describe('folder backup mirror', () => {
  it('writes workspace.json plus media/ and round-trips through readBackup', async () => {
    const dir = fakeDir();
    const doc = docWithMedia();
    await seedBlobs();
    const mirrored = new Set<string>();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, doc, { uiScale: 1.1 }, mirrored);

    const raw = dir.files.get('workspace.json');
    expect(typeof raw).toBe('string');
    const payload = JSON.parse(raw as string);
    expect(payload.kind).toBe('scatterboard-workspace');
    expect(payload.prefs).toEqual({ uiScale: 1.1 });
    expect(Object.keys(payload.doc.elements)).toHaveLength(3);

    expect(await mediaNames(dir)).toEqual(['blob-file', 'blob-img', 'index.json']);
    const idx = await indexJson(dir);
    expect(idx).toEqual({ 'blob-img': 'image/png', 'blob-file': 'application/pdf' });
    expect(mirrored).toEqual(new Set(['blob-img', 'blob-file']));

    const back = await readBackup(dir as unknown as FileSystemDirectoryHandle);
    expect(back).not.toBe('locked');
    if (back === 'locked' || !back) return;
    expect(back.savedAt).toBe(payload.savedAt);
    expect(back.doc.elements).toEqual(doc.elements);
    expect(back.doc.boards).toEqual(doc.boards);
  });

  it('readBackup rejects a file with the wrong kind marker and a missing file', async () => {
    const dir = fakeDir();
    dir.files.set('workspace.json', JSON.stringify({ kind: 'other-app', doc: { boards: {} } }));
    expect(await readBackup(dir as unknown as FileSystemDirectoryHandle)).toBeNull();
    expect(await readBackup(fakeDir() as unknown as FileSystemDirectoryHandle)).toBeNull();
  });

  it('restoreMedia refills IndexedDB blobs from the mirror', async () => {
    const dir = fakeDir();
    const doc = docWithMedia();
    await seedBlobs();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, doc, {}, new Set());

    await clearBlobs();
    expect(await getBlob('blob-img')).toBeUndefined();

    await restoreMedia(dir as unknown as FileSystemDirectoryHandle, doc);
    const img = await getBlob('blob-img');
    expect(img?.type).toBe('image/png');
    expect(await img?.text()).toBe('png-bytes');
    const file = await getBlob('blob-file');
    expect(file?.type).toBe('application/pdf');
    expect(await file?.text()).toBe('pdf-bytes');
  });

  it('drops dead blobs from the mirror on the next write', async () => {
    const dir = fakeDir();
    const doc = docWithMedia();
    await seedBlobs();
    const mirrored = new Set<string>();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, doc, {}, mirrored);

    for (const [id, el] of Object.entries(doc.elements)) {
      if (el.type === 'file') delete doc.elements[id];
    }
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, doc, {}, mirrored);

    expect(await mediaNames(dir)).toEqual(['blob-img', 'index.json']);
    expect(await indexJson(dir)).toEqual({ 'blob-img': 'image/png' });
    expect(mirrored).toEqual(new Set(['blob-img']));
  });

  it('seals workspace + media behind the passphrase box and restores them back', async () => {
    const { box } = await setupPassphrase('vault-key', 1000);
    setBox(box);
    const dir = fakeDir();
    const doc = docWithMedia();
    await seedBlobs();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, doc, {}, new Set());

    expect(isEnvelope(dir.files.get('workspace.json') as string)).toBe(true);
    const mediaBlob = (await mediaDir(dir))!.files.get('blob-img');
    expect(typeof mediaBlob).toBe('string');
    expect(isSealedBlob(JSON.parse(mediaBlob as string))).toBe(true);

    const back = await readBackup(dir as unknown as FileSystemDirectoryHandle);
    if (back === 'locked' || !back) throw new Error('expected a decrypted payload');
    expect(back.doc.elements).toEqual(doc.elements);

    await clearBlobs();
    await restoreMedia(dir as unknown as FileSystemDirectoryHandle, doc);
    expect(await (await getBlob('blob-img'))?.text()).toBe('png-bytes');
  });

  it('reports a sealed backup as locked once the box is gone', async () => {
    const { box } = await setupPassphrase('vault-key', 1000);
    setBox(box);
    const dir = fakeDir();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, docWithMedia(), {}, new Set());
    setBox(null);
    expect(await readBackup(dir as unknown as FileSystemDirectoryHandle)).toBe('locked');
  });
});

function fakeApp(doc: Doc) {
  const saved: PersistedWorkspace[] = [];
  const calls = { begin: 0, end: 0, notify: 0, reload: 0 };
  const app = {
    doc,
    prefs: {},
    lastSavedAt: 0,
    beginExternalSave: () => calls.begin++,
    endExternalSave: () => calls.end++,
    saveExternal: (w: PersistedWorkspace) => {
      saved.push(w);
      return Promise.resolve();
    },
    notifyExternalSave: () => calls.notify++,
    reloadDiscarding: () => calls.reload++,
    exporter: { exportJson: () => Promise.resolve() },
    scheduleSave: () => {},
  } as unknown as App;
  return { app, saved, calls };
}

describe('FolderSync restore flow', () => {
  it('offers and completes a restore when the mirror is newer than the workspace', async () => {
    const dir = fakeDir();
    const backupDoc = docWithMedia();
    // An element that fails the shape check must not survive the restore.
    backupDoc.elements.junk = {
      id: 'junk',
      boardId: 'home',
      type: 'note',
      x: 0,
      y: 0,
      z: 0,
      parentId: null,
      locked: false,
      labels: [],
      createdAt: 1,
      modifiedAt: 1,
      content: { bogus: 42 } as unknown as Element['content'],
    };
    // A child of the dropped element would otherwise keep a dead
    // parentId and land in a member bucket nothing renders.
    const orphan = createNote(backupDoc, 'home', 40, 40, 'child of junk');
    orphan.parentId = 'junk';
    backupDoc.elements[orphan.id] = orphan;
    await seedBlobs();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, backupDoc, { theme: 'dark' }, new Set());
    await clearBlobs();

    const { app, saved, calls } = fakeApp(emptyDoc());
    const sync = new FolderSync(app);
    await saveSyncDirHandle(dir as unknown as FileSystemDirectoryHandle);
    await sync.init();

    const act = document.querySelector<HTMLButtonElement>('.toast-act');
    expect(act).toBeTruthy();
    act!.click();
    await vi.waitFor(() => expect(calls.reload).toBe(1));

    expect(calls.begin).toBe(1);
    expect(saved).toHaveLength(1);
    const doc = saved[0]!.doc;
    expect(doc.boards.home?.title).toBe('Home');
    expect(doc.elements.junk).toBeUndefined();
    expect(Object.keys(doc.elements)).toHaveLength(4);
    expect(doc.elements[orphan.id]?.parentId).toBeNull();
    expect(saved[0]!.prefs).toEqual({ theme: 'dark' });
    expect(calls.notify).toBe(1);
    expect(sync.state).toBe('on');
    // Blobs came back through the media restore, not just the doc.
    expect(await (await getBlob('blob-img'))?.text()).toBe('png-bytes');
    await sync.stop();
  });

  it('does not offer a restore when the mirror is not newer', async () => {
    const dir = fakeDir();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, docWithMedia(), {}, new Set());
    const { app } = fakeApp(emptyDoc());
    app.lastSavedAt = Date.now();
    const sync = new FolderSync(app);
    await saveSyncDirHandle(dir as unknown as FileSystemDirectoryHandle);
    await sync.init();
    expect(document.querySelector('.toast-act')).toBeNull();
    expect(sync.state).toBe('on');
    await sync.stop();
  });

  it('does not offer a restore for a sealed backup while locked', async () => {
    const { box } = await setupPassphrase('vault-key', 1000);
    setBox(box);
    const dir = fakeDir();
    await writeBackup(dir as unknown as FileSystemDirectoryHandle, docWithMedia(), {}, new Set());
    setBox(null);
    const { app } = fakeApp(emptyDoc());
    const sync = new FolderSync(app);
    await saveSyncDirHandle(dir as unknown as FileSystemDirectoryHandle);
    await sync.init();
    expect(document.querySelector('.toast-act')).toBeNull();
    expect(sync.state).toBe('on');
    await sync.stop();
  });

  it('flush() mirrors the live doc into the folder', async () => {
    const dir = fakeDir();
    const { app } = fakeApp(docWithMedia());
    await seedBlobs();
    const sync = new FolderSync(app);
    sync.handle = dir as unknown as FileSystemDirectoryHandle;
    sync.state = 'on';
    await sync.flush();
    expect(sync.state).toBe('on');
    const back = await readBackup(dir as unknown as FileSystemDirectoryHandle);
    if (back === 'locked' || !back) throw new Error('expected a backup');
    expect(Object.keys(back.doc.elements)).toHaveLength(3);
    expect(await mediaNames(dir)).toEqual(['blob-file', 'blob-img', 'index.json']);
    await sync.stop();
  });
});
