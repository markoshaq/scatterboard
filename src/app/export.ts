import type { App } from '../app';
import { blobRefOf, lineDoc, survivingBoard, UNSORTED, type Element, type ID } from '../state/schema';
import { getBlob } from '../persist/blobs';
import { Viewport, type Rect } from '../canvas/viewport';
import { CardsLayer } from '../cards/layer';
import type { CardEvents } from '../cards/note';
import { busy, toast } from '../ui/toast';
import { unionRect } from '../canvas/hit';
import { t } from '../strings';
import { ChipsLayer } from '../ui/chips';
import { downloadTextFile } from '../draw/strokes';
import { openExportMenu } from '../export/menu';
import { dedupFileName, downloadBlob, slugFileName } from '../export/download';
import type { ZipEntry } from '../export/zip';
import type { FallbackCard, ShotSpec } from '../export/boardpng';
// Card events for the offscreen CardsLayer used by board raster export:
// real handlers all reach back into the live layer/app, so exports use
// silent stubs instead.
const SHOT_EVENTS: CardEvents = {
  onTextInput: () => {},
  onContent: () => {},
  onMeasure: () => {},
  onResizeHandle: () => {},
  onEditEnd: () => {},
  onLinkPopup: () => {},
  onEditField: () => {},
  onCellFocus: () => {},
};


export class BoardExport {
  constructor(private a: App) {}


  exportSubs = false;


  // --- export ---

  openExportMenu(anchor: HTMLElement) {
    if (!this.a.boardId) return;
    openExportMenu(anchor, {
      hasMedia: () => this.boardMedia().length > 0,
      subs: () => this.exportSubs,
      onToggleSubs: () => {
        this.exportSubs = !this.exportSubs;
      },
      onPng: () => void this.exportPng(),
      onPdf: (hi) => void this.exportPdf(hi),
      onDoc: (kind) => this.exportLinear(kind),
      onFiles: () => void this.exportFilesZip(),
      onJson: () => this.exportJson(),
      onImport: () => this.importJson(),
    });
  }


  exportFileBase(): string {
    return slugFileName(this.a.board()?.title ?? 'board');
  }


  // Image/file elements live on this board (not filed to unsorted, not
  // nested in sub-boards). Column members count: they sit on the canvas.
  boardMedia(boardId: ID | null = this.a.boardId): Element[] {
    return Object.values(this.a.doc.elements).filter(
      (e) => e.boardId === boardId && e.parentId !== UNSORTED && blobRefOf(e) !== null,
    );
  }


