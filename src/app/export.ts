import type { App } from '../app';
import { blobRefOf, UNSORTED, type Element } from '../state/schema';
import { getBlob } from '../persist/blobs';
import { Viewport, type Rect } from '../canvas/viewport';
import { CardsLayer } from '../cards/layer';
import type { CardEvents } from '../cards/note';
import { toast } from '../ui/toast';
import { unionRect } from '../canvas/hit';
import { t } from '../strings';
import { ChipsLayer } from '../ui/chips';
import { downloadTextFile } from '../draw/strokes';
import { openExportMenu } from '../export/menu';
import { dedupFileName, downloadBlob, slugFileName } from '../export/download';
import { zipStore, type ZipEntry } from '../export/zip';
import { jpegToPdf } from '../export/pdf';
import { buildShotDom, inlineBlobImages, renderBoardShot, settleImages, toBlob, type FallbackCard, type ShotSpec } from '../export/boardpng';
import { boardItems, toMarkdown, toPlain, toWordHtml } from '../export/linear';
import { exportBoard, importActions, parseBoardExport } from '../export/jsonio';
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
  boardMedia(): Element[] {
    return Object.values(this.a.doc.elements).filter(
      (e) => e.boardId === this.a.boardId && e.parentId !== UNSORTED && blobRefOf(e) !== null,
    );
  }


  // Render the whole board to an offscreen canvas at `scale` (css px per
  // board unit). Cards are rasterized via an svg foreignObject snapshot
  // when the engine allows it; otherwise a simple canvas pass draws
  // card rects + text (see export/boardpng.ts).
  async boardRaster(scale: number): Promise<HTMLCanvasElement | null> {
    if (!this.a.boardId) return null;
    this.a.editing.endEdit();
    const u = unionRect(this.a.layer.elements().map((e) => this.a.layer.rectOf(e)));
    const pad = 80;
    const bounds: Rect = u
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
    off.boardId = this.a.boardId;
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:visible;pointer-events:none';
    stage.appendChild(off.node);
    document.body.appendChild(stage);
    off.sync(new Set(), null, true);
    await settleImages(off.node);

    // Live overlays are already synced for the whole board (labels,
    // pins, annotations); chips are viewport-culled, so a throwaway
    // layer is synced against every card instead. Seated pins/anno svgs
    // live inside .cards: park them in their hosts so the clone sees
    // them, then re-seat after the snapshot.
    const chips = new ChipsLayer(this.a.doc);
    chips.sync(this.a.chipTargets(true, off));
    this.a.anno.sync(this.a.annoItems());
    this.a.pins.sync(this.a.pinItems(off).map((p) => ({ ...p, seat: null })));
    const dom = buildShotDom(off.node, [this.a.anno.node, this.a.pins.node, this.a.labelHost, chips.node], bounds);
    await inlineBlobImages(dom);
    off.destroy();
    stage.remove();
    this.a.syncAnno();
    this.a.syncPins();

    const spec: ShotSpec = {
      bounds,
      grid: this.a.board()?.grid ?? true,
      lines: this.a.resolvedLines(),
      dom,
      cards: this.a.layer
        .elements()
        .filter((e) => e.type !== 'line' && e.type !== 'annotation' && e.anchorId === undefined)
        .map((e): FallbackCard => ({ rect: this.a.layer.rectOf(e), label: this.a.panels.snippetFor(e), color: e.color })),
      annotations: this.a.layer.elements().filter((e) => e.type === 'annotation'),
      pins: this.a.layer
        .elements()
        .filter((e) => e.type === 'comment' && e.anchorId !== undefined)
        .map((e) => this.a.layer.rectOf(e)),
    };
    try {
      return await renderBoardShot(spec, scale);
    } catch {
      return null;
    }
  }


  async exportPng() {
    const cv = await this.boardRaster(2);
    const blob = cv && (await toBlob(cv, 'image/png'));
    if (!blob) {
      toast(t('exFail'));
      return;
    }
    downloadBlob(`${this.exportFileBase()}.png`, blob);
  }


  async exportPdf(hi: boolean) {
    const scale = hi ? 2 : 1;
    const cv = await this.boardRaster(scale);
    const blob = cv && (await toBlob(cv, 'image/jpeg', hi ? 0.95 : 0.8));
    if (!cv || !blob) {
      toast(t('exFail'));
      return;
    }
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    // Page sized to the raster's aspect: board units at 96dpi -> pt.
    const pdf = jpegToPdf(jpeg, cv.width, cv.height, (cv.width / scale) * 0.75, (cv.height / scale) * 0.75);
    downloadBlob(`${this.exportFileBase()}.pdf`, pdf);
  }


  exportLinear(kind: 'doc' | 'md' | 'txt') {
    if (!this.a.boardId) return;
    this.a.editing.endEdit();
    const title = this.a.board()?.title ?? '';
    const items = boardItems(this.a.doc, this.a.boardId, this.exportSubs);
    const base = this.exportFileBase();
    if (kind === 'md') downloadTextFile(`${base}.md`, toMarkdown(title, items), 'text/markdown');
    else if (kind === 'txt') downloadTextFile(`${base}.txt`, toPlain(title, items));
    else downloadTextFile(`${base}.doc`, toWordHtml(title, items), 'application/msword');
  }


  async exportFilesZip() {
    const els = this.boardMedia();
    if (!els.length) return;
    const entries: ZipEntry[] = [];
    const used = new Set<string>();
    for (const el of els) {
      const ref = blobRefOf(el);
      if (!ref) continue;
      const blob = await getBlob(ref).catch(() => undefined);
      if (!blob) continue;
      const stored =
        'image' in el.content ? el.content.image.name : 'file' in el.content ? el.content.file.name : '';
      const name = dedupFileName(stored || (el.type === 'image' ? `image-${el.id}.png` : `file-${el.id}`), used);
      entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (!entries.length) {
      toast(t('exFail'));
      return;
    }
    downloadBlob(`${this.exportFileBase()}-files.zip`, zipStore(entries));
  }


  exportJson() {
    if (!this.a.boardId) return;
    const text = exportBoard(this.a.doc, this.a.boardId);
    if (!text) {
      toast(t('exFail'));
      return;
    }
    downloadTextFile(`${this.exportFileBase()}.json`, text, 'application/json');
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
        const data = parseBoardExport(await file.text());
        // Imported boards attach under Home; fall back to the doc root
        // or the current board when no 'home' id exists.
        const host =
          this.a.doc.boards.home?.id ??
          Object.values(this.a.doc.boards).find((b) => b.parentId === null)?.id ??
          this.a.boardId;
        const res = data && host ? importActions(this.a.doc, data, host) : null;
        if (!res) {
          toast(t('exImportFail'));
          return;
        }
        this.a.store.dispatch({ type: 'batch', actions: res.actions });
        this.a.openBoard(res.boardId);
      })();
    });
    input.click();
  }

}
