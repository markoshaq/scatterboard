import type { App } from '../app';
import type { PersistedWorkspace } from '../persist/storage';
import { clearBlobs } from '../persist/blobs';
import { clearExtra } from '../persist/kv';
import { initTabSync } from '../persist/tabs';
import { t } from '../strings';
import { choice, toast } from '../ui/toast';

const SAVE_DEBOUNCE = 700;

export class Saver {
  private saveTimer: number | null = null;

  private saveState: 'saved' | 'saving' = 'saved';

  private saveKind: 0 | 1 | 2 = 0;

  // Serialized write chain: every adapter.save queues on saveTail so
  // concurrent saveNow callers (debounce, markExported, flush,
  // encryption transitions) can never complete out of order.
  // savePending counts writes still queued or running; 'saved' is only
  // reported once it drains with nothing debounced behind it.
  private saveTail: Promise<void> = Promise.resolve();

  private savePending = 0;

  private saveChip = false;

  // Consecutive doc-save failures; a streak means storage is broken
  // (quota, blocked IDB), not a transient hiccup, and earns a warning.
  private saveFails = 0;

  private saveWarned = false;

  // Set before a reload that intentionally discards local state (a
  // newer workspace arrived from another tab or the backup): flush()
  // must not write the stale doc back over it.
  private skipFlush = false;

  private foreignSaveAsked = false;

  // Another tab saved a newer doc while this one still had queued
  // writes. Doc writes hold until the user answers the reload prompt:
  // landing one mid-prompt would clobber the foreign doc silently.
  private foreignNewer = false;

  private tabSync: { notifySaved(): void } | null = null;

  constructor(private a: App) {}

  // Second open tab: the other tab's save announces itself over the
  // channel so this one pulls the newer doc instead of clobbering it.
  init() {
    this.tabSync = initTabSync(() => this.onForeignSave());
  }

  scheduleSave() {
    this.markSave(2);
  }


  // Viewport-only path: writes a small per-board position row instead
  // of serializing the whole doc.
  schedulePosSave() {
    this.markSave(1);
  }


  private markSave(kind: 1 | 2) {
    if (kind > this.saveKind) this.saveKind = kind;
    this.saveState = 'saving';
    // Camera-only saves (kind 1) write a small position row: persist
    // them silently. The chip only reports real doc changes.
    if (kind === 2 && !this.saveChip) {
      this.saveChip = true;
      this.a.topbar.setSaveState('saving');
    }
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, SAVE_DEBOUNCE);
  }


  markExported() {
    this.a.prefs.lastExportAt = Date.now();
    void this.saveNow();
  }

  // Encryption transitions force a full doc write through the queue
  // without waiting for the debounce.
  saveDocNow(): Promise<void> {
    this.saveKind = 2;
    return this.saveNow();
  }

  // Every save request enqueues one write on the tail chain; the write
  // re-reads saveKind when it runs, so a queued write always persists
  // the newest required state. skipFlush freezes the path entirely:
  // an external write (snapshot/folder restore, foreign-save reload)
  // is about to supersede this doc.
  private saveNow(): Promise<void> {
    if (this.skipFlush) return Promise.resolve();
    this.savePending++;
    // Swallow rejections: the tail must keep draining and callers
    // treat failures internally (writeSave reports via saveFails).
    const p = this.saveTail.then(() => this.writeSave()).catch(() => {});
    this.saveTail = p;
    return p;
  }

  private async writeSave() {
    const kind = this.saveKind;
    if (kind === 2 && this.foreignNewer) {
      this.savePending--;
      return;
    }
    this.saveKind = 0;
    const board = this.a.board();
    if (board) board.position = this.a.vp.snapshot();
    try {
      if (kind === 1) {
        if (board) await this.a.adapter.saveBoardPos(board.id, board.position!);
      } else {
        const w = { version: 1, doc: this.a.doc, savedAt: Date.now(), prefs: this.a.prefs };
        await this.a.adapter.save(w);
        this.a.lastSavedAt = w.savedAt;
        // Other tabs reload off this save; the folder mirror trails it.
        this.tabSync?.notifySaved();
        this.a.fsync.onSaved();
      }
    } catch {
      // Keep 'saving': the chip stays honest and flush() retries on
      // pagehide instead of the rejection going unhandled. A streak of
      // doc-save failures means storage is really broken, so warn once
      // and offer an export rather than losing work quietly.
      if (kind === 2 && ++this.saveFails >= 3 && !this.saveWarned) {
        this.saveWarned = true;
        choice(t('saveFail'), t('exportAs'), () => void this.a.exporter.exportJson());
      }
      return;
    } finally {
      this.savePending--;
    }
    this.saveFails = 0;
    this.saveWarned = false;
    // 'saved' only once the queue is empty and nothing is debounced:
    // a kind-1 write completing while a doc save is pending must not
    // report saved, or flush() could slip past unwritten data.
    if (this.savePending === 0 && this.saveKind === 0 && this.saveTimer === null) {
      this.saveState = 'saved';
      if (this.saveChip) {
        this.saveChip = false;
        this.a.topbar.setSaveState('saved');
      }
    }
  }


  // Another tab announced a doc save. A clean tab pulls it silently;
  // a dirty or busy one asks first because the reload drops in-flight
  // work. skipFlush guards the stale doc on the way out either way.
  private onForeignSave() {
    this.foreignNewer = true;
    if (this.saveState === 'saved' && !this.a.editingId && !this.a.overlayOpen && !this.a.presenting) {
      this.reloadDiscarding();
      return;
    }
    if (this.foreignSaveAsked) return;
    this.foreignSaveAsked = true;
    choice(
      t('tabChanged'),
      t('tabReload'),
      () => this.reloadDiscarding(),
      () => {
        this.foreignSaveAsked = false;
        // Keep-local is the informed choice now: release the held doc
        // save so this tab's work still persists.
        this.foreignNewer = false;
        this.scheduleSave();
      },
      0,
    );
  }


  reloadDiscarding() {
    this.skipFlush = true;
    location.reload();
  }


  async flush() {
    if (this.skipFlush) return;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // Pending work gets a queued write; a write already in flight or
    // queued must also complete before flush returns.
    if (this.saveState === 'saving' || this.saveKind > 0) await this.saveNow();
    else await this.saveTail;
  }

  // External workspace writes (snapshot/folder restores) must land
  // after any in-flight autosave and stay last: freeze the save path
  // first so a debounced or queued saveNow can't slip a stale doc in
  // behind the restore, then chain the write behind saveTail.
  beginExternalSave() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.skipFlush = true;
  }

  // Re-arm autosave when the external write never landed; pending
  // edits need their debounce back.
  endExternalSave() {
    this.skipFlush = false;
    this.scheduleSave();
  }

  saveExternal(w: PersistedWorkspace): Promise<void> {
    const p = this.saveTail.then(() => this.a.adapter.save(w));
    this.saveTail = p.then(
      () => {},
      () => {},
    );
    return p;
  }

  // Folder-backup and snapshot restores write through the adapter
  // directly; other tabs still need the reload nudge.
  notifyExternalSave() {
    this.tabSync?.notifySaved();
  }


  // Settings "Reset everything": wipe doc storage, blobs and prefs,
  // then reload so the boot path re-seeds a fresh default doc.
  async resetAll() {
    try {
      await this.flush();
      localStorage.removeItem('scatterboard:lang');
      localStorage.removeItem('scatterboard:theme');
      await this.a.adapter.clear();
      await clearBlobs();
      await clearExtra();
    } catch {
      toast(t('exFail'), 'err');
      return;
    }
    location.reload();
  }
}
