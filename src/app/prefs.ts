import type { App } from '../app';
import { builtinTemplates } from '../state/templates';
import { migrateDoc, survivingBoard, type Element, type ID } from '../state/schema';
import type { Lang } from '../persist/storage';
import { blobTotalSize, rekeyBlobs } from '../persist/blobs';
import { clearEncMeta, getBox, hasBox, saveEncMeta, setBox, setupPassphrase, unlockWithPassphrase } from '../persist/crypto';
import { rekeySnapshots, createSnapshot, deleteSnapshot, listSnapshots, readSnapshot } from '../persist/snapshots';
import { syncDirSupported } from '../persist/syncdir';
import { lang as activeLang, t } from '../strings';
import { setFormatting, fmtDate } from '../locale';
import { choice, hint, toast } from '../ui/toast';
import { openNewBoardPicker } from '../ui/newboard';
import { openAboutPopup, openAgentPopup, openSettings, SCALE_STEPS } from '../ui/settings';
import { openEncryptPopup } from '../ui/encryptpop';
import { openSnapshotsPanel } from '../ui/snapshotpanel';
import { openSnapBrowsePanel, restoreSnapshotBoardActions, restoreSnapshotCardActions } from '../ui/snapbrowse';
import { openHelpMenu } from '../ui/toolpopups';
import { openShortcutsPanel } from '../ui/shortcutpanel';
import { installAvailable, runInstall } from '../ui/install';
import { isDark, setTheme, setUiScale, systemDark } from '../ui/theme';
import { CREATE_ITEMS } from '../ui/rail';

export class Preferences {
  constructor(private a: App) {}

