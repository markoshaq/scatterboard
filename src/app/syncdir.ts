import type { App } from '../app';
import { migrateDoc } from '../state/schema';
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
  writeBackup,
  type BackupPayload,
} from '../persist/syncdir';

export type SyncState = 'off' | 'on' | 'denied' | 'fail';

const SYNC_DEBOUNCE = 3000;

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
    this.state = 'on';
    if ((await dirPermission(this.handle)) !== 'granted') {
      this.state = 'denied';
      return;
    }
    const backup = await readBackup(this.handle).catch(() => null);
    if (backup && backup.savedAt > this.a.lastSavedAt + 5000) {
      const w = backup;
      choice(t('backupNewer'), t('backupRestore'), () => void this.restore(w));
    }
    // Prime the mirrored set from the folder listing so the first sync
    // does not rewrite every blob.
    void this.primeMirrored();
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

  async flush() {
    if (!this.handle || this.state === 'off') return;
    try {
      if ((await dirPermission(this.handle)) !== 'granted') {
        this.state = 'denied';
        return;
      }
      await writeBackup(this.handle, this.a.doc, this.a.prefs, this.mirrored);
      this.lastSyncAt = Date.now();
      this.state = 'on';
    } catch {
      this.state = 'fail';
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
    try {
      await restoreMedia(this.handle, w.doc);
      await this.a.adapter.save({
        version: 1,
        doc: migrateDoc(w.doc),
        savedAt: Date.now(),
        prefs: w.prefs ?? this.a.prefs,
      });
    } catch {
      toast(t('backupFail'), 'err');
      return;
    }
    this.a.notifyExternalSave();
    this.a.reloadDiscarding();
  }
}