  // Render the board (or, with `only`, just the picked cards) to an
  // offscreen canvas at `scale` (css px per board unit). Cards are
  // rasterized via an svg foreignObject snapshot when the engine
  // allows it; otherwise a simple canvas pass draws card rects + text
  // (see export/boardpng.ts).
  async boardRaster(scale: number, region?: Rect, only?: Set<ID>): Promise<HTMLCanvasElement | null> {
    const boardId = this.a.boardId;
    if (!boardId) return null;
    this.a.editing.endEdit();
    const inLimit = (e: Element) => !only || only.has(e.id) || (e.anchorId !== undefined && only.has(e.anchorId));
    // Members cannot mount standalone: pull their parent chain into
    // the mount set so the member renders inside its column, while the
    // crop still bounds to the picked set alone.
    const mountIds = only ? new Set(only) : null;
    if (only && mountIds) {
      for (const id of only) {
        for (
          let p = this.a.doc.elements[id]?.parentId;
          p && p !== UNSORTED;
          p = this.a.doc.elements[p]?.parentId ?? null
        ) {
          mountIds.add(p);
        }
      }
    }
    const inShot = (e: Element) => inLimit(e) || (mountIds !== null && mountIds.has(e.id));
    const boundEls = this.a.layer.elements().filter(inLimit);
    if (only) {
      // Members are not in elements(): the crop still needs their rects.
      for (const id of only) {
        const e = this.a.doc.elements[id];
        if (e && !boundEls.includes(e)) boundEls.push(e);
      }
    }
    const u = unionRect(boundEls.map((e) => this.a.layer.rectOf(e)));
    const pad = 80;
    // An explicit region crops exactly; otherwise the bounds cover
    // every card plus padding (or a default 800x600 for empty boards).
    const bounds: Rect = region
      ? { ...region }
      : u
        ? { x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 }
        : { x: 0, y: 0, w: 800, h: 600 };

    // The live layer culls off-screen cards, so mount a second layer
    // covering the full bounds in a hidden staging node.
    const fvp = new Viewport();
    fvp.vw = bounds.w;
    fvp.vh = bounds.h;
    fvp.x = -bounds.x;
    fvp.y = -bounds.y;
    fvp.z = 1;
    const off = new CardsLayer(this.a.doc, fvp, SHOT_EVENTS, () => this.a.store.rev);
    off.boardId = boardId;
    off.limit = mountIds;
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:visible;pointer-events:none';
    stage.appendChild(off.node);
    document.body.appendChild(stage);
    off.sync(new Set(), null, true);
    // Selection shots keep a line when it was picked itself or when
    // both card endpoints came along.
    const lines = only
      ? this.a.resolvedLines().filter((l) => {
          if (only.has(l.el.id)) return true;
          const c = lineDoc(l.el);
          return !!c?.from.el && !!c.to.el && only.has(c.from.el) && only.has(c.to.el);
        })
      : this.a.resolvedLines();
    let dom: HTMLElement;
    try {
      const { buildShotDom, inlineBlobImages, settleImages } = await import('../export/boardpng');
      // A board switch mid-export would mix two boards into one shot:
      // bail at every await boundary.
      if (this.a.boardId !== boardId) return null;
      await settleImages(off.node);
      if (this.a.boardId !== boardId) return null;

      // Live overlays are already synced for the whole board (labels,
      // pins, annotations); chips and label pills are viewport-culled,
      // so the throwaway chip layer and an all-lines pill sync cover
      // every card instead. Seated pins/anno svgs live inside .cards:
      // park them in their hosts so the clone sees them, then re-seat
      // after the snapshot.
      const chips = new ChipsLayer(this.a.doc, { onChip: () => {} });
      chips.sync(this.a.overlays.chipTargets(true, off));
      this.a.overlays.anno.sync(this.a.overlays.annoItems(true).filter((i) => inShot(i.el)));
      this.a.overlays.pins.sync(this.a.overlays.pinItems(off, true).map((p) => ({ ...p, seat: null })));
      this.a.overlays.syncLabelPills(lines, true);
      dom = buildShotDom(
        off.node,
        [this.a.overlays.anno.node, this.a.overlays.pins.node, this.a.overlays.labelHost, chips.node],
        bounds,
        (id) => this.a.doc.elements[id]?.z,
      );
      await inlineBlobImages(dom);
      if (this.a.boardId !== boardId) return null;
    } finally {
      off.destroy();
      stage.remove();
      this.a.overlays.syncAnno();
      this.a.overlays.syncPins();
      this.a.overlays.syncLabelPills(this.a.resolvedLines());
    }

    const spec: ShotSpec = {
      bounds,
      grid: this.a.board()?.grid ?? true,
      lines,
      dom,
      cards: this.a.layer
        .elements()
        .filter((e) => e.type !== 'line' && e.type !== 'annotation' && e.anchorId === undefined && inShot(e))
        .map((e): FallbackCard => ({ rect: this.a.layer.rectOf(e), label: this.a.panels.snippetFor(e), color: e.color })),
      annotations: this.a.layer.elements().filter((e) => e.type === 'annotation' && inShot(e)),
      pins: this.a.layer
        .elements()
        .filter((e) => e.type === 'comment' && e.anchorId !== undefined && inShot(e))
        .map((e) => this.a.layer.rectOf(e)),
    };
    try {
      const { renderBoardShot } = await import('../export/boardpng');
      if (this.a.boardId !== boardId) return null;
      const cv = await renderBoardShot(spec, scale);
      return this.a.boardId === boardId ? cv : null;
    } catch {
      return null;
    }
  }


  // Shared raster path for the Export menu and the agent snapshot
  // command: opens the board first when the caller targets another one.
  async snapshotPng(boardId?: ID, region?: Rect, scale = 2): Promise<Blob | null> {
    if (boardId && boardId !== this.a.boardId) this.a.openBoard(boardId);
    // openBoard no-ops on a missing id: without this check the raster
    // would silently shoot the board already open.
    if (boardId && this.a.boardId !== boardId) return null;
    const cv = await this.boardRaster(scale, region);
    if (!cv) return null;
    const { toBlob } = await import('../export/boardpng');
    return toBlob(cv, 'image/png');
  }


  // Card menu 'Copy as image': rasterize just the selection (column
  // members ride along inside their column) and put a png on the OS
  // clipboard.
  async copySelectionImage() {
    const set = this.a.copySet();
    if (!set.length) return;
    const done = busy(t('copyBusy'));
    try {
      const cv = await this.boardRaster(2, undefined, new Set(set.map((e) => e.id)));
      const { toBlob } = await import('../export/boardpng');
      const blob = cv && (await toBlob(cv, 'image/png'));
      if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        toast(t('copyFail'), 'err');
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(t('copied'), 'ok');
    } catch {
      toast(t('copyFail'), 'err');
    } finally {
      done();
    }
  }


  async exportPng() {
    const done = busy(t('exBusy'));
    try {
      const blob = await this.snapshotPng();
      if (!blob) {
        toast(t('exFail'), 'err');
        return;
      }
      downloadBlob(`${this.exportFileBase()}.png`, blob);
      toast(t('exDone'), 'ok');
    this.a.markExported();
    } finally {
      done();
    }
  }