  // Follow OS theme changes while the theme pref stays on System.
  init() {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!this.a.prefs.theme) this.applyPrefs();
      });
    } catch {}
  }


  applyPrefs() {
    // The lang/theme mirrors only exist for explicit choices so the
    // next boot can re-run browser/OS detection when a pref is unset.
    if (this.a.prefs.lang) localStorage.setItem('scatterboard:lang', this.a.prefs.lang);
    else localStorage.removeItem('scatterboard:lang');
    if (this.a.prefs.theme) localStorage.setItem('scatterboard:theme', this.a.prefs.theme);
    else localStorage.removeItem('scatterboard:theme');
    setTheme(this.a.prefs.theme ?? (systemDark() ? 'dark' : 'light'));
    setUiScale(this.a.prefs.uiScale ?? 1);
    setFormatting({
      browserLang: this.a.prefs.browserLang ?? true,
      lang: this.a.prefs.lang ?? activeLang(),
      currency: this.a.prefs.currency ?? null,
    });
    // Editable surfaces inherit spellcheck from the body element.
    document.body.spellcheck = this.a.prefs.spellcheck !== false;
    // Theme/scale change every card's colours and counter-scale, none
    // of which shows up as an element patch.
    this.a.refreshCards = true;
    this.a.renderer.invalidate();
    this.a.requestRender();
  }


  toggleTheme() {
    this.a.prefs.theme = isDark() ? 'light' : 'dark';
    this.applyPrefs();
    this.a.scheduleSave();
  }


  stepUiScale(dir: number) {
    const cur = this.a.prefs.uiScale ?? 1;
    const i = SCALE_STEPS.indexOf(cur);
    const next = SCALE_STEPS[Math.max(0, Math.min(SCALE_STEPS.length - 1, (i < 0 ? 1 : i) + dir))]!;
    if (next === cur) return;
    this.a.prefs.uiScale = next;
    this.applyPrefs();
    this.a.scheduleSave();
  }


  openHelp(anchor: HTMLElement) {
    openHelpMenu(anchor, {
      onShortcuts: () => openShortcutsPanel(),
      canInstall: installAvailable,
      onInstall: runInstall,
      onAbout: (a) =>
        openAboutPopup(a, {
          storage: async () => ({
            doc: this.a.adapter.docBytes(),
            blobs: await blobTotalSize(),
            persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
          }),
          lastExportAt: () => this.a.prefs.lastExportAt,
        }),
    });
  }


  // Robot-icon menu in the topbar: only local-agent state lives here;
  // the general online prefs stay in Settings.
  openAgentMenu(anchor: HTMLElement) {
    openAgentPopup(anchor, {
      flag: () => this.a.prefs.agent === true,
      onFlag: (_k, v) => {
        this.a.prefs.agent = v;
        this.a.scheduleSave();
        this.a.requestRender();
        void import('../agent/index').then((m) => m.setAgentEnabled(this.a, v));
      },
      agentStatus: () => this.a.agentConnected,
      agentPaired: () => !!this.a.prefs.agentBridge,
    });
  }


  openSettings(anchor: HTMLElement) {
    const save = () => this.a.scheduleSave();
    openSettings(anchor, {
      theme: () => this.a.prefs.theme ?? 'system',
      onTheme: (m) => {
        if (m === 'system') delete this.a.prefs.theme;
        else this.a.prefs.theme = m;
        this.applyPrefs();
        save();
      },
      scale: () => this.a.prefs.uiScale ?? 1,
      onScale: (sc) => {
        this.a.prefs.uiScale = sc;
        this.applyPrefs();
        save();
      },
      lang: () => this.a.prefs.lang ?? null,
      // Module-level label tables are captured at boot; switching
      // languages reloads the shell after the prefs flush.
      onLang: (l: Lang | null) => {
        if (l) {
          this.a.prefs.lang = l;
          localStorage.setItem('scatterboard:lang', l);
        } else {
          delete this.a.prefs.lang;
          localStorage.removeItem('scatterboard:lang');
        }
        this.a.scheduleSave();
        void this.a.flush().then(() => location.reload());
      },
      browserLang: () => this.a.prefs.browserLang ?? true,
      onBrowserLang: (v) => {
        this.a.prefs.browserLang = v;
        this.applyPrefs();
        save();
      },
      currency: () => this.a.prefs.currency ?? null,
      onCurrency: (c) => {
        if (c) this.a.prefs.currency = c;
        else delete this.a.prefs.currency;
        this.applyPrefs();
        save();
      },
      flag: (k) =>
        k === 'undoArrows' || k === 'autoEdit' || k === 'unfurl' || k === 'spellcheck'
          ? this.a.prefs[k] !== false
          : this.a.prefs[k] === true,
      onFlag: (k, v) => {
        if (k === 'reminders' && v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => {});
        }
        this.a.prefs[k] = v;
        save();
        if (k === 'spellcheck') document.body.spellcheck = v;
        if (k === 'reminders' && v) this.a.reminders.tick();
        this.a.requestRender();
        if (k === 'agent') void import('../agent/index').then((m) => m.setAgentEnabled(this.a, v));
      },
      agentStatus: () => this.a.agentConnected,
      agentPaired: () => !!this.a.prefs.agentBridge,
      guideAlpha: () => this.a.prefs.guideAlpha ?? 0,
      onGuideAlpha: (v) => {
        this.a.prefs.guideAlpha = v;
        save();
        this.a.requestRender();
      },
      onTemplates: () => {
        if (!this.a.boardId) return;
        const boardId = this.a.boardId;
        openNewBoardPicker(anchor, {
          builtins: () => builtinTemplates(),
          customs: () => Object.values(this.a.doc.templates).sort((a, b) => b.createdAt - a.createdAt),
          onPick: (tpl) => this.a.panels.placeBoard(boardId, this.a.viewCenter(), tpl),
          onRename: (id, name) => this.a.store.dispatch({ type: 'template.patch', id, patch: { name } }),
          onDelete: (id) => {
            const tpl = this.a.doc.templates[id];
            if (tpl) this.a.store.dispatch({ type: 'template.delete', tpl });
          },
        });
      },
      onReset: () => choice(t('resetAllQ'), t('resetAllAct'), () => void this.a.saver.resetAll()),
      railItems: () => {
        const order = this.a.prefs.railOrder ?? CREATE_ITEMS.map((i) => i.key);
        const hidden = new Set(this.a.prefs.railHidden ?? []);
        const seen = new Set<string>();
        const out: { key: string; label: string; hidden: boolean }[] = [];
        for (const key of order) {
          const it = CREATE_ITEMS.find((i) => i.key === key);
          if (it && !seen.has(key)) {
            seen.add(key);
            out.push({ key, label: it.label, hidden: hidden.has(key) });
          }
        }
        for (const it of CREATE_ITEMS) {
          if (!seen.has(it.key)) out.push({ key: it.key, label: it.label, hidden: hidden.has(it.key) });
        }
        return out;
      },
      onRailMove: (key, dir) => {
        const order = (this.a.prefs.railOrder ?? CREATE_ITEMS.map((i) => i.key)).slice();
        const i = order.indexOf(key);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j]!, order[i]!];
        this.a.prefs.railOrder = order;
        save();
        this.a.requestRender();
      },
      onRailHide: (key, hidden) => {
        const set = new Set(this.a.prefs.railHidden ?? []);
        if (hidden) set.add(key);
        else set.delete(key);
        this.a.prefs.railHidden = [...set];
        save();
        this.a.requestRender();
      },
      onRailReset: () => {
        delete this.a.prefs.railOrder;
        delete this.a.prefs.railHidden;
        save();
        this.a.requestRender();
      },
      syncDirSupported: () => syncDirSupported(),
      syncDirStatus: () => this.a.fsync.status(),
      onSyncDirPick: () => this.a.fsync.pick(),
      onSyncDirReconnect: () => this.a.fsync.reconnect(),
      onSyncDirStop: () => this.a.fsync.stop(),
      onBackupExport: () => void this.a.exporter.exportJson(),
      onSnapshots: () => this.openSnapshots(),
      encrypted: () => hasBox(),
      onEncrypt: (a) =>
        openEncryptPopup(a, {
          mode: 'enable',
          onExport: () => void this.a.exporter.exportJson(),
          onEnable: (pass) => this.enableEncryption(pass),
        }),
      onDecrypt: (a) =>
        openEncryptPopup(a, {
          mode: 'disable',
          onDisable: (pass) => this.disableEncryption(pass),
        }),
      onLockNow: () => void this.lockNow(),
    });
  }


  private async enableEncryption(passphrase: string) {
    const oldBox = getBox();
    const { box, meta } = await setupPassphrase(passphrase);
    await saveEncMeta(meta);
    setBox(box);
    await this.a.saver.saveDocNow();
    await rekeyBlobs(oldBox, box);
    await rekeySnapshots(oldBox, box);
    this.a.fsync.rekey();
    toast(t('encEnabledToast'), 'ok');
  }


  private async disableEncryption(passphrase: string): Promise<boolean> {
    const verified = await unlockWithPassphrase(passphrase);
    if (!verified) return false;
    const oldBox = getBox() ?? verified;
    setBox(null);
    await this.a.saver.saveDocNow();
    await rekeyBlobs(oldBox, null);
    await rekeySnapshots(oldBox, null);
    // Key metadata only goes away once plaintext is safely persisted:
    // a failure above leaves sealed data still unlockable.
    await clearEncMeta();
    this.a.fsync.rekey();
    toast(t('encRemovedToast'), 'ok');
    return true;
  }


  private async lockNow() {
    await this.a.flush();
    setBox(null);
    this.a.reloadDiscarding();
  }


  // Settings "Version history" row: named workspace snapshots stored
  // outside the doc (persist/snapshots.ts), restored through the
  // adapter save plus a reload.
  private openSnapshots() {
    this.a.panels.closePanel();
    openSnapshotsPanel({
      list: () => listSnapshots(),
      onNew: async () => {
        try {
          await createSnapshot(this.a.doc, this.a.prefs, fmtDate(Date.now()), false);
          toast(t('snapTaken'), 'ok');
        } catch {
          toast(t('snapFail'), 'err');
        }
      },
      onRestore: (id) => {
        choice(t('snapRestoreQ'), t('snapRestoreAct'), () => void this.restoreSnapshot(id));
      },
      onBrowse: (id) => {
        void this.browseSnapshot(id);
      },
      onDelete: (id) => {
        void deleteSnapshot(id);
      },
    });
  }


  private async browseSnapshot(id: ID) {
    const w = await readSnapshot(id).catch(() => null);
    if (!w) {
      toast(t('snapFail'), 'err');
      return;
    }
    const snapDoc = migrateDoc(w.doc);
    this.a.panels.closePanel();
    openSnapBrowsePanel({
      doc: snapDoc,
      snippetFor: (el) => this.a.panels.snippetFor(el),
      onRestoreBoard: (boardId) => {
        if (this.a.lockedView()) return;
        const host = survivingBoard(this.a.doc, undefined, this.a.boardId);
        const res = host ? restoreSnapshotBoardActions(this.a.doc, snapDoc, boardId, host) : null;
        if (!res) {
          toast(t('snapFail'), 'err');
          return;
        }
        this.a.store.dispatch({ type: 'batch', actions: res.actions });
        this.a.openBoard(res.boardId);
        toast(t('snapRestored'), 'ok');
      },
      onRestoreCard: (el: Element) => {
        if (this.a.lockedView()) return;
        const host = survivingBoard(this.a.doc, undefined, this.a.boardId);
        const res = host ? restoreSnapshotCardActions(this.a.doc, el, host) : null;
        if (!res || !host) {
          toast(t('snapFail'), 'err');
          return;
        }
        this.a.store.dispatch({ type: 'batch', actions: res.actions });
        if (this.a.boardId !== host) this.a.openBoard(host);
        this.a.setSelection([res.id]);
        toast(t('snapRestored'), 'ok');
      },
    });
  }


  private async restoreSnapshot(id: ID) {
    const w = await readSnapshot(id).catch(() => null);
    if (!w) {
      toast(t('snapFail'), 'err');
      return;
    }
    // Freeze autosave before the restore write: a pending saveNow
    // landing after it would silently overwrite the restored doc.
    this.a.beginExternalSave();
    try {
      await this.a.saveExternal({ version: 1, doc: migrateDoc(w.doc), savedAt: Date.now(), prefs: w.prefs ?? this.a.prefs });
    } catch {
      this.a.endExternalSave();
      toast(t('snapFail'), 'err');
      return;
    }
    this.a.notifyExternalSave();
    this.a.reloadDiscarding();
  }


  // First run only: one quiet dismissible hint, then never again.
  welcomeHint() {
    if (this.a.prefs.welcomed) return;
    hint(t('welcomeToast'), () => {
      this.a.prefs.welcomed = true;
      this.a.scheduleSave();
    });
  }
}
