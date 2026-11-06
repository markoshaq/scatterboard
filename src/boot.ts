import { App } from './app';
import { Store } from './state/store';
import { EDITOR_TYPES, migrateDoc, survivingBoard, type Doc } from './state/schema';
import { LocalStorageAdapter, migrateStorageKeys } from './persist/local';
import { downloadTextFile } from './draw/strokes';
import { SqliteAdapter } from './persist/sqlite';
import { purgeOrphanBlobs } from './persist/blobs';
import { choice, toast } from './ui/toast';
import { t } from './strings';

function boardIdFromHash(): string | null {
  const m = location.hash.match(/^#\/b\/([^/?#]+)/);
  return m ? m[1]! : null;
}

function editorIdFromHash(): string | null {
  const m = location.hash.match(/^#\/e\/([^/?#]+)/);
  return m ? m[1]! : null;
}

export async function boot() {
  // sqlite in OPFS via the sah-pool VFS is the primary store; the
  // localStorage adapter stays as migration source and fallback when
  // the worker or OPFS is unavailable.
  migrateStorageKeys();
  const local = new LocalStorageAdapter();
  const adapter = (await SqliteAdapter.create(local)) ?? local;
  if (adapter instanceof SqliteAdapter) adapter.onDegraded = () => toast(t('persistDegraded'), 'warn');
  // Ask for durable storage so the doc survives quota pressure;
  // browsers may refuse silently, the adapter stays best-effort either way.
  void navigator.storage?.persist?.().catch(() => {});
  const persisted = await adapter.load();
  const fresh = !(persisted && persisted.version === 1 && Object.keys(persisted.doc.boards).length);
  // The welcome seed chunk only loads when a fresh doc is needed;
  // ?seed=N (dev only) builds the profiling board instead.
  const perfN = import.meta.env.DEV ? new URLSearchParams(location.search).get('seed') : null;
  let doc: Doc;
  if (perfN !== null) {
    const { seedPerfDoc } = await import('./dev/seed');
    doc = seedPerfDoc(+perfN || 1600);
  } else if (fresh) {
    const { seedDoc } = await import('./dev/seed');
    doc = seedDoc();
  } else {
    doc = migrateDoc(persisted!.doc);
  }
  void (async () => {
    const { snapshotBlobRefs } = await import('./persist/snapshots');
    const keep = await snapshotBlobRefs().catch(() => undefined);
    await purgeOrphanBlobs(doc, keep);
  })();
  const store = new Store(doc);
  const app = new App(document.getElementById('app')!, store, adapter);
  // First-paint filler served by index.html; the canvas covers it from
  // here on, so it can go.
  document.getElementById('boot-load')?.remove();
  app.prefs = persisted?.prefs ?? {};
  app.lastSavedAt = persisted?.savedAt ?? 0;
  app.applyPrefs();
  // Daily automatic snapshot: version history for a workspace that
  // lives only in browser storage. Named snapshots never prune before
  // it does.
  void (async () => {
    if (!Object.keys(doc.elements).length) return;
    const { listSnapshots, createSnapshot } = await import('./persist/snapshots');
    const list = await listSnapshots();
    if (!list.some((s) => Date.now() - s.createdAt < 86400000)) {
      await createSnapshot(doc, app.prefs, t('snapAuto'), true);
    }
  })().catch(() => {});
  // Folder backup: restores the stored directory handle and offers a
  // restore when the mirror is newer than this workspace.
  void app.fsync.init().catch(() => {});
  if (fresh && perfN === null) app.welcomeHint();
  // A persisted blob that failed to parse was quarantined by the
  // adapter; offer a rescue download before the seed's autosave lands.
  const corruptRaw = adapter.corrupt?.();
  if (fresh && corruptRaw) {
    const raw = corruptRaw;
    choice(t('persistCorrupt'), t('persistCorruptSave'), () =>
      downloadTextFile('scatterboard-backup.json', raw, 'application/json'),
    );
  }
  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

  // Last-ditch crash surface: flush pending autosave, then offer a
  // reload. A silent failure in a local-first app reads as lost work.
  let crashed = false;
  const onCrash = () => {
    if (crashed) return;
    crashed = true;
    void app
      .flush()
      .catch(() => {})
      .finally(() => choice(t('errCrash'), t('errReload'), () => location.reload(), undefined, 0));
  };
  window.addEventListener('error', onCrash);
  window.addEventListener('unhandledrejection', onCrash);

  // #/e/<id> boots into the element's editor: synthesize a #/b/ history
  // entry underneath so history.back() exits to the board. The mode
  // suffix (?editing-drawing etc.) is part of the deep link: push the
  // hash as-is, don't rebuild it.
  const eid = editorIdFromHash();
  const eel = eid ? doc.elements[eid] : undefined;
  if (eel && doc.boards[eel.boardId] && EDITOR_TYPES.has(eel.type)) {
    app.openBoard(eel.boardId);
    history.pushState(null, '', location.hash);
    app.applyRoute();
  } else {
    const requested = boardIdFromHash() ?? adapter.lastBoard();
    const fallback = survivingBoard(doc);
    const start = requested && doc.boards[requested] ? requested : fallback;
    if (start) app.openBoard(start);
    app.applyRoute();
  }

  // Routing and save-on-hide must be wired before anything that can
  // throw: a failed lazy import below must not orphan them.
  window.addEventListener('hashchange', () => app.applyRoute());
  window.addEventListener('pagehide', () => void app.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void app.flush();
  });

  // Agent surface is a lazy chunk: ?do= command links and ?agent=
  // pairing plus the stored Local agent pref all boot it on demand. A
  // missing chunk (offline, stale cache) leaves the app fully usable.
  const q = new URLSearchParams(location.search);
  if (q.has('do') || q.has('agent') || q.has('port') || app.prefs.agent) {
    try {
      const { init } = await import('./agent/index');
      init(app);
    } catch {
      // Agent unavailable this boot; skip silently.
    }
  }

  // PWA entry points: the OS share target (?share=1 with url/text/
  // title fields) files into Unsorted, and the manifest shortcuts open
  // quick capture or the new-board picker. Consumed params leave the
  // URL so a reload does not replay them.
  let consumed = false;
  if (q.has('share')) {
    const shared = q.get('url') ?? q.get('text') ?? q.get('title');
    if (shared) app.fileCaptured(shared.slice(0, 4000));
    for (const k of ['share', 'url', 'text', 'title']) q.delete(k);
    consumed = true;
  }
  if (q.has('capture')) {
    app.openShortcutCapture();
    q.delete('capture');
    consumed = true;
  }
  if (q.has('newboard')) {
    app.openShortcutNewBoard();
    q.delete('newboard');
    consumed = true;
  }
  if (consumed) {
    const qs = q.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
}