  async exportPdf(hi: boolean) {
    const done = busy(t('exBusy'));
    try {
      const scale = hi ? 2 : 1;
      const cv = await this.boardRaster(scale);
      const { toBlob } = await import('../export/boardpng');
      const blob = cv && (await toBlob(cv, 'image/jpeg', hi ? 0.95 : 0.8));
      if (!cv || !blob) {
        toast(t('exFail'), 'err');
        return;
      }
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const { jpegToPdf } = await import('../export/pdf');
      // Page sized to the raster's aspect: board units at 96dpi -> pt.
      const pdf = jpegToPdf(jpeg, cv.width, cv.height, (cv.width / scale) * 0.75, (cv.height / scale) * 0.75);
      downloadBlob(`${this.exportFileBase()}.pdf`, pdf);
      toast(t('exDone'), 'ok');
    this.a.markExported();
    } finally {
      done();
    }
  }


  async exportLinear(kind: 'doc' | 'md' | 'txt') {
    if (!this.a.boardId) return;
    this.a.editing.endEdit();
    const { boardItems, toMarkdown, toPlain, toWordHtml } = await import('../export/linear');
    const title = this.a.board()?.title ?? '';
    const items = boardItems(this.a.doc, this.a.boardId, this.exportSubs);
    const base = this.exportFileBase();
    if (kind === 'md') downloadTextFile(`${base}.md`, toMarkdown(title, items), 'text/markdown');
    else if (kind === 'txt') downloadTextFile(`${base}.txt`, toPlain(title, items));
    else downloadTextFile(`${base}.doc`, toWordHtml(title, items), 'application/msword');
    toast(t('exDone'), 'ok');
    this.a.markExported();
  }


  // The export menu wraps this in a download; the agent surface calls
  // it directly. Missing/dead blobs are skipped.
  async mediaZip(boardId: ID): Promise<Blob | null> {
    const els = this.boardMedia(boardId);
    if (!els.length) return null;
    const entries: ZipEntry[] = [];
    const used = new Set<string>();
    for (const el of els) {
      const ref = blobRefOf(el);
      if (!ref) continue;
      const blob = await getBlob(ref).catch(() => undefined);
      if (!blob) continue;
      // Stored names become zip paths: strip separators so a hostile
      // or odd file name can't forge directories inside the archive.
      const stored = (
        'image' in el.content ? el.content.image.name : 'file' in el.content ? el.content.file.name : ''
      ).replace(/[\\/]/g, '');
      const name = dedupFileName(stored || (el.type === 'image' ? `image-${el.id}.png` : `file-${el.id}`), used);
      try {
        entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      } catch {
        return null;
      }
    }
    if (!entries.length) return null;
    const { zipStore } = await import('../export/zip');
    return zipStore(entries);
  }


  async exportFilesZip() {
    if (!this.a.boardId) return;
    const done = busy(t('exBusy'));
    try {
      const blob = await this.mediaZip(this.a.boardId);
      if (!blob) {
        toast(t('exFail'), 'err');
        return;
      }
      downloadBlob(`${this.exportFileBase()}-files.zip`, blob);
      toast(t('exDone'), 'ok');
    this.a.markExported();
    } finally {
      done();
    }
  }


  async exportJson() {
    if (!this.a.boardId) return;
    // Commit any open edit session first: PNG/PDF/linear all do this,
    // and a mid-edit export would serialize pre-edit content.
    this.a.editing.endEdit();
    const { exportBoard } = await import('../export/boardio');
    const text = exportBoard(this.a.doc, this.a.boardId);
    if (!text) {
      toast(t('exFail'), 'err');
      return;
    }
    downloadTextFile(`${this.exportFileBase()}.json`, text, 'application/json');
    toast(t('exDone'), 'ok');
    this.a.markExported();
  }


  importJson() {
    if (this.a.lockedView()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'import-json';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        const done = busy(t('exImportBusy'));
        try {
          const { importActions, parseBoardExport } = await import('../export/boardio');
          const data = parseBoardExport(await file.text());
          // Imported boards attach under Home; shared surviving-board
          // policy falls back to the doc root or the current board.
          const host = survivingBoard(this.a.doc, undefined, this.a.boardId);
          const res = data && host ? importActions(this.a.doc, data, host) : null;
          if (!res) {
            toast(t('exImportFail'), 'err');
            return;
          }
          this.a.store.dispatch({ type: 'batch', actions: res.actions });
          this.a.openBoard(res.boardId);
          toast(t('exImportDone'), 'ok');
        } catch {
          toast(t('exImportFail'), 'err');
        } finally {
          done();
        }
      })();
    });
    input.click();
  }

}
