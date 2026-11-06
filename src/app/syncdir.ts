import type { App } from '../app';
import { migrateDoc, saneContent } from '../state/schema';
import { scrubContent } from '../ui/sanitize';
import { choice, toast } from '../ui/toast';
import { t } from '../strings';
import {
  dirPermission,
  forgetSyncDir,
  loadSyncDir,
  pickSyncDir,
  readBackup,
  requestDirPermission,
  restoreMedia,
  saveSyncDirHandle,
  syncDirSupported,
  writeBackup,
  type BackupPayload,
} from '../persist/syncdir';

export type SyncState = 'off' | 'on' | 'denied' | 'fail';

const SYNC_DEBOUNCE = 3000;
const NAG_EXPORT_AGE = 14 * 86400000;
const NAG_SNOOZE_AGE = 7 * 86400000;
const NAG_BOOT_DELAY = 10000;

export function shouldNag(
  now: number,
  lastExportAt: number | undefined,
  backupNagAt: number | undefined,
  hasDir: boolean,
  hasElements: boolean,
): boolean {
  if (hasDir || !hasElements) return false;
  if (now - (lastExportAt ?? 0) <= NAG_EXPORT_AGE) return false;
  if (now - (backupNagAt ?? 0) <= NAG_SNOOZE_AGE) return false;
  return true;
}

// Folder backup collaborator: owns the stored directory handle, the
// post-save mirror write, and the boot-time "backup is newer" restore
// offer. Pure fs ops live in persist/syncdir.ts.
export class FolderSync {
  handle: FileSystemDirectoryHandle | null = null;

  state: SyncState = 'off';

  lastSyncAt = 0;

  private timer: number | null = null;

  // Refs already mirrored into media/, so a save only writes new blobs.
  private mirrored = new Set<string>();

  constructor(private a: App) {}

  // Boot path: restore a stored handle, then compare the backup's
  // savedAt against the workspace this session loaded. A newer file
  // means another device or browser wrote since, so offer a restore.
  async init() {
    this.handle = await loadSyncDir();
    if (!this.handle) return;
    if ((await dirPermission(this.handle)) !== 'granted') {
      this.state = 'denied';
      return;
    }
    const backup = await readBackup(this.handle).catch(() => null);
    if (backup && backup !== 'locked' && backup.savedAt > this.a.lastSavedAt + 5000) {
      const w = backup;
      // Sync stays off until the offer resolves: an autosave flush in
      // this window would overwrite the newer backup it offers, and
      // dismissing the toast must not silently destroy it.
      choice(
        t('backupNewer'),
        t('backupRestore'),
        () => void this.restore(w),
        () => {
          this.state = 'on';
          this.onSaved();
        },
      );
    } else {
      this.state = 'on';
    }
    // Prime the mirrored set from the folder listing so the first sync
    // does not rewrite every blob.
    void this.primeMirrored();
  }

  rekey() {
    this.mirrored.clear();
    this.onSaved();
  }

  maybeNagBackup() {
    window.setTimeout(() => {
      const now = Date.now();
      const hasDir = syncDirSupported() && this.handle !== null;
      const hasElements = Object.keys(this.a.doc.elements).length > 0;
      if (!shouldNag(now, this.a.prefs.lastExportAt, this.a.prefs.backupNagAt, hasDir, hasElements)) return;
      choice(
        t('backupNag'),
        t('exportAs'),
        () => void this.a.exporter.exportJson(),
        () => {
          this.a.prefs.backupNagAt = Date.now();
          this.a.scheduleSave();
        },
      );
    }, NAG_BOOT_DELAY);
  }

  private async primeMirrored() {
    if (!this.handle) return;
    try {
      const media = (await this.handle.getDirectoryHandle('media')) as FileSystemDirectoryHandle & {
        keys(): AsyncIterableIterator<string>;
      };
      for await (const name of media.keys()) {
        if (name !== 'index.json') this.mirrored.add(name);
      }
    } catch {
      /* no media dir yet */
    }
  }

  // Every successful doc save lands here; the write trails edits by a
  // few seconds so a typing burst coalesces into one mirror.
  onSaved() {
    if (!this.handle || this.state === 'off') return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), SYNC_DEBOUNCE);
  }

  // One write in flight; a flush requested mid-write re-runs once so
  // the newest workspace always lands last. stop() clearing the
  // handle mid-write breaks the loop before 'on' can be re-marked.
  private writing = false;
  private pending = false;

  async flush() {
    if (!this.handle || this.state === 'off') return;
    if (this.writing) {
      this.pending = true;
      return;
    }
    this.writing = true;
    try {
      while (this.handle && (this.state as SyncState) !== 'off') {
        this.pending = false;
        if ((await dirPermission(this.handle)) !== 'granted') {
          this.state = 'denied';
          break;
        }
        await writeBackup(this.handle, this.a.doc, this.a.prefs, this.mirrored);
        this.lastSyncAt = Date.now();
        if (!this.handle) break;
        this.state = 'on';
        if (!this.pending) break;
      }
    } catch {
      this.state = 'fail';
    } finally {
      this.writing = false;
    }
  }

  async pick() {
    const h = await pickSyncDir();
    if (!h) return;
    this.handle = h;
    this.mirrored.clear();
    await saveSyncDirHandle(h).catch(() => {});
    await this.flush();
    if (this.state === 'on') toast(t('backupDone'), 'ok');
    else if (this.state === 'fail') toast(t('backupFail'), 'err');
  }

  // Re-request write access from a settings row (needs a user gesture).
  async reconnect() {
    if (!this.handle) return;
    if ((await requestDirPermission(this.handle)) !== 'granted') return;
    this.state = 'on';
    await this.flush();
  }

  async stop() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.handle = null;
    this.mirrored.clear();
    this.state = 'off';
    await forgetSyncDir().catch(() => {});
  }

  async status(): Promise<{ name: string; state: SyncState; lastSyncAt: number } | null> {
    if (!this.handle) return null;
    return { name: this.handle.name, state: this.state, lastSyncAt: this.lastSyncAt };
  }

  private async restore(w: BackupPayload) {
    if (!this.handle) return;
    // Freeze autosave before any restore work: a pending saveNow
    // landing after the workspace write would clobber the backup.
    this.a.beginExternalSave();
    try {
      const doc = migrateDoc(w.doc);
      // A folder backup is untrusted input: drop elements whose
      // content fails the shape check and sanitize every html field,
      // same contract as the boardio import path.
      for (const el of Object.values(doc.elements)) {
        if (!saneContent(el.content, el.type)) delete doc.elements[el.id];
        else scrubContent(el.content);
      }
      await restoreMedia(this.handle, doc);
      await this.a.saveExternal({
        version: 1,
        doc,
        savedAt: Date.now(),
        prefs: w.prefs ?? this.a.prefs,
      });
    } catch {
      this.a.endExternalSave();
      toast(t('backupFail'), 'err');
      return;
    }
    this.state = 'on';
    this.a.notifyExternalSave();
    this.a.reloadDiscarding();
  }
}
