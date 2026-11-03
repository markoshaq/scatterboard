import { App } from './app';
import { Store } from './state/store';
import { migrateDoc, type Doc } from './state/schema';
import { LocalStorageAdapter, migrateStorageKeys } from './persist/local';
import { SqliteAdapter } from './persist/sqlite';
import { purgeOrphanBlobs } from './persist/blobs';
import { toast } from './ui/toast';
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
  if (adapter instanceof SqliteAdapter) adapter.onDegraded = () => toast(t('persistDegraded'));
  const persisted = await adapter.load();
  const fresh = !(persisted && persisted.version === 1 && Object.keys(persisted.doc.boards).length);
  // The welcome seed chunk only loads when a fresh doc is needed;
  // ?seed=N (dev only) builds the profiling board instead.
  const perfN = import.meta.env.DEV ? new URLSearchParams(location.search).get('seed') : null;
  let doc: Doc;
  if (perfN !== null) {
    const { seedPerfDoc } = await import('./state/seed');
    doc = seedPerfDoc(+perfN || 1600);
  } else if (fresh) {
    const { seedDoc } = await import('./state/seed');
    doc = seedDoc();
  } else {
    doc = migrateDoc(persisted!.doc);
  }
  void purgeOrphanBlobs(doc);
  const store = new Store(doc);
  const app = new App(document.getElementById('app')!, store, adapter);
  app.prefs = persisted?.prefs ?? {};
  app.applyPrefs();
  if (fresh && perfN === null) app.welcomeHint();
  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

  // #/e/<id> boots into the element's editor: synthesize a #/b/ history
  // entry underneath so history.back() exits to the board.
  const eid = editorIdFromHash();
  const eel = eid ? doc.elements[eid] : undefined;
  if (eel && (eel.type === 'document' || eel.type === 'sketch' || eel.type === 'image')) {
    app.openBoard(eel.boardId);
    history.pushState(null, '', `#/e/${eel.id}`);
    app.applyRoute();
  } else {
    const requested = boardIdFromHash() ?? adapter.lastBoard();
    const fallback =
      (doc.boards.home ? 'home' : undefined) ??
      Object.values(doc.boards).find((b) => b.parentId === null)?.id ??
      Object.values(doc.boards)[0]?.id;
    const start = requested && doc.boards[requested] ? requested : fallback;
    if (start) app.openBoard(start);
    app.applyRoute();
  }

  // Agent surface is a lazy chunk: ?do= command links and ?agent=
  // pairing plus the stored Local agent pref all boot it on demand.
  const q = new URLSearchParams(location.search);
  if (q.has('do') || q.has('agent') || app.prefs.agent) {
    const { init } = await import('./agent/index');
    init(app);
  }

  window.addEventListener('hashchange', () => app.applyRoute());
  window.addEventListener('pagehide', () => void app.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void app.flush();
  });
}
