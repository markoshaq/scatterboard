import { Store } from './state/store';
import {
  annotationDoc,
  boardRefOf,
  columnMembers,
  columnTitle,
  commentDoc,
  createAnnotation,
  createBoard,
  createBoardCard,
  createColumn,
  createComment,
  createDocument,
  createEmbed,
  createHeading,
  createLabel,
  createLine,
  createLink,
  createNote,
  createSketch,
  createSwatch,
  createTable,
  createTodo,
  defaultWidth,
  documentDoc,
  embedDoc,
  headingDoc,
  imageDoc,
  lineDoc,
  linkDoc,
  blobRefOf,
  sketchDoc,
  strokesBBox,
  swatchDoc,
  todoDoc,
  uid,
  SKETCH_PAD_H,
  SKETCH_PAD_W,
  GRID,
  IMAGE_W,
  UNSORTED,
  type Doc,
  type Element,
  type ElementType,
  type CellType,
  type ID,
  type EmbedKind,
  type Label,
  type LineEnd,
  type LineMarker,
  type LineWeight,
  type PresentOpts,
  type Stroke,
  type TypeContent,
} from './state/schema';
import type { Action, ElementPatch } from './state/actions';
import { getClipboard, setClipboard } from './state/clipboard';
import type { DocStorage } from './persist/storage';
import { blobTotalSize, blobUrl, copyTextToClipboard, downloadBlobRef, getBlob, putBlob, releaseTrashBlobs } from './persist/blobs';
import { ingestFiles, ingestPaste, prepareImage, type IngestApi } from './ui/files';
import { hostOf } from './ui/embeds';
import { Viewport, type Rect } from './canvas/viewport';
import { Renderer, type DraftLine, type Guide, type SceneLine } from './canvas/renderer';
import { CardsLayer } from './cards/layer';
import type { CardEvents } from './cards/note';
import { openThreadPopup } from './cards/comment';
import { TodoCard } from './cards/todo';
import { TableCard } from './cards/table';
import { Topbar, type Crumb } from './ui/topbar';
import { Rail, editRailType, type ToolId } from './ui/rail';
import { toast } from './ui/toast';
import { attachPointer } from './canvas/input';
import { attachShortcuts } from './ui/shortcuts';
import { normRect, pointInRect, rectsIntersect, unionRect } from './canvas/hit';
import { hitLines, midpoint, resolveLine, type LineHit } from './canvas/lines';
import { snapDelta } from './canvas/snap';
import { NOTE_MAX_W, NOTE_MIN_W } from './state/schema';
import { relTime, t } from './strings';
import { ChipsLayer } from './ui/chips';
import { CommentPins } from './ui/pins';
import { AnnotationLayer } from './ui/annotations';
import { openDocumentEditor } from './editor/doceditor';
import { openBoardDraw, openSketchEditor } from './editor/draweditors';
import { imgModeFromHash, imgModeParam, openImageEditor, type ImgEditorHandle, type ImgMode } from './editor/imgeditor';
import { canvasBlob, cropImage, loadBitmap } from './canvas/imgops';
import { downloadTextFile, strokesToSvgFile } from './draw/strokes';
import { typeIcon } from './ui/icons';
import { dragGhost } from './ui/util';
import { openPanel, panelEmpty, panelRow, dayGroupLabel, type PanelHandle } from './ui/panel';
import { openSearchPanel, searchBoard, type SearchHit } from './ui/search';
import { openShortcutsPanel } from './ui/shortcutpanel';
import { openCapturePopup } from './ui/capture';
import { setFormatting } from './ui/locale';
import { choice } from './ui/toast';
import { fetchLinkPreview } from './ui/unfurl';
import type { Currency, Lang } from './persist/storage';
import { CREATE_ITEMS } from './ui/rail';
import {
  LABEL_COLORS,
  openColorPopup,
  openLabelsPopup,
  openLinkInfoPopup,
  openLinkPopup,
  openCellAlignPopup,
  openMenuPopup,
  openReactionsPopup,
  openTextStylePopup,
  openViewMenu,
  type MenuItem,
} from './ui/toolpopups';
import { closeBoardPopup, closeToolPopup } from './ui/popup';
import { openExportMenu } from './export/menu';
import { dedupFileName, downloadBlob, slugFileName } from './export/download';
import { zipStore, type ZipEntry } from './export/zip';
import { jpegToPdf } from './export/pdf';
import {
  buildShotDom,
  inlineBlobImages,
  renderBoardShot,
  settleImages,
  toBlob,
  type FallbackCard,
  type ShotSpec,
} from './export/boardpng';
import { boardItems, toMarkdown, toPlain, toWordHtml } from './export/linear';
import { exportBoard, importActions, parseBoardExport } from './export/jsonio';
import { remapElements } from './state/clone';
import { builtinTemplates, instantiateActions, snapshotTemplate } from './state/templates';
import { openIconPicker } from './ui/iconpicker';
import { openNewBoardPicker } from './ui/newboard';
import { openSettings, SCALE_STEPS } from './ui/settings';
import { isDark, setTheme, setUiScale } from './ui/theme';
import { hint } from './ui/toast';
import type { Prefs } from './persist/storage';
import {
  applyLink,
  applyBlockStyle,
  applyHighlight,
  applyTextColor,
  blockStyleAt,
  execMark,
  selectionInRoot,
  selectionRange,
  toggleCenter,
  toggleInlineCode,
  toggleList,
} from './ui/richtext';

const SAVE_DEBOUNCE = 700;
const DRAG_SLOP = 3;

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

export class App {
  store: Store;
  adapter: DocStorage;
  vp = new Viewport();
  renderer: Renderer;
  layer: CardsLayer;
  topbar: Topbar;
  boardId: ID | null = null;
  sel = new Set<ID>();
  editingId: ID | null = null;
  spaceDown = false;

  private docEl: HTMLElement;
  private canvasEl: HTMLCanvasElement;
  private chromeEl: HTMLCanvasElement;
  private marquee: { x1: number; y1: number; x2: number; y2: number } | null = null;
  private guides: Guide[] = [];
  private dropColId: ID | null = null;
  private saveTimer: number | null = null;
  private saveState: 'saved' | 'saving' = 'saved';
  private draft: DraftLine | null = null;
  private endDraft: { id: ID; which: 'from' | 'to'; x: number; y: number } | null = null;
  private editingLabelId: ID | null = null;
  private connectHandle: HTMLElement;
  private labelHost: HTMLElement;
  private labelPills = new Map<ID, HTMLElement>();
  private rail: Rail;
  private chips: ChipsLayer;
  private pins: CommentPins;
  private anno: AnnotationLayer;
  private panel: PanelHandle | null = null;
  private panelKind: 'unsorted' | 'trash' | 'search' | null = null;
  private overlay: { close(): void } | null = null;
  private overlayId: ID | null = null;
  private imgEditor: ImgEditorHandle | null = null;
  private boardDraw: { close(): void } | null = null;
  private filterIds = new Set<ID>();
  pointer: { x: number; y: number } | null = null;
  presenting = false;
  prefs: Prefs = {};
  private zoomReadout: ((z: number) => void) | null = null;
  private exportSubs = false;

  get overlayOpen() {
    return this.overlay !== null || this.boardDraw !== null;
  }

  constructor(root: HTMLElement, store: Store, adapter: DocStorage) {
    this.store = store;
    this.adapter = adapter;

    const vpEl = document.createElement('div');
    vpEl.className = 'viewport';
    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'board-canvas';
    this.docEl = document.createElement('div');
    this.docEl.className = 'doc';
    this.chromeEl = document.createElement('canvas');
    this.chromeEl.className = 'board-chrome';
    vpEl.append(this.canvasEl, this.docEl, this.chromeEl);
    root.appendChild(vpEl);

    this.layer = new CardsLayer(store.doc, this.vp, {
      onTextInput: (id, text, html) => this.onTextInput(id, text, html),
      onContent: (id, content) => this.onContent(id, content),
      onMeasure: () => this.render(),
      onResizeHandle: (id, e) => this.startResize(id, e),
      onEditEnd: () => this.endEdit(),
      onLinkPopup: (id) => this.openLinkPopupFor(id),
      onEditField: (id, field) => this.beginEdit(id, undefined, field),
      onCellFocus: () => this.render(),
    });
    this.docEl.appendChild(this.layer.node);
    this.anno = new AnnotationLayer((id, e) => this.onAnnoPick(id, e));
    this.docEl.appendChild(this.anno.node);
    this.labelHost = document.createElement('div');
    this.labelHost.className = 'line-labels';
    this.docEl.appendChild(this.labelHost);
    this.connectHandle = document.createElement('div');
    this.connectHandle.className = 'connect-handle';
    this.connectHandle.innerHTML = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 5h5M5.5 2.8 7.7 5 5.5 7.2"/></svg>`;
    this.connectHandle.style.display = 'none';
    this.connectHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = this.connectHandle.dataset.id;
      if (id) this.startConnect(id, e);
    });
    this.docEl.appendChild(this.connectHandle);
    this.chips = new ChipsLayer(store.doc);
    this.docEl.appendChild(this.chips.node);
    this.pins = new CommentPins((id, pinEl) => this.onPinClick(id, pinEl));
    this.docEl.appendChild(this.pins.node);
    this.renderer = new Renderer(this.canvasEl, this.chromeEl, this.vp);
    this.topbar = new Topbar(root, {
      onZoomIn: () => this.vp.zoomStep(1),
      onZoomOut: () => this.vp.zoomStep(-1),
      onReset: () => this.vp.reset(),
      onFit: () => this.fitView(),
      onNavigate: (id) => this.openBoard(id),
      onUnsorted: () => this.openUnsorted(),
      onView: (anchor) => this.openViewMenu(anchor),
      onExport: (anchor) => this.openExportMenu(anchor),
      onSettings: (anchor) => this.openSettings(anchor),
      onCrumbIcon: (id, anchor) => this.iconPickerFor(id, anchor),
      onUndo: () => {
        if (!this.lockedView()) this.store.undo();
      },
      onRedo: () => {
        if (!this.lockedView()) this.store.redo();
      },
    });
    this.rail = new Rail(root, {
      onDrop: (type, at, kind) => this.createFromRail(type, at, kind),
      onTool: (id, anchor) => this.onTool(id, anchor),
      onAddImage: () => this.pickFiles('image/*'),
      onUpload: () => this.pickFiles('*/*'),
      onDraw: () => this.enterDrawMode(),
      onCapture: (anchor) => this.openCapture(anchor),
      onTrash: () => this.onRailTrash(),
      onBoardColor: (hex) => {
        if (this.boardId && !this.lockedView()) {
          this.colorBurst(() =>
            this.store.dispatch({ type: 'board.patch', id: this.boardId!, patch: { color: hex } }),
          );
        }
      },
    });
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'present-stop';
    stop.textContent = t('stopPresenting');
    stop.addEventListener('click', () => this.exitPresent());
    root.appendChild(stop);

    document.addEventListener('selectionchange', () => this.refreshEditGate());

    this.vp.onchange = () => {
      // Popups anchored to board space would float detached from their
      // anchor once the viewport moves; chrome-anchored ones stay.
      closeBoardPopup();
      this.applyTransform();
      this.scheduleSave();
      this.render();
    };
    this.store.onChange((c) => {
      for (const id of c.deleted) {
        this.sel.delete(id);
        // Ending the session is what closes the undo group; dropping
        // editingId alone would leak it and swallow history.
        if (this.editingId === id) this.endEdit();
      }
      this.scheduleSave();
      this.render();
    });

    attachPointer(vpEl, this);
    attachShortcuts(this);

    window.addEventListener('resize', () => this.layout());
    window.addEventListener('online', () => this.render());
    window.addEventListener('offline', () => this.render());
    this.layout();
  }

  layout() {
    this.vp.setSize(innerWidth, innerHeight);
    this.renderer.resize();
  }

  get doc(): Doc {
    return this.store.doc;
  }

  board() {
    return this.boardId ? this.doc.boards[this.boardId] : undefined;
  }

  openBoard(id: ID, filterQuery?: string, keepHash = false) {
    const board = this.doc.boards[id];
    if (!board) return;
    const sameBoard = id === this.boardId;
    this.exitPresent();
    this.endEdit();
    this.draft = null;
    this.endDraft = null;
    if (this.editingLabelId) this.commitLabelEdit(this.editingLabelId);
    const prev = this.board();
    if (prev) prev.position = this.vp.snapshot();
    this.closePanel();
    closeToolPopup();
    this.sel.clear();
    this.filterIds.clear();
    this.boardId = id;
    this.layer.boardId = id;
    this.adapter.setLastBoard(id);
    // Recency list for the search panel's Recently viewed section.
    const recents = [id, ...(this.prefs.recentBoards ?? []).filter((b) => b !== id)].slice(0, 8);
    if (JSON.stringify(recents) !== JSON.stringify(this.prefs.recentBoards ?? [])) {
      this.prefs.recentBoards = recents;
      this.scheduleSave();
    }
    // Keep existing filter params when the hash already targets this board
    // (hashchange-driven opens and back/forward restore must not strip them).
    // keepHash: an editor route (#/e/<id>) is driving the board switch.
    const cur = location.hash.match(/^#\/b\/([^?#]+)([^#]*)$/);
    const query = filterQuery
      ? `?filter_query=${encodeURIComponent(filterQuery)}`
      : cur?.[1] === id
        ? (cur[2] ?? '')
        : '';
    const hash = `#/b/${id}${query}`;
    if (!keepHash && location.hash !== hash) {
      if (prev) history.pushState(null, '', hash);
      else history.replaceState(null, '', hash);
    }
    if (sameBoard) {
      this.render();
      return;
    }
    this.vp.restore(board.position);
  }

  // Hash routing entry point (boot + hashchange): #/e/<id> mounts the
  // element's dedicated editor over its board; #/b/<id> opens a board.
  applyRoute() {
    const em = location.hash.match(/^#\/e\/([^/?#]+)/);
    if (em) {
      const el = this.doc.elements[em[1]!];
      if (el && (el.type === 'document' || el.type === 'sketch' || el.type === 'image')) {
        this.openElementEditor(el);
        return;
      }
    }
    this.closeElementEditor();
    const bm = location.hash.match(/^#\/b\/([^/?#]+)/);
    if (bm && bm[1] !== this.boardId) {
      this.openBoard(bm[1]!);
      this.applyRouteFilter();
      return;
    }
    this.applyRouteFilter();
  }

  private openElementEditor(el: Element) {
    if (this.overlayId === el.id) {
      // Same overlay re-used: the image editor's mode chips swap the
      // hash and hashchange lands here.
      this.imgEditor?.setMode(imgModeFromHash());
      return;
    }
    if (el.boardId !== this.boardId) this.openBoard(el.boardId, undefined, true);
    this.exitPresent();
    this.closeElementEditor();
    this.endEdit();
    this.closePanel();
    closeToolPopup();
    this.sel = new Set([el.id]);
    let handle: { close(): void } | null = null;
    if (el.type === 'document') {
      if (!documentDoc(el)) return;
      this.store.beginGroup();
      const ed = openDocumentEditor(el, {
        boards: () => Object.values(this.doc.boards).sort((a, b) => a.title.localeCompare(b.title)),
        boardUrl: (id) => this.boardUrl(id),
        patch: (doc) => {
          if (documentDoc(this.doc.elements[el.id]!)) {
            this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { document: doc } } });
          }
        },
        comment: (anchor) => this.addCommentTo(el.id, anchor),
        exit: () => this.exitEditor(el.boardId),
      });
      handle = {
        close: () => {
          ed.close();
          this.store.endGroup('edit');
        },
      };
    } else if (el.type === 'sketch') {
      handle = openSketchEditor(el, {
        ink: this.prefs.ink,
        patch: (doc) => {
          const cur = sketchDoc(this.doc.elements[el.id]!);
          if (cur && JSON.stringify(cur.strokes) !== JSON.stringify(doc.strokes)) {
            this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { sketch: doc } } });
          }
        },
        exit: () => this.exitEditor(el.boardId),
      });
    } else if (el.type === 'image') {
      if (!imageDoc(el)) return;
      const ed = openImageEditor(el, imgModeFromHash(), {
        doc: () => {
          const cur = this.doc.elements[el.id];
          return cur ? imageDoc(cur) : null;
        },
        patch: (doc) => {
          const cur = this.doc.elements[el.id];
          if (cur && imageDoc(cur)) {
            this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { image: doc } } });
          }
        },
        ink: this.prefs.ink,
        nav: (m: ImgMode) => {
          // Mode chips ride in the same history entry: replace, never
          // push, so Esc/Back always lands on the board, not a mode.
          history.replaceState(null, '', `#/e/${el.id}${imgModeParam(m)}`);
          this.imgEditor?.setMode(m);
        },
        exit: () => this.exitEditor(el.boardId),
      });
      this.imgEditor = ed;
      handle = ed;
    }
    if (!handle) return;
    this.overlay = handle;
    this.overlayId = el.id;
    this.render();
  }

  // Editor exit: swap the #/e entry for the board instead of pushing
  // (Back would reopen the editor) or popping (a pushed mode-chip or a
  // cold-boot #/e URL could strand the user).
  private exitEditor(boardId: ID) {
    history.replaceState(null, '', `#/b/${boardId}`);
    this.applyRoute();
  }

  private closeElementEditor() {
    this.imgEditor = null;
    this.overlay?.close();
    this.overlay = null;
    this.overlayId = null;
    closeToolPopup();
  }

  // Board draw mode (rail Draw / Shift+D): strokes land as one
  // annotation element. Esc saves, Discard backs out.
  enterDrawMode() {
    if (this.boardDraw || this.overlay || !this.boardId || this.lockedView()) return;
    this.endEdit();
    this.closePanel();
    closeToolPopup();
    this.clearSelection();
    this.boardDraw = openBoardDraw({
      vp: this.vp,
      ink: this.prefs.ink,
      onSave: (strokes) => {
        if (this.boardId && strokes.length) {
          const el = createAnnotation(this.doc, this.boardId, strokes);
          this.store.dispatch({ type: 'element.create', el });
          this.setSelection([el.id]);
        }
        this.exitDrawMode();
      },
      onCancel: () => this.exitDrawMode(),
    });
  }

  private exitDrawMode() {
    this.boardDraw?.close();
    this.boardDraw = null;
    this.render();
  }

  private crumbs(): Crumb[] {
    const out: Crumb[] = [];
    let b = this.board();
    let guard = 0;
    while (b && guard++ < 32) {
      out.unshift({ id: b.id, title: b.title || t('untitled'), ...(b.icon !== undefined ? { icon: b.icon } : {}) });
      b = b.parentId ? this.doc.boards[b.parentId] : undefined;
    }
    return out;
  }

  navUp() {
    const b = this.board();
    if (b?.parentId) this.openBoard(b.parentId);
  }

  // --- presentation mode ---

  // 'Prevent editing' toggle: blocks every mutation entry point while
  // presenting; select/pan/zoom stay live. Checked centrally here.
  lockedView(): boolean {
    return this.presenting && !!this.board()?.presentOpts?.edit;
  }

  enterPresent() {
    if (this.presenting || this.overlayOpen || !this.boardId) return;
    this.endEdit();
    if (this.editingLabelId) this.commitLabelEdit(this.editingLabelId);
    this.closePanel();
    closeToolPopup();
    this.presenting = true;
    this.applyPresentClasses();
    this.render();
  }

  exitPresent() {
    if (!this.presenting) return;
    this.presenting = false;
    this.applyPresentClasses();
    this.render();
  }

  togglePresent() {
    if (this.presenting) this.exitPresent();
    else this.enterPresent();
  }

  private applyPresentClasses() {
    const opts = this.board()?.presentOpts;
    document.body.classList.toggle('presenting', this.presenting);
    document.body.classList.toggle('hide-comments', this.presenting && !!opts?.comments);
  }

  // Persisted per board, direct field mutation like board.position:
  // no action, no undo entry.
  private togglePresentOpt(key: keyof PresentOpts) {
    const board = this.board();
    if (!board) return;
    board.presentOpts = { ...board.presentOpts, [key]: !board.presentOpts?.[key] };
    this.scheduleSave();
    this.applyPresentClasses();
  }

  // 'Focus on selected cards': non-selected canvas items dim. Re-checked
  // in render() so the focus set follows live selection changes.
  private dims(id: ID): boolean {
    return this.presenting && this.sel.size > 0 && !this.sel.has(id) && !!this.board()?.presentOpts?.focus;
  }

  private openViewMenu(anchor: HTMLElement) {
    if (!this.boardId) return;
    openViewMenu(anchor, {
      zoom: () => this.vp.z,
      onZoomIn: () => this.vp.zoomStep(1),
      onZoomOut: () => this.vp.zoomStep(-1),
      onReset: () => this.vp.reset(),
      onFit: () => this.fitView(),
      presentOpts: () => this.board()?.presentOpts ?? {},
      onToggle: (key) => this.togglePresentOpt(key),
      onPresent: () => this.enterPresent(),
      onReadout: (cb) => {
        this.zoomReadout = cb;
        cb?.(this.vp.z);
      },
    });
  }

  // --- export ---

  private openExportMenu(anchor: HTMLElement) {
    if (!this.boardId) return;
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

  private exportFileBase(): string {
    return slugFileName(this.board()?.title ?? 'board');
  }

  // Image/file elements live on this board (not filed to unsorted, not
  // nested in sub-boards). Column members count: they sit on the canvas.
  private boardMedia(): Element[] {
    return Object.values(this.doc.elements).filter(
      (e) => e.boardId === this.boardId && e.parentId !== UNSORTED && blobRefOf(e) !== null,
    );
  }

  // Render the whole board to an offscreen canvas at `scale` (css px per
  // board unit). Cards are rasterized via an svg foreignObject snapshot
  // when the engine allows it; otherwise a simple canvas pass draws
  // card rects + text (see export/boardpng.ts).
  private async boardRaster(scale: number): Promise<HTMLCanvasElement | null> {
    if (!this.boardId) return null;
    this.endEdit();
    const u = unionRect(this.layer.elements().map((e) => this.layer.rectOf(e)));
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
    const off = new CardsLayer(this.doc, fvp, SHOT_EVENTS);
    off.boardId = this.boardId;
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
    const chips = new ChipsLayer(this.doc);
    chips.sync(this.chipTargets(true, off));
    this.anno.sync(this.annoItems());
    this.pins.sync(this.pinItems(off).map((p) => ({ ...p, seat: null })));
    const dom = buildShotDom(off.node, [this.anno.node, this.pins.node, this.labelHost, chips.node], bounds);
    await inlineBlobImages(dom);
    off.destroy();
    stage.remove();
    this.syncAnno();
    this.syncPins();

    const spec: ShotSpec = {
      bounds,
      grid: this.board()?.grid ?? true,
      lines: this.resolvedLines(),
      dom,
      cards: this.layer
        .elements()
        .filter((e) => e.type !== 'line' && e.type !== 'annotation' && e.anchorId === undefined)
        .map((e): FallbackCard => ({ rect: this.layer.rectOf(e), label: this.snippetFor(e), color: e.color })),
      annotations: this.layer.elements().filter((e) => e.type === 'annotation'),
      pins: this.layer
        .elements()
        .filter((e) => e.type === 'comment' && e.anchorId !== undefined)
        .map((e) => this.layer.rectOf(e)),
    };
    try {
      return await renderBoardShot(spec, scale);
    } catch {
      return null;
    }
  }

  private async exportPng() {
    const cv = await this.boardRaster(2);
    const blob = cv && (await toBlob(cv, 'image/png'));
    if (!blob) {
      toast(t('exFail'));
      return;
    }
    downloadBlob(`${this.exportFileBase()}.png`, blob);
  }

  private async exportPdf(hi: boolean) {
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

  private exportLinear(kind: 'doc' | 'md' | 'txt') {
    if (!this.boardId) return;
    this.endEdit();
    const title = this.board()?.title ?? '';
    const items = boardItems(this.doc, this.boardId, this.exportSubs);
    const base = this.exportFileBase();
    if (kind === 'md') downloadTextFile(`${base}.md`, toMarkdown(title, items), 'text/markdown');
    else if (kind === 'txt') downloadTextFile(`${base}.txt`, toPlain(title, items));
    else downloadTextFile(`${base}.doc`, toWordHtml(title, items), 'application/msword');
  }

  private async exportFilesZip() {
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

  private exportJson() {
    if (!this.boardId) return;
    const text = exportBoard(this.doc, this.boardId);
    if (!text) {
      toast(t('exFail'));
      return;
    }
    downloadTextFile(`${this.exportFileBase()}.json`, text, 'application/json');
  }

  private importJson() {
    if (this.lockedView()) return;
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
          this.doc.boards['home']?.id ??
          Object.values(this.doc.boards).find((b) => b.parentId === null)?.id ??
          this.boardId;
        const res = data && host ? importActions(this.doc, data, host) : null;
        if (!res) {
          toast(t('exImportFail'));
          return;
        }
        this.store.dispatch({ type: 'batch', actions: res.actions });
        this.openBoard(res.boardId);
      })();
    });
    input.click();
  }

  applyTransform() {
    this.docEl.style.transform = `translate(${this.vp.x}px, ${this.vp.y}px) scale(${this.vp.z})`;
    // Inverse zoom for DOM affordances that must stay constant screen px.
    this.docEl.style.setProperty('--iz', String(1 / this.vp.z));
    this.topbar.setZoom(this.vp.z);
    this.zoomReadout?.(this.vp.z);
  }

  render() {
    const board = this.board();
    const outlines = [...this.sel]
      .map((id) => this.doc.elements[id])
      .filter(
        (e): e is Element =>
          !!e &&
          e.type !== 'line' &&
          !(e.type === 'comment' && e.anchorId !== undefined) &&
          !this.trashHover,
      )
      .map((e) => this.layer.rectOf(e));
    const lines = this.resolvedLines();
    this.renderer.setScene({
      grid: board?.grid ?? true,
      marquee: this.marquee ? normRect(this.marquee.x1, this.marquee.y1, this.marquee.x2, this.marquee.y2) : null,
      guides: this.guides,
      guideAlpha: this.prefs.guideAlpha ?? 0,
      outlines,
      lines,
      draft: this.draft,
    });
    this.layer.sync(this.sel, this.editingId, this.lockedView());
    this.syncConnectHandle();
    this.syncLabelPills(lines);
    this.syncChips();
    this.syncPins();
    this.syncAnno();
    for (const node of this.docEl.querySelectorAll<HTMLElement>(
      '.card, .chip-row, .comment-pin, .line-label, svg.anno',
    )) {
      node.classList.toggle('present-dim', !!node.dataset.id && this.dims(node.dataset.id));
      node.classList.toggle('filter-hit', !node.dataset.id || this.filterIds.has(node.dataset.id));
    }
    this.docEl.classList.toggle('filtering', this.filterIds.size > 0);
    this.topbar.setUndoArrows(!!this.prefs.undoArrows, this.store.canUndo, this.store.canRedo);
    this.rail.setPalette(this.prefs.railOrder, this.prefs.railHidden);
    this.rail.sync(this.selectedEls(), this.editingEl());
    this.rail.setBoardColor(board?.color);
    this.refreshEditGate();
    this.topbar.setCrumbs(this.crumbs());
    this.topbar.setUnsorted(this.unsortedCount());
    this.renderPanel();
  }

  selectedEls(): Element[] {
    return [...this.sel].map((id) => this.doc.elements[id]).filter((e): e is Element => !!e);
  }

  private movableCards(): Element[] {
    return this.selectedEls().filter(
      (e) => e.type !== 'line' && e.parentId === null && !(e.type === 'comment' && e.anchorId !== undefined),
    );
  }

  private unsortedCount(): number {
    let n = 0;
    for (const el of Object.values(this.doc.elements)) {
      if (el.boardId === this.boardId && el.parentId === UNSORTED) n++;
    }
    return n;
  }

  // Cards the chips overlay can sit under: canvas cards + column members
  // on this board, minus anchored comments (those render as pins).
  // all=true skips the viewport cull for the export snapshot (pass the
  // staging layer so member rects come from its mounted views).
  private chipTargets(all = false, layer = this.layer): { el: Element; rect: Rect; dim?: boolean }[] {
    const visible = all ? null : this.vp.viewRect(120);
    const out: { el: Element; rect: Rect; dim?: boolean }[] = [];
    const hideComments = this.presenting && !!this.board()?.presentOpts?.comments;
    const push = (el: Element) => {
      if (el.type === 'line') return;
      if (el.type === 'comment' && (el.anchorId !== undefined || hideComments)) return;
      const rect = layer.rectOf(el);
      if (!visible || rectsIntersect(rect, visible)) out.push({ el, rect, dim: this.dims(el.id) });
    };
    for (const el of layer.elements()) {
      push(el);
      // Culled-column members report a stale pre-filing x/y; skip them.
      if (el.type === 'column')
        for (const m of columnMembers(this.doc, el.id)) {
          if (all || layer.view(m.id)) push(m);
        }
    }
    return out;
  }

  private syncChips() {
    this.chips.sync(this.chipTargets(), (id) => {
      const el = this.doc.elements[id];
      // Member rows stay in the host: inside .col-body their board-space
      // coords land in card-local space and get clipped by contain:paint.
      if (!el || el.parentId) return null;
      return this.layer.view(id)?.node ?? null;
    });
  }

  private pinItems(layer = this.layer): {
    id: ID;
    rect: Rect;
    count: number;
    selected: boolean;
    unread: number;
    color: string | undefined;
    seat: HTMLElement | null;
  }[] {
    const out: {
      id: ID;
      rect: Rect;
      count: number;
      selected: boolean;
      unread: number;
      color: string | undefined;
      seat: HTMLElement | null;
    }[] = [];
    for (const el of layer.elements()) {
      if (el.type !== 'comment' || el.anchorId === undefined) continue;
      const anchor = this.doc.elements[el.anchorId];
      if (!anchor || anchor.parentId === UNSORTED) continue;
      // Member anchors use a DOM rect: an unmounted column member would
      // report its stale pre-filing x/y and leave an orphan pin.
      if (anchor.parentId && !layer.view(anchor.id)) continue;
      const rect = layer.rectOf(anchor);
      const c = commentDoc(el);
      const count = c?.items.length ?? 0;
      const seen = this.prefs.commentSeen?.[el.id] ?? 0;
      out.push({
        id: el.id,
        rect,
        count,
        selected: this.sel.has(el.id),
        unread: Math.max(0, count - seen),
        color: el.color,
        // Seated after the anchor card so covering cards hide the pin.
        // Member anchors keep the host (same as member chip rows).
        seat: anchor.parentId ? null : (layer.view(anchor.id)?.node ?? null),
      });
    }
    return out;
  }

  private syncPins() {
    this.pins.sync(this.pinItems());
  }

  private onPinClick(id: ID, pinEl: HTMLElement) {
    this.endEdit();
    this.selectOnly(id);
    this.openCommentThread(id, pinEl);
  }

  private annoItems() {
    return this.layer
      .elements()
      .filter((e) => e.type === 'annotation')
      .sort((a, b) => a.z - b.z)
      .map((el) => ({ el, selected: this.sel.has(el.id), dim: this.dims(el.id) }));
  }

  private syncAnno() {
    // Seat each svg before the lowest card above it so ink honours el.z;
    // the host fallback paints above all cards (topmost annotation).
    this.anno.sync(this.annoItems(), (el) => {
      let best: Element | null = null;
      for (const e of this.layer.elements()) {
        if (e.z <= el.z || e.type === 'line' || e.type === 'annotation') continue;
        if (e.type === 'comment' && e.anchorId !== undefined) continue;
        if (!this.layer.view(e.id)) continue;
        if (!best || e.z < best.z) best = e;
      }
      return best ? this.layer.view(best.id)!.node : null;
    });
  }

  private onAnnoPick(id: ID, e: PointerEvent) {
    this.endEdit();
    if (e.shiftKey) this.toggleSelect(id);
    else this.selectOnly(id);
  }

  openCommentThread(id: ID, anchor: HTMLElement | DOMRect) {
    const el = this.doc.elements[id];
    if (!el || el.type !== 'comment') return;
    // Opening the thread marks it read for the pin unread badge.
    const markSeen = () => {
      const n = commentDoc(this.doc.elements[id]!)?.items.length ?? 0;
      this.prefs.commentSeen = { ...(this.prefs.commentSeen ?? {}), [id]: n };
      this.scheduleSave();
      this.syncPins();
    };
    const items = () => {
      const cur = this.doc.elements[id];
      return cur ? (commentDoc(cur)?.items ?? []) : [];
    };
    markSeen();
    openThreadPopup(anchor, items, {
      onAdd: (text) => {
        if (this.lockedView()) return;
        const c = commentDoc(this.doc.elements[id]!);
        if (!c) return;
        this.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { comment: { items: [...c.items, { id: uid(), text, createdAt: Date.now() }] } } },
        });
        markSeen();
      },
      onEdit: (iid, text) => {
        if (this.lockedView()) return;
        const c = commentDoc(this.doc.elements[id]!);
        if (!c) return;
        this.store.dispatch({
          type: 'element.patch',
          id,
          patch: {
            content: {
              comment: { items: c.items.map((i) => (i.id === iid ? { ...i, text, editedAt: Date.now() } : i)) },
            },
          },
        });
      },
    });
  }

  resolvedLines(): SceneLine[] {
    const out: SceneLine[] = [];
    const rectOf = (el: Element) => this.layer.rectOf(el);
    for (const el of this.layer.elements()) {
      if (el.type !== 'line') continue;
      const l = resolveLine(el, this.doc, rectOf);
      if (!l) continue;
      const d = this.endDraft;
      if (d && d.id === el.id) {
        if (d.which === 'from') {
          l.x1 = d.x;
          l.y1 = d.y;
        } else {
          l.x2 = d.x;
          l.y2 = d.y;
        }
      }
      out.push({ el: l.el, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, selected: this.sel.has(el.id), dim: this.dims(el.id) });
    }
    return out;
  }

  lineHit(pt: { x: number; y: number }): LineHit | null {
    return hitLines(this.resolvedLines(), this.sel, pt, this.vp.z);
  }

  setMarquee(m: { x1: number; y1: number; x2: number; y2: number } | null) {
    this.marquee = m;
    this.render();
  }

  setGuides(g: Guide[]) {
    this.guides = g;
    this.render();
  }

  boardPoint(e: { clientX: number; clientY: number }) {
    return this.vp.toBoard(e.clientX, e.clientY);
  }

  cardIdAt(e: { target: EventTarget | null }): ID | null {
    const card = (e.target as HTMLElement).closest?.('.card');
    return card instanceof HTMLElement ? (card.dataset.id ?? null) : null;
  }

  // Accent outline on the card a connect/endpoint drag would attach to.
  private connectHint: ID | null = null;
  private setConnectHint(id: ID | null) {
    if (id === this.connectHint) return;
    if (this.connectHint) this.hintNode(this.connectHint)?.classList.remove('connect-target');
    if (id) this.hintNode(id)?.classList.add('connect-target');
    this.connectHint = id;
  }

  private hintNode(id: ID): HTMLElement | null {
    const v = this.layer.view(id);
    if (v) return v.node;
    const el = this.doc.elements[id];
    const col = el?.parentId ? this.layer.view(el.parentId)?.node : null;
    return col?.querySelector<HTMLElement>(`.card[data-id="${id}"]`) ?? null;
  }

  // Whether a card covers a board point. Lines/labels/handles use it to
  // hide affordances whose anchor is occluded (they draw under or over
  // the card layer). `excludeId`'s own ancestors don't count as cover.
  private coveredByCard(x: number, y: number, excludeId?: ID): boolean {
    for (const e of this.layer.elements()) {
      if (e.type === 'line' || e.type === 'annotation' || e.id === excludeId) continue;
      if (e.type === 'comment' && e.anchorId !== undefined) continue;
      if (excludeId && this.hasAncestor(excludeId, e.id)) continue;
      if (pointInRect(x, y, this.layer.rectOf(e))) return true;
    }
    return false;
  }

  // Drop hit-test that sees through interactive overlays (pins, label
  // pills, connect handle, anno paths) to the card underneath.
  private cardAtPoint(clientX: number, clientY: number): ID | null {
    for (const n of document.elementsFromPoint(clientX, clientY)) {
      const c = (n as HTMLElement).closest?.('.card');
      if (c instanceof HTMLElement && c.dataset.id) return c.dataset.id;
    }
    return null;
  }

  isTextTarget(e: Event): boolean {
    const el = e.target as HTMLElement;
    return (
      el.isContentEditable ||
      el.closest?.('[contenteditable="true"]') !== null ||
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT'
    );
  }

  cardOrigin(id: ID): { x: number; y: number } {
    const el = this.doc.elements[id];
    if (!el) return { x: 0, y: 0 };
    if (el.parentId) {
      const r = this.layer.rectOf(el);
      return { x: r.x, y: r.y };
    }
    return { x: el.x, y: el.y };
  }

  clickEdits(id: ID): boolean {
    const t = this.doc.elements[id]?.type;
    return t === 'note' || t === 'heading' || t === 'todo' || t === 'table';
  }

  // --- edit-mode rail ---

  private editingEl(): Element | null {
    const el = this.editingId ? this.doc.elements[this.editingId] : undefined;
    if (!el || !editRailType(el.type)) return null;
    // A table only has an edit rail while one of its cells is focused;
    // title/caption field edits fall back to the selected rail.
    if (el.type === 'table') {
      const v = this.layer.view(el.id);
      if (!(v instanceof TableCard) || !v.cellFocused()) return null;
    }
    return el;
  }

  private editSurface(): HTMLElement | null {
    if (!this.editingId) return null;
    return this.layer.view(this.editingId)?.editSurface?.() ?? null;
  }

  // Link/Comment in the note + heading edit rail need live text selection.
  private refreshEditGate() {
    const el = this.editingEl();
    if (!el || (el.type !== 'note' && el.type !== 'heading')) {
      this.rail.setDisabled([]);
      return;
    }
    const surface = this.editSurface();
    const hasSel = !!surface && selectionInRoot(surface);
    this.rail.setDisabled(hasSel ? [] : ['tx-link', 'comment']);
  }

  private onRailTrash() {
    if (this.editingId) this.deleteSelection();
    else this.openTrash();
  }

  private openLinkPopupFor(id: ID) {
    if (this.editingId !== id) return;
    const surface = this.editSurface();
    const range = surface ? selectionRange(surface) : null;
    if (!surface || !range) return;
    openLinkPopup(range.getBoundingClientRect(), (url) => applyLink(surface, url, range));
  }

  // --- lines: handles, label pills, gestures ---

  private syncConnectHandle() {
    const id = this.sel.size === 1 ? [...this.sel][0]! : null;
    const el = id ? this.doc.elements[id] : undefined;
    if (!el || el.type === 'line' || el.type === 'comment' || this.editingId || el.locked || this.lockedView()) {
      this.connectHandle.style.display = 'none';
      return;
    }
    const r = this.layer.rectOf(el);
    // The handle is counter-scaled (~16 screen px, offset 2px right of
    // the edge); hide it when a covering card would make it float.
    if (this.coveredByCard(r.x + r.w + 10 / this.vp.z, r.y + r.h / 2, el.id)) {
      this.connectHandle.style.display = 'none';
      return;
    }
    this.connectHandle.style.display = 'flex';
    this.connectHandle.style.left = `${r.x + r.w}px`;
    this.connectHandle.style.top = `${r.y + r.h / 2}px`;
    this.connectHandle.dataset.id = el.id;
  }

  private syncLabelPills(lines: SceneLine[]) {
    const seen = new Set<ID>();
    for (const l of lines) {
      const c = lineDoc(l.el);
      if (!c) continue;
      const editing = this.editingLabelId === l.el.id;
      if (!c.label && !editing) continue;
      seen.add(l.el.id);
      let pill = this.labelPills.get(l.el.id);
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'line-label';
        pill.dataset.ph = t('lineLabelPlaceholder');
        const lid = l.el.id;
        pill.dataset.id = lid;
        pill.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.endEdit();
          this.selectOnly(lid);
        });
        pill.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.startLabelEdit(lid);
        });
        pill.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          }
        });
        pill.addEventListener('blur', () => this.commitLabelEdit(lid));
        this.labelPills.set(l.el.id, pill);
        this.labelHost.appendChild(pill);
      }
      const m = midpoint(l);
      pill.style.left = `${m.x}px`;
      pill.style.top = `${m.y}px`;
      pill.classList.toggle('present-dim', !!l.dim);
      // Lines paint under cards; a label whose midpoint is card-covered
      // floats detached on the covering card and steals its clicks.
      pill.classList.toggle('covered', !editing && this.coveredByCard(m.x, m.y));
      if (editing) {
        if (pill.contentEditable !== 'true') {
          pill.contentEditable = 'true';
          pill.classList.add('editing');
          pill.focus();
          const sel = getSelection()!;
          sel.selectAllChildren(pill);
          sel.collapseToEnd();
        }
      } else {
        if (pill.contentEditable === 'true') {
          pill.contentEditable = 'false';
          pill.classList.remove('editing');
        }
        if (pill.innerText !== c.label) pill.innerText = c.label;
      }
    }
    for (const [id, pill] of this.labelPills) {
      if (!seen.has(id)) {
        if (this.editingLabelId === id) this.commitLabelEdit(id);
        pill.remove();
        this.labelPills.delete(id);
      }
    }
  }

  startLabelEdit(id: ID) {
    if (this.lockedView()) return;
    const el = this.doc.elements[id];
    if (!el || el.type !== 'line') return;
    this.endEdit();
    this.selectOnly(id);
    this.editingLabelId = id;
    this.render();
  }

  private commitLabelEdit(id: ID) {
    const pill = this.labelPills.get(id);
    const el = this.doc.elements[id];
    this.editingLabelId = null;
    if (!pill || !el || this.lockedView()) return;
    const c = lineDoc(el);
    const text = pill.innerText.replace(/\n/g, ' ').trim();
    if (c && c.label !== text) {
      this.store.dispatch({ type: 'element.patch', id, patch: { content: { line: { ...c, label: text } } } });
    }
    this.render();
  }

  startEndpointGesture(id: ID, which: 'from' | 'to', e: PointerEvent) {
    if (this.lockedView()) return;
    const el = this.doc.elements[id];
    const c = el ? lineDoc(el) : null;
    if (!el || !c) return;
    const pid = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_SLOP) return;
      if (!moved) {
        moved = true;
        this.store.beginGroup();
      }
      const p = this.boardPoint(ev);
      this.endDraft = { id, which, x: p.x, y: p.y };
      this.setConnectHint(this.cardAtPoint(ev.clientX, ev.clientY));
      this.render();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      this.endDraft = null;
      this.setConnectHint(null);
      if (moved) this.store.endGroup('line-end');
      this.render();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      this.endDraft = null;
      this.setConnectHint(null);
      if (moved) {
        const targetId = this.cardAtPoint(ev.clientX, ev.clientY);
        const p = this.boardPoint(ev);
        const end: LineEnd = { x: Math.round(p.x), y: Math.round(p.y) };
        if (targetId && targetId !== id) end.el = targetId;
        this.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { line: which === 'from' ? { ...c, from: end } : { ...c, to: end } } },
        });
        this.store.endGroup('line-end');
      } else if (ev.detail <= 1) {
        // detail>1 means this up belongs to a dblclick; the label edit
        // owns that gesture, so only the first click cycles the marker
        // (pen/touch ups report detail 0 and must still cycle).
        const cur = which === 'from' ? c.fromMarker : c.toMarker;
        const next = cur === 'none' ? 'arrow' : cur === 'arrow' ? ('dot' as const) : ('none' as const);
        this.store.dispatch({
          type: 'element.patch',
          id,
          patch: {
            content: {
              line:
                which === 'from' ? { ...c, fromMarker: next } : { ...c, toMarker: next },
            },
          },
        });
      }
      this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  startConnect(sourceId: ID, e: PointerEvent) {
    if (this.lockedView()) return;
    const src = this.doc.elements[sourceId];
    if (!src) return;
    const r = this.layer.rectOf(src);
    const from = { x: r.x + r.w, y: r.y + r.h / 2 };
    const pid = e.pointerId;
    const p0 = this.boardPoint(e);
    this.draft = { x1: from.x, y1: from.y, x2: p0.x, y2: p0.y };
    this.render();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const p = this.boardPoint(ev);
      this.draft = { x1: from.x, y1: from.y, x2: p.x, y2: p.y };
      const t = this.cardAtPoint(ev.clientX, ev.clientY);
      this.setConnectHint(t !== sourceId ? t : null);
      this.render();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      this.draft = null;
      this.setConnectHint(null);
      this.render();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      this.draft = null;
      this.setConnectHint(null);
      const targetId = this.cardAtPoint(ev.clientX, ev.clientY);
      if (targetId && targetId !== sourceId && this.boardId) {
        const p = this.boardPoint(ev);
        const el = createLine(this.doc, this.boardId, { el: sourceId, x: from.x, y: from.y }, { el: targetId, x: Math.round(p.x), y: Math.round(p.y) });
        this.store.dispatch({ type: 'element.create', el });
        this.setSelection([el.id]);
      }
      this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  boardUrl(ref: ID): string {
    const u = new URL(location.href);
    u.hash = `/b/${ref}`;
    return u.href;
  }

  cardDblClick(id: ID, e: MouseEvent) {
    if (this.lockedView()) return;
    const el = this.doc.elements[id];
    if (!el) return;
    if (el.type === 'board' && !(e.target as HTMLElement).closest?.('.bc-title')) {
      const ref = boardRefOf(el);
      if (!ref) return;
      if (e.metaKey || e.ctrlKey) window.open(this.boardUrl(ref), '_blank');
      else this.openBoard(ref);
      return;
    }
    if (el.type === 'document' || el.type === 'sketch') {
      location.hash = `#/e/${el.id}`;
      return;
    }
    this.beginEdit(id, { x: e.clientX, y: e.clientY }, el.type === 'table' ? 'cell-edit' : undefined);
  }

  // --- selection ---

  selectOnly(id: ID) {
    if (this.sel.size === 1 && this.sel.has(id) && !this.filterIds.size) return;
    this.filterIds.clear();
    this.sel = new Set([id]);
    this.render();
  }

  toggleSelect(id: ID) {
    this.filterIds.clear();
    if (this.sel.has(id)) this.sel.delete(id);
    else this.sel.add(id);
    this.render();
  }

  setSelection(ids: Iterable<ID>) {
    this.filterIds.clear();
    this.sel = new Set(ids);
    this.render();
  }

  clearSelection() {
    if (!this.sel.size && !this.filterIds.size) return;
    this.filterIds.clear();
    this.sel.clear();
    this.render();
  }

  selectAll() {
    this.setSelection(this.layer.elements().map((e) => e.id));
  }

  marqueeSelect(additive: boolean) {
    if (!this.marquee) return;
    this.filterIds.clear();
    const r = normRect(this.marquee.x1, this.marquee.y1, this.marquee.x2, this.marquee.y2);
    const hits = this.layer.elements().filter((e) => rectsIntersect(this.layer.rectOf(e), r));
    const next = additive ? new Set(this.sel) : new Set<ID>();
    for (const e of hits) next.add(e.id);
    this.sel = next;
  }

  // --- editing ---

  beginEdit(id: ID, pos?: { x: number; y: number }, field?: string) {
    if (this.lockedView()) return;
    if (this.editingId === id) {
      // Already editing: a field request just refocuses the surface.
      this.layer.view(id)?.beginEdit(pos, field);
      return;
    }
    this.endEdit();
    this.editingId = id;
    if (!this.sel.has(id)) this.sel = new Set([id]);
    this.store.beginGroup();
    // Render first so an offscreen card mounts before beginEdit runs.
    this.render();
    this.layer.view(id)?.beginEdit(pos, field);
    this.render();
  }

  endEdit() {
    if (!this.editingId) return;
    const id = this.editingId;
    const view = this.layer.view(id);
    const el = this.doc.elements[id];
    if (view?.editing) {
      const text = view.endEdit();
      const html = view.readHtml?.();
      if (el) this.commitEditText(el, text, html);
    }
    this.editingId = null;
    this.store.endGroup('edit');
    this.render();
  }

  private commitEditText(el: Element, text: string, html?: string) {
    if (el.type === 'note') {
      const cur = 'note' in el.content ? el.content.note : null;
      if (cur && (cur.text !== text || (html !== undefined && cur.html !== html))) {
        const note = html !== undefined ? { text, html } : { text };
        this.store.dispatch({
          type: 'batch',
          actions: [
            { type: 'element.patch', id: el.id, patch: { content: { note } } },
            ...this.syncGroupActions(el, note),
          ],
        });
      }
      this.maybeOfferDocument(el);
    } else if (el.type === 'column') {
      if (columnTitle(el) !== text) {
        this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { column: { title: text } } } });
      }
    } else if (el.type === 'heading') {
      const c = headingDoc(el);
      if (c && (c.text !== text || (html !== undefined && c.html !== html))) {
        this.store.dispatch({
          type: 'element.patch',
          id: el.id,
          patch: { content: { heading: html !== undefined ? { text, level: c.level, html } : { text, level: c.level } } },
        });
      }
    } else if (el.type === 'swatch') {
      const c = swatchDoc(el);
      if (c && c.caption !== text) {
        this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { swatch: { ...c, caption: text } } } });
      }
    } else if (el.type === 'board') {
      const ref = boardRefOf(el);
      const b = ref ? this.doc.boards[ref] : undefined;
      if (b && b.title !== text) {
        this.store.dispatch({ type: 'board.patch', id: b.id, patch: { title: text } });
      }
    }
  }

  private onTextInput(id: ID, text: string, html?: string) {
    if (this.lockedView()) return;
    const el = this.doc.elements[id];
    if (!el) return;
    if (el.type === 'board') {
      const ref = boardRefOf(el);
      const b = ref ? this.doc.boards[ref] : undefined;
      if (b) this.store.dispatch({ type: 'board.patch', id: b.id, patch: { title: text } });
      return;
    }
    if (el.type === 'heading') {
      const c = headingDoc(el);
      if (c) {
        this.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { heading: html !== undefined ? { text, level: c.level, html } : { text, level: c.level } } },
        });
      }
      return;
    }
    if (el.type === 'swatch') {
      const c = swatchDoc(el);
      if (c) {
        this.store.dispatch({ type: 'element.patch', id, patch: { content: { swatch: { ...c, caption: text } } } });
      }
      return;
    }
    if (el.type === 'column') {
      this.store.dispatch({ type: 'element.patch', id, patch: { content: { column: { title: text } } } });
      return;
    }
    const note = html !== undefined ? { text, html } : { text };
    this.store.dispatch({
      type: 'batch',
      actions: [{ type: 'element.patch', id, patch: { content: { note } } }, ...this.syncGroupActions(el, note)],
    });
    if (el.type === 'note') this.maybeOfferDocument(el);
  }

  // Synced note copies: a note edit patches every other element in the
  // same syncGroup on this board with the same content.
  private syncGroupActions(el: Element, note: { text: string; html?: string }): Action[] {
    if (!el.syncGroup) return [];
    const out: Action[] = [];
    for (const e of Object.values(this.doc.elements)) {
      if (e.id === el.id || e.type !== 'note' || e.syncGroup !== el.syncGroup || e.boardId !== el.boardId) continue;
      out.push({ type: 'element.patch', id: e.id, patch: { content: { note } } });
    }
    return out;
  }

  // "Convert to a document?" helper: once a note passes ~400 chars,
  // offer once per note via a dismissible toast.
  private maybeOfferDocument(el: Element) {
    const cur = 'note' in el.content ? el.content.note : null;
    if (!cur || cur.text.length < 400 || !this.boardId) return;
    const key = `doc:${el.id}`;
    this.prefs.helpers = { ...(this.prefs.helpers ?? {}) };
    if (this.prefs.helpers[key]) return;
    this.prefs.helpers[key] = true;
    this.scheduleSave();
    choice(t('docOffer'), t('docOfferBtn'), () => {
      const live = this.doc.elements[el.id];
      if (live) this.convertToDocument(live);
    });
  }

  // "Add a title?" helper: after three items land on an untitled list,
  // offer the title once per list.
  private maybeOfferTodoTitle(el: Element, c: import('./state/schema').TodoDoc) {
    if (c.showTitle || c.title || !this.boardId) return;
    if (c.items.filter((i) => i.text.trim()).length < 3) return;
    const key = `title:${el.id}`;
    this.prefs.helpers = { ...(this.prefs.helpers ?? {}) };
    if (this.prefs.helpers[key]) return;
    this.prefs.helpers[key] = true;
    this.scheduleSave();
    choice(t('todoTitleOffer'), t('todoTitleBtn'), () => {
      const live = this.doc.elements[el.id];
      const cur = live ? todoDoc(live) : null;
      if (live && cur) {
        this.store.dispatch({
          type: 'element.patch',
          id: live.id,
          patch: { content: { todo: { ...cur, showTitle: true } } },
        });
      }
    });
  }

  // Duplicating or pasting notes offers "Keep this copy in sync?": the
  // clone joins the source's syncGroup (or a fresh one). Declining
  // strips the group from the clones.
  private offerSyncCopies(pairs: { src: Element; clone: Element }[]) {
    const notes = pairs.filter((p) => p.src.type === 'note' && p.clone.type === 'note');
    if (!notes.length) return;
    const groupFor = new Map<ID, ID>();
    choice(
      t('syncAsk'),
      t('syncKeep'),
      () => {
        const actions: Action[] = [];
        for (const { src, clone } of notes) {
          let g = this.doc.elements[src.id]?.syncGroup;
          if (!g) {
            g = groupFor.get(src.id) ?? uid();
            groupFor.set(src.id, g);
            actions.push({ type: 'element.patch', id: src.id, patch: { syncGroup: g } });
          }
          actions.push({ type: 'element.patch', id: clone.id, patch: { syncGroup: g } });
        }
        if (actions.length) this.store.dispatch({ type: 'batch', actions });
      },
      () => {
        const actions = notes
          .filter(({ clone }) => clone.syncGroup)
          .map(({ clone }) => ({ type: 'element.patch' as const, id: clone.id, patch: { syncGroup: undefined } }));
        if (actions.length) this.store.dispatch({ type: 'batch', actions });
      },
    );
  }

  private onContent(id: ID, content: TypeContent) {
    if (this.lockedView()) return;
    const el = this.doc.elements[id];
    if (!el) return;
    this.store.dispatch({ type: 'element.patch', id, patch: { content } });
    if ('todo' in content) {
      this.maybeOfferTodoTitle(el, content.todo);
    }
    if ('link' in content && content.link.url) this.enrichLink(el.id, content.link.url);
  }

  // URL unfurl (online extra, off by default): pull og tags through a
  // CORS proxy and back-fill title/desc/image on the link card.
  private enrichLink(id: ID, url: string) {
    if (!this.prefs.unfurl || !navigator.onLine) return;
    void fetchLinkPreview(url).then((res) => {
      if (!res) return;
      const el = this.doc.elements[id];
      const cur = el ? linkDoc(el) : null;
      if (!el || !cur || cur.url !== url) return;
      this.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: {
          content: {
            link: {
              ...cur,
              title: cur.title || (res.title ?? ''),
              ...(res.desc !== undefined ? { desc: res.desc } : {}),
              ...(res.image !== undefined ? { image: res.image } : {}),
            },
          },
        },
      });
    });
  }

  // Quick-capture: files the text as a note into this board's Unsorted.
  private openCapture(anchor: HTMLElement) {
    if (!this.boardId || this.lockedView()) return;
    const boardId = this.boardId;
    openCapturePopup(anchor, (text) => {
      const el = createNote(this.doc, boardId, 0, 0, text);
      el.parentId = UNSORTED;
      this.stampBoardColor(el);
      this.store.dispatch({ type: 'element.create', el });
      toast(t('qcSaved'));
    });
  }



  // --- actions ---

  // Board accent colour: new cards inherit board.color when set.
  private stampBoardColor(el: Element) {
    const c = this.board()?.color;
    if (c !== undefined && el.type !== 'line') el.color = c;
  }

  createNoteAt(bx: number, by: number, pos?: { x: number; y: number }, parentId: ID | null = null) {
    if (!this.boardId || this.lockedView()) return;
    const el = createNote(this.doc, this.boardId, Math.round(bx), Math.round(by));
    el.parentId = parentId;
    this.stampBoardColor(el);
    this.store.dispatch({ type: 'element.create', el });
    this.setSelection([el.id]);
    this.beginEdit(el.id, pos);
  }

  createFromRail(type: ElementType, at: { clientX: number; clientY: number } | null, kind?: EmbedKind) {
    const boardId = this.boardId;
    if (!boardId || this.lockedView()) return;
    const pt = at ? this.boardPoint(at) : this.viewCenter();
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (type === 'board') {
      const anchor = at ? new DOMRect(at.clientX, at.clientY, 0, 0) : new DOMRect(this.vp.vw / 2, this.vp.vh / 2, 0, 0);
      openNewBoardPicker(anchor, {
        builtins: builtinTemplates,
        customs: () => Object.values(this.doc.templates).sort((a, b) => b.createdAt - a.createdAt),
        onPick: (tpl) => this.placeBoard(boardId, pt, tpl),
        onRename: (id, name) => this.store.dispatch({ type: 'template.patch', id, patch: { name } }),
        onDelete: (id) => {
          const tpl = this.doc.templates[id];
          if (tpl) this.store.dispatch({ type: 'template.delete', tpl });
        },
      });
      return;
    }
    if (type === 'link' || type === 'embed') {
      const el = type === 'link' ? createLink(this.doc, boardId, x, y) : createEmbed(this.doc, boardId, kind ?? 'video', x, y);
      this.stampBoardColor(el);
      this.store.dispatch({ type: 'element.create', el });
      this.setSelection([el.id]);
      // Fresh link/embed cards open on the paste-a-link input.
      this.beginEdit(el.id, undefined, 'url');
      return;
    }
    let el: Element;
    if (type === 'column') el = createColumn(this.doc, boardId, x, y);
    else if (type === 'document') el = createDocument(this.doc, boardId, x, y);
    else if (type === 'sketch') el = createSketch(this.doc, boardId, x, y);
    else if (type === 'todo') el = createTodo(this.doc, boardId, x, y);
    else if (type === 'heading') el = createHeading(this.doc, boardId, x, y);
    else if (type === 'table') el = createTable(this.doc, boardId, x, y);
    else if (type === 'swatch') el = createSwatch(this.doc, boardId, x, y);
    else if (type === 'line') {
      el = createLine(this.doc, boardId, { x: x - 80, y }, { x: x + 80, y });
    } else if (type === 'comment') el = createComment(this.doc, boardId, x, y);
    else el = createNote(this.doc, boardId, x, y);
    this.stampBoardColor(el);
    this.store.dispatch({ type: 'element.create', el });
    this.setSelection([el.id]);
  }

  chainCreate() {
    const from = this.editingId ? this.doc.elements[this.editingId] : undefined;
    this.endEdit();
    if (!from) return;
    const r = this.layer.rectOf(from);
    this.createNoteAt(r.x, r.y + r.h + 40, undefined, from.parentId);
  }

  deleteSelection() {
    if (!this.sel.size || this.lockedView()) return;
    this.endEdit();
    closeToolPopup();
    const actions: Action[] = [];
    const deleting = new Set<ID>();
    for (const id of this.sel) {
      const el = this.doc.elements[id];
      if (!el) continue;
      if (el.type === 'column') {
        columnMembers(this.doc, el.id).forEach((m, i) => {
          actions.push({
            type: 'element.patch',
            id: m.id,
            patch: { parentId: null, x: el.x + 24 + i * 20, y: el.y + 24 + i * 20 },
          });
        });
      }
      deleting.add(el.id);
      const ref = boardRefOf(el);
      if (ref) {
        for (const a of this.cascadeActions(ref)) {
          actions.push(a);
          if (a.type === 'element.delete') deleting.add(a.el.id);
        }
      }
    }
    actions.unshift(...this.detachCommentActions(deleting));
    actions.unshift(...this.detachLineActions(deleting));
    const now = Date.now();
    for (const id of this.sel) {
      const el = this.doc.elements[id];
      if (!el) continue;
      actions.push({ type: 'element.delete', el });
      // Board cards and cascade children skip the bin: a restored card
      // without its board would be broken.
      if (el.type !== 'board') actions.push({ type: 'trash.add', id: el.id, entry: { el, deletedAt: now } });
    }
    this.store.dispatch({ type: 'batch', actions });
    this.sel.clear();
  }

  // Lines attached to a deleted card keep their last resolved point as a free end.
  private detachLineActions(deleting: Set<ID>): Action[] {
    const out: Action[] = [];
    const rectOf = (el: Element) => this.layer.rectOf(el);
    for (const el of Object.values(this.doc.elements)) {
      if (el.type !== 'line' || deleting.has(el.id)) continue;
      const c = lineDoc(el);
      if (!c) continue;
      const fromGone = c.from.el !== undefined && deleting.has(c.from.el);
      const toGone = c.to.el !== undefined && deleting.has(c.to.el);
      if (!fromGone && !toGone) continue;
      const l = resolveLine(el, this.doc, rectOf);
      if (!l) continue;
      const next = { ...c };
      if (fromGone) next.from = { x: Math.round(l.x1), y: Math.round(l.y1) };
      if (toGone) next.to = { x: Math.round(l.x2), y: Math.round(l.y2) };
      out.push({ type: 'element.patch', id: el.id, patch: { content: { line: next } } });
    }
    return out;
  }

  // Card-type converts replace the element in place: line endpoints and
  // comment anchors retarget onto the new card in the same batch.
  private retargetAttachActions(fromId: ID, toId: ID): Action[] {
    const out: Action[] = [];
    for (const el of Object.values(this.doc.elements)) {
      if (el.type === 'line') {
        const c = lineDoc(el);
        if (!c) continue;
        const next = { ...c };
        if (c.from.el === fromId) next.from = { ...c.from, el: toId };
        if (c.to.el === fromId) next.to = { ...c.to, el: toId };
        if (next.from !== c.from || next.to !== c.to) {
          out.push({ type: 'element.patch', id: el.id, patch: { content: { line: next } } });
        }
      } else if (el.type === 'comment' && el.anchorId === fromId) {
        out.push({ type: 'element.patch', id: el.id, patch: { anchorId: toId } });
      }
    }
    return out;
  }

  // Comments anchored to a deleted card detach to free coordinates at the
  // anchor's current spot, in the same delete batch (line-detach pattern).
  private detachCommentActions(deleting: Set<ID>): Action[] {
    const out: Action[] = [];
    for (const el of Object.values(this.doc.elements)) {
      if (el.type !== 'comment' || el.anchorId === undefined || deleting.has(el.id)) continue;
      const anchor = this.doc.elements[el.anchorId];
      if (!anchor || !deleting.has(anchor.id)) continue;
      const r = this.layer.rectOf(anchor);
      out.push({
        type: 'element.patch',
        id: el.id,
        patch: { anchorId: undefined, x: Math.round(r.x + r.w + 20), y: Math.round(r.y) },
      });
    }
    return out;
  }

  private cascadeActions(boardId: ID): Action[] {
    const out: Action[] = [];
    const seen = new Set<ID>();
    const visit = (bid: ID) => {
      if (seen.has(bid)) return;
      seen.add(bid);
      const board = this.doc.boards[bid];
      if (!board) return;
      for (const el of Object.values(this.doc.elements)) {
        if (el.boardId === bid) out.push({ type: 'element.delete', el });
      }
      out.push({ type: 'board.delete', board });
      for (const b of Object.values(this.doc.boards)) {
        if (b.parentId === bid) visit(b.id);
      }
    };
    visit(boardId);
    return out;
  }

  duplicateSelection() {
    if (this.lockedView()) return;
    const src = this.copySet();
    if (!src.length) return;
    const { clones, idMap } = this.cloneElements(src, 24, 24);
    this.store.dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
    const top = clones.filter((c) => c.parentId === null);
    this.setSelection((top.length ? top : clones).map((c) => c.id));
    this.offerSyncCopies(
      src.map((s) => ({ src: s, clone: this.doc.elements[idMap.get(s.id)!]! })).filter((p) => !!p.clone),
    );
  }

  // --- clipboard + cloning ---

  private copySet(): Element[] {
    const out = new Map<ID, Element>();
    for (const el of this.selectedEls()) {
      out.set(el.id, el);
      if (el.type === 'column') for (const m of columnMembers(this.doc, el.id)) out.set(m.id, m);
    }
    return [...out.values()];
  }

  copySelection() {
    const set = this.copySet();
    if (set.length) setClipboard(set);
  }

  cutSelection() {
    if (this.lockedView()) return;
    this.copySelection();
    this.deleteSelection();
  }

  // Shared clone path for paste, Opt+drag and duplicate: new ids/z, column
  // members re-file to their cloned column, line endpoints re-attach only
  // when the card came along, comments drop a stale anchor.
  private cloneElements(els: Element[], dx: number, dy: number): { clones: Element[]; idMap: Map<ID, ID> } {
    const rectOf = (t: Element) => this.layer.rectOf(t);
    return remapElements(this.doc, els, (e) => this.boardId ?? e.boardId, dx, dy, {
      resolveEnd: (e, which) => {
        const l = resolveLine(e, this.doc, rectOf);
        if (!l) return null;
        return which === 'from' ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 };
      },
    });
  }

  paste() {
    const src = getClipboard();
    if (!src?.length || !this.boardId || this.lockedView()) return;
    const { clones, idMap } = this.cloneElements(src, 24, 24);
    this.store.dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
    const top = clones.filter((c) => c.parentId === null);
    this.setSelection((top.length ? top : clones).map((c) => c.id));
    this.offerSyncCopies(
      src.map((s) => ({ src: s, clone: this.doc.elements[idMap.get(s.id)!]! })).filter((p) => !!p.clone),
    );
  }

  // Paste styles: colour/labels/reactions/heading level from the first
  // copied card onto the selection. Content untouched.
  pasteStyles() {
    const src = getClipboard()?.[0];
    if (!src || !this.sel.size || this.lockedView()) return;
    const labels = src.labels.filter((l) => this.doc.labels[l]?.boardId === this.boardId);
    const srcHeading = headingDoc(src);
    const actions: Action[] = this.selectedEls().map((e) => {
      const patch: ElementPatch = {
        color: src.color,
        labels: [...labels],
        reactions: src.reactions ? [...src.reactions] : undefined,
      };
      const c = headingDoc(e);
      if (c && srcHeading) patch.content = { heading: { ...c, level: srcHeading.level } };
      return { type: 'element.patch' as const, id: e.id, patch };
    });
    this.store.dispatch({ type: 'batch', actions });
  }

  // Opt+drag: clone the dragged set in place (inside the move group), then
  // drag the clones. Returns the new drag ids and their drag origins.
  cloneForDrag(ids: ID[]): { ids: ID[]; origins: Map<ID, { x: number; y: number }> } | null {
    if (this.lockedView()) return null;
    const src = new Map<ID, Element>();
    for (const id of ids) {
      const el = this.doc.elements[id];
      if (!el) continue;
      src.set(id, el);
      if (el.type === 'column') for (const m of columnMembers(this.doc, id)) src.set(m.id, m);
    }
    if (!src.size) return null;
    // Column members being cloned out get their rendered position as x/y.
    const els = [...src.values()].map((e) => {
      if (e.parentId === null || src.has(e.parentId)) return e;
      const r = this.layer.rectOf(e);
      return { ...e, x: Math.round(r.x), y: Math.round(r.y) };
    });
    const { clones, idMap } = this.cloneElements(els, 0, 0);
    this.store.dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
    const newIds = ids.map((id) => idMap.get(id)).filter((id): id is ID => !!id);
    const origins = new Map<ID, { x: number; y: number }>();
    for (const id of newIds) {
      const el = this.doc.elements[id];
      if (el) origins.set(id, { x: el.x, y: el.y });
    }
    this.sel = new Set(newIds);
    return { ids: newIds, origins };
  }

  nudge(dx: number, dy: number) {
    if (!this.sel.size || this.lockedView()) return;
    this.store.dispatch({
      type: 'batch',
      actions: this.movableCards()
        .filter((e) => !e.locked)
        .map((e) => ({ type: 'element.patch' as const, id: e.id, patch: { x: e.x + dx, y: e.y + dy } })),
    });
  }

  toggleGrid() {
    if (this.lockedView()) return;
    const board = this.board();
    if (!board) return;
    this.store.dispatch({ type: 'board.patch', id: board.id, patch: { grid: !board.grid } });
    toast(board.grid ? t('gridOn') : t('gridOff'));
  }

  fitView() {
    const r = unionRect(this.layer.elements().map((e) => this.layer.rectOf(e)));
    this.vp.fit(r);
  }

  // --- drag gestures ---

  // `start` is the pointerdown CLIENT point; deltas ride in screen
  // space so a ctrl+wheel zoom mid-drag does not move the cards.
  dragMove(ids: ID[], origins: Map<ID, { x: number; y: number }>, start: { x: number; y: number }, ev: PointerEvent) {
    if (this.lockedView()) return;
    const cur = this.boardPoint(ev);
    let dx = (ev.clientX - start.x) / this.vp.z;
    let dy = (ev.clientY - start.y) / this.vp.z;

    // A single member dragged inside its own column re-seats by z order
    // rather than lifting out; crossing the column edge takes the normal
    // refile path below.
    const soloParent = ids.length === 1 ? this.doc.elements[ids[0]!]?.parentId : null;
    const colEl = soloParent ? this.doc.elements[soloParent] : undefined;
    if (colEl && pointInRect(cur.x, cur.y, this.layer.rectOf(colEl))) {
      this.reorderMember(soloParent!, ids[0]!, cur);
      this.updateDropTarget(null, ids);
      this.setTrashHint(this.overTrashRect(ids), ids);
      this.guides = [];
      this.render();
      return;
    }

    const refile = ids.filter((id) => this.doc.elements[id]?.parentId !== null);
    if (refile.length) {
      this.store.dispatch({
        type: 'batch',
        actions: refile.map((id) => ({ type: 'element.patch' as const, id, patch: { parentId: null } })),
      });
    }

    const rects = ids.map((id) => {
      const el = this.doc.elements[id]!;
      const o = origins.get(id)!;
      return { x: o.x, y: o.y, w: el.w ?? defaultWidth(el), h: this.layer.heightOf(el) };
    });
    const union = unionRect(rects)!;
    const statics = this.layer
      .elements()
      .filter((el) => !this.sel.has(el.id) && el.type !== 'line' && el.type !== 'annotation')
      .map((el) => this.layer.rectOf(el));
    const snap = snapDelta({ x: union.x + dx, y: union.y + dy, w: union.w, h: union.h }, statics, this.vp.z);
    dx += snap.dx;
    dy += snap.dy;
    this.guides = snap.guides;
    this.store.dispatch({
      type: 'batch',
      actions: ids.map((id) => ({
        type: 'element.patch' as const,
        id,
        patch: { x: Math.round(origins.get(id)!.x + dx), y: Math.round(origins.get(id)!.y + dy) },
      })),
    });
    const onTrash = this.overTrashRect(ids);
    this.setTrashHint(onTrash, ids);
    this.updateDropTarget(onTrash ? null : cur, ids);
    this.render();
  }

  // The drop target is the card, not the cursor: a big card reaches the
  // can well before the pointer does, so the hint and the drop test the
  // dragged rects against the button's box. A parked locked card that
  // happens to overlap it never counts (only the dragged ids are read).
  private overTrashRect(ids: ID[]) {
    const t = document.querySelector('.rail-trash')?.getBoundingClientRect();
    if (!t) return false;
    return ids.some((id) => {
      const r = this.layer.view(id)?.node.getBoundingClientRect();
      return !!r && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top;
    });
  }

  // Trash affordance mirrors the column .drop-hint ring; while the
  // pointer is over rail chrome the board hit-test is suppressed too.
  // body.over-trash lifts the viewport so the dragged cards ride above
  // the rail wearing the danger ring instead of sliding under it.
  private trashHover = false;
  private setTrashHint(on: boolean, dragged: ID[] = []) {
    if (on === this.trashHover) return;
    this.trashHover = on;
    document.querySelector('.rail-trash')?.classList.toggle('drop-hint', on);
    document.body.classList.toggle('over-trash', on);
    if (on) {
      for (const id of dragged) this.layer.view(id)?.node.classList.add('over-trash');
    } else {
      document.querySelectorAll('.card.over-trash').forEach((n) => n.classList.remove('over-trash'));
    }
  }

  private updateDropTarget(pt: { x: number; y: number } | null, dragged: ID[]) {
    let col: ID | null = null;
    // Only the topmost card under the pointer can be the drop target:
    // a column fully covered by another card must not hint or file.
    let top: Element | null = null;
    if (pt) {
      for (const e of this.layer.elements()) {
        if (e.type === 'line' || e.type === 'annotation' || dragged.includes(e.id)) continue;
        if (e.type === 'comment' && e.anchorId !== undefined) continue;
        if (dragged.some((id) => this.hasAncestor(e.id, id))) continue;
        if (!pointInRect(pt.x, pt.y, this.layer.rectOf(e))) continue;
        if (!top || e.z > top.z) top = e;
      }
      if (top?.type === 'column') col = top.id;
    }
    if (col === this.dropColId) return;
    if (this.dropColId) this.layer.view(this.dropColId)?.node.classList.remove('drop-hint');
    if (col) this.layer.view(col)?.node.classList.add('drop-hint');
    this.dropColId = col;
  }

  // Insertion index comes from which member midpoints the pointer has
  // passed; the dragged card keeps its slot until the index moves, then
  // re-seats by taking a z between its new neighbours (fractional z).
  private reorderMember(colId: ID, memberId: ID, pt: { x: number; y: number }) {
    const members = columnMembers(this.doc, colId).filter(
      (m) => m.type !== 'line' && m.type !== 'annotation',
    );
    const idx = members.findIndex((m) => m.id === memberId);
    if (idx < 0) return;
    const others = members.filter((m) => m.id !== memberId);
    let insert = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = this.layer.rectOf(others[i]!);
      if (pt.y < r.y + r.h / 2) {
        insert = i;
        break;
      }
    }
    if (insert === idx) return;
    const prevZ = others[insert - 1]?.z;
    const nextZ = others[insert]?.z;
    const z = prevZ === undefined ? (nextZ ?? 0) - 1 : nextZ === undefined ? prevZ + 1 : (prevZ + nextZ) / 2;
    this.store.dispatch({ type: 'element.patch', id: memberId, patch: { z } });
  }

  private clearDropHint() {
    if (this.dropColId) this.layer.view(this.dropColId)?.node.classList.remove('drop-hint');
    this.dropColId = null;
  }

  private hasAncestor(id: ID, ancestor: ID): boolean {
    let cur = this.doc.elements[id];
    let guard = 0;
    while (cur?.parentId && guard++ < 64) {
      if (cur.parentId === ancestor) return true;
      cur = this.doc.elements[cur.parentId];
    }
    return false;
  }

  endDrag(ev?: PointerEvent) {
    this.setTrashHint(false);
    if (ev) {
      const dragged = [...this.sel].filter((id) => {
        const el = this.doc.elements[id];
        return (
          !!el &&
          el.type !== 'line' &&
          !el.locked &&
          !(el.type === 'comment' && el.anchorId !== undefined) &&
          !!this.layer.view(id)
        );
      });
      if (this.overTrashRect(dragged)) {
        this.clearDropHint();
        this.guides = [];
        this.deleteSelection();
        this.render();
        return;
      }
    }
    if (this.dropColId) {
      const colId = this.dropColId;
      this.clearDropHint();
      const actions: Action[] = [...this.sel]
        .map((id) => this.doc.elements[id])
        .filter(
          (e): e is Element =>
            !!e && e.type !== 'line' && e.type !== 'annotation' && e.parentId !== colId,
        )
        .map((e) => ({ type: 'element.patch', id: e.id, patch: { parentId: colId, z: ++this.doc.seq } }));
      if (actions.length) this.store.dispatch({ type: 'batch', actions });
    } else {
      this.pushOverlaps();
    }
    this.guides = [];
    this.render();
  }

  // pointercancel mid-drag: clear the in-flight drop/gesture chrome.
  abortDrag() {
    this.clearDropHint();
    this.setTrashHint(false);
    this.guides = [];
    this.render();
  }

  // Card-overlap prevention pref: after a card lands or grows, push
  // neighbours aside along the shorter axis. Iterative, capped; the
  // patches join the caller's undo group (drag/resize stay open here).
  private pushOverlaps() {
    if (!this.prefs.noOverlap || !this.boardId || this.lockedView()) return;
    const movable = (e: Element) =>
      e.boardId === this.boardId &&
      e.parentId === null &&
      e.type !== 'line' &&
      e.type !== 'annotation' &&
      !(e.type === 'comment' && e.anchorId !== undefined) &&
      !e.locked;
    const anchors = this.selectedEls().filter(movable);
    if (!anchors.length) return;
    const pos = new Map<ID, { x: number; y: number }>();
    const others = this.layer.elements().filter((e) => movable(e) && !this.sel.has(e.id));
    for (let pass = 0; pass < 6; pass++) {
      let pushed = false;
      for (const a of anchors) {
        const ae = this.doc.elements[a.id]!;
        const pa = pos.get(ae.id);
        const ra = this.layer.rectOf(pa ? { ...ae, ...pa } : ae);
        for (const o of others) {
          const oe = this.doc.elements[o.id]!;
          const po = pos.get(oe.id);
          const ro = this.layer.rectOf(po ? { ...oe, ...po } : oe);
          const ox = Math.min(ra.x + ra.w, ro.x + ro.w) - Math.max(ra.x, ro.x);
          const oy = Math.min(ra.y + ra.h, ro.y + ro.h) - Math.max(ra.y, ro.y);
          if (ox <= 0 || oy <= 0) continue;
          const cur = po ?? { x: oe.x, y: oe.y };
          const next =
            ox < oy
              ? { x: cur.x + (ro.x + ro.w / 2 < ra.x + ra.w / 2 ? -ox - 8 : ox + 8), y: cur.y }
              : { x: cur.x, y: cur.y + (ro.y + ro.h / 2 < ra.y + ra.h / 2 ? -oy - 8 : oy + 8) };
          pos.set(oe.id, { x: Math.round(next.x), y: Math.round(next.y) });
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    if (pos.size) {
      this.store.dispatch({
        type: 'batch',
        actions: [...pos].map(([id, p]) => ({ type: 'element.patch' as const, id, patch: p })),
      });
    }
  }

  startResize(id: ID, e: PointerEvent) {
    if (this.lockedView()) return;
    e.preventDefault();
    const el = this.doc.elements[id];
    if (!el || el.parentId || el.locked) return;
    const pid = e.pointerId;
    const start = this.boardPoint(e);
    const w0 = el.w ?? defaultWidth(el);
    this.store.beginGroup();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const cur = this.boardPoint(ev);
      const w = Math.round(Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, w0 + (cur.x - start.x))));
      this.store.dispatch({ type: 'element.patch', id, patch: { w } });
    };
    const done = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      if (!this.sel.has(id)) this.sel = new Set([id]);
      this.pushOverlaps();
      this.store.endGroup('resize');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }

  startPan(e: PointerEvent) {
    const pid = e.pointerId;
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      this.vp.panBy(ev.clientX - lx, ev.clientY - ly);
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // --- rail tools ---

  private onTool(id: ToolId, anchor: HTMLElement) {
    if (this.lockedView()) return;
    const sel = this.selectedEls();
    if (!sel.length) return;
    switch (id) {
      case 'color':
        openColorPopup(anchor, (c) => this.setColor(c));
        break;
      case 'labels':
        openLabelsPopup(anchor, {
          labels: () => this.boardLabels(),
          applied: (lid) => this.labelApplied(lid),
          onToggle: (lid) => this.toggleLabel(lid),
          onCreate: (name) => this.createLabel(name),
          onDelete: (lid) => this.deleteLabel(lid),
        });
        break;
      case 'reactions':
        openReactionsPopup(anchor, () => this.activeReactions(), (e) => this.toggleReaction(e));
        break;
      case 'comment':
        this.addCommentTo(sel[0]!.id);
        break;
      case 'title':
        this.titleTool(sel[0]!);
        break;
      case 'more': {
        const editing = this.editingEl();
        if (editing?.type === 'table') {
          const v = this.tableView();
          if (v) openMenuPopup(anchor, this.cellMoreItems(v));
        } else if (editing && (editing.type === 'note' || editing.type === 'heading')) {
          const surface = this.editSurface();
          if (!surface) return;
          openMenuPopup(anchor, [
            { label: t('toolInlineCode'), onPick: () => toggleInlineCode(surface) },
            { label: t('toolUnderline'), onPick: () => execMark(surface, 'underline') },
          ], true);
        } else {
          openMenuPopup(anchor, this.moreItems(sel));
        }
        break;
      }
      case 'tx-style': {
        const el = this.editingEl();
        if (el?.type === 'table') this.tableView()?.startCellEdit();
        const surface = this.editSurface();
        if (!el || !surface) return;
        if (el.type === 'heading') {
          const c = headingDoc(el);
          if (!c) return;
          const setLevel = (level: 1 | 2) => {
            const cur = headingDoc(this.doc.elements[el.id]!);
            if (!cur) return;
            this.store.dispatch({
              type: 'element.patch',
              id: el.id,
              patch: { content: { heading: { ...cur, level } } },
            });
          };
          openMenuPopup(anchor, [
            { label: t('styleLarge'), checked: c.level === 1, onPick: () => setLevel(1) },
            { label: t('styleHeading'), checked: c.level === 2, onPick: () => setLevel(2) },
          ]);
        } else {
          openTextStylePopup(anchor, {
            current: () => blockStyleAt(surface),
            onStyle: (s) => applyBlockStyle(surface, s),
            onColor: (c) => applyTextColor(surface, c),
            onHighlight: (c) => applyHighlight(surface, c),
          });
        }
        break;
      }
      case 'tx-bold':
      case 'tx-italic':
      case 'tx-strike': {
        const surface = this.editSurface();
        if (!surface) return;
        execMark(surface, id === 'tx-bold' ? 'bold' : id === 'tx-italic' ? 'italic' : 'strikeThrough');
        break;
      }
      case 'tx-bullet':
      case 'tx-numbered': {
        const surface = this.editSurface();
        if (surface) toggleList(surface, id === 'tx-bullet' ? 'ul' : 'ol');
        break;
      }
      case 'tx-center': {
        const surface = this.editSurface();
        if (surface) toggleCenter(surface);
        break;
      }
      case 'tx-link':
        if (this.editingId) this.openLinkPopupFor(this.editingId);
        break;
      case 'due': {
        const el = this.editingEl();
        const view = el ? this.layer.view(el.id) : undefined;
        if (view instanceof TodoCard) {
          const iid = view.focusedItemId();
          if (iid) view.openDueFor(iid);
        }
        break;
      }
      case 'assign': {
        const el = this.editingEl();
        const view = el ? this.layer.view(el.id) : undefined;
        if (view instanceof TodoCard) {
          const iid = view.focusedItemId();
          if (iid) view.toggleAssign(iid);
        }
        break;
      }
      case 'align':
        openMenuPopup(anchor, [
          { label: t('alignLeft'), onPick: () => this.alignSel('left') },
          { label: t('alignCenterH'), onPick: () => this.alignSel('center-h') },
          { label: t('alignRight'), onPick: () => this.alignSel('right') },
          { label: t('alignTop'), onPick: () => this.alignSel('top') },
          { label: t('alignMiddleV'), onPick: () => this.alignSel('middle-v') },
          { label: t('alignBottom'), onPick: () => this.alignSel('bottom') },
        ]);
        break;
      case 'distribute':
        openMenuPopup(anchor, [
          { label: t('distH'), onPick: () => this.distributeSel('h') },
          { label: t('distV'), onPick: () => this.distributeSel('v') },
        ]);
        break;
      case 'line-start':
      case 'line-end':
        this.cycleMarker(sel[0]!, id === 'line-start' ? 'from' : 'to');
        break;
      case 'line-label':
        this.startLabelEdit(sel[0]!.id);
        break;
      case 'line-dashed':
        this.toggleDashed(sel[0]!);
        break;
      case 'line-weight':
        openMenuPopup(anchor, this.weightItems(sel[0]!));
        break;
      case 'show-value':
        this.toggleShowValue(sel[0]!);
        break;
      case 'to-board':
        this.convertColumn(sel[0]!);
        break;
      case 'preview':
        this.togglePreview(sel[0]!);
        break;
      case 'link-info': {
        const url = linkDoc(sel[0]!)?.url ?? embedDoc(sel[0]!)?.url ?? '';
        if (url) openLinkInfoPopup(anchor, url, () => void copyTextToClipboard(url));
        break;
      }
      case 'icon': {
        const ref = boardRefOf(sel[0]!);
        if (ref) this.iconPickerFor(ref, anchor);
        break;
      }
      case 'rename':
        this.beginEdit(sel[0]!.id, undefined, 'title');
        break;
      case 'caption':
        this.beginEdit(sel[0]!.id, undefined, 'caption');
        break;
      case 'draw-on':
      case 'img-edit':
      case 'img-bg': {
        const m: ImgMode = id === 'draw-on' ? 'draw' : id === 'img-bg' ? 'bg' : 'edit';
        location.hash = `#/e/${sel[0]!.id}${imgModeParam(m)}`;
        break;
      }
      case 'card-view': {
        const c = documentDoc(sel[0]!);
        if (c) {
          this.store.dispatch({
            type: 'element.patch',
            id: sel[0]!.id,
            patch: {
              content: { document: { ...c, displayMode: c.displayMode === 'icon' ? 'detail' : 'icon' } },
            },
          });
        }
        break;
      }
      case 'cell-type': {
        const v = this.tableView();
        if (!v) return;
        const cur = v.focusedCellData()?.type ?? 'auto';
        const opts: [CellType, string][] = [
          ['auto', t('cellAuto')],
          ['number', t('cellNumber')],
          ['currency', t('cellCurrency')],
          ['percent', t('cellPercent')],
          ['text', t('cellText')],
          ['datetime', t('cellDatetime')],
          ['checkbox', t('cellCheckbox')],
        ];
        openMenuPopup(
          anchor,
          opts.map(([type, label]) => ({
            label,
            checked: type === cur,
            onPick: () => v.setCellType(type === 'auto' ? undefined : type),
          })),
        );
        break;
      }
      case 'cell-color': {
        const v = this.tableView();
        if (v) openColorPopup(anchor, (c) => this.colorBurst(() => v.patchFocused({ color: c })));
        break;
      }
      case 'cell-formula':
        this.tableView()?.insertFormula();
        break;
      case 'cell-align': {
        const v = this.tableView();
        if (!v) return;
        const cur = v.focusedCellData();
        openCellAlignPopup(anchor, {
          h: cur?.alignH,
          v: cur?.alignV,
          onH: (h) => v.patchFocused({ alignH: h }),
          onV: (vv) => v.patchFocused({ alignV: vv }),
        });
        break;
      }
      case 'cell-addcol': {
        const v = this.tableView();
        const f = v?.focusedCell();
        if (v && f) v.insertColumn(f.c + 1);
        break;
      }
      case 'cell-addrow': {
        const v = this.tableView();
        const f = v?.focusedCell();
        if (v && f) v.insertRow(f.r + 1);
        break;
      }
    }
  }

  // The TableCard for the element being edited, when a cell is focused.
  private tableView(): TableCard | null {
    const el = this.editingEl();
    const v = el ? this.layer.view(el.id) : undefined;
    return v instanceof TableCard ? v : null;
  }

  private cellMoreItems(v: TableCard): MenuItem[] {
    const f = v.focusedCell();
    if (!f) return [];
    return [
      { label: t('addRowAbove'), hint: 'Opt+Up', onPick: () => v.insertRow(f.r) },
      { label: t('addColLeft'), hint: 'Opt+Left', onPick: () => v.insertColumn(f.c) },
      { label: t('addRowBelow'), hint: 'Opt+Down', onPick: () => v.insertRow(f.r + 1) },
      { label: t('addColRight'), hint: 'Opt+Right', onPick: () => v.insertColumn(f.c + 1) },
      { label: t('clearCell'), onPick: () => v.clearFocusedCell() },
      { label: t('deleteRow'), onPick: () => v.deleteFocusedRow() },
      { label: t('deleteCol'), onPick: () => v.deleteFocusedColumn() },
    ];
  }

  // Native color wells fire 'input' continuously; a short-lived undo
  // group collapses a whole scrub into one history entry.
  private colorTimer = 0;
  private colorBurst(fn: () => void) {
    if (!this.colorTimer) this.store.beginGroup();
    clearTimeout(this.colorTimer);
    this.colorTimer = window.setTimeout(() => {
      this.colorTimer = 0;
      this.store.endGroup('color');
    }, 400);
    fn();
  }

  private setColor(color: string | undefined) {
    this.colorBurst(() => {
      const actions: Action[] = this.selectedEls().map((e) => ({
        type: 'element.patch',
        id: e.id,
        patch: { color },
      }));
      if (actions.length) this.store.dispatch({ type: 'batch', actions });
    });
  }

  private boardLabels(): Label[] {
    return Object.values(this.doc.labels)
      .filter((l) => l.boardId === this.boardId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private labelTargets(): Element[] {
    return this.selectedEls().filter((e) => e.type !== 'line');
  }

  private labelApplied(lid: ID): 'all' | 'some' | 'none' {
    const els = this.labelTargets();
    const n = els.filter((e) => e.labels.includes(lid)).length;
    return n === 0 ? 'none' : n === els.length ? 'all' : 'some';
  }

  private toggleLabel(lid: ID) {
    const apply = this.labelApplied(lid) !== 'all';
    const actions: Action[] = this.labelTargets().map((e) => ({
      type: 'element.patch',
      id: e.id,
      patch: { labels: apply ? [...e.labels, lid] : e.labels.filter((l) => l !== lid) },
    }));
    if (actions.length) this.store.dispatch({ type: 'batch', actions });
  }

  private createLabel(name: string) {
    if (!this.boardId) return;
    const color = LABEL_COLORS[this.boardLabels().length % LABEL_COLORS.length]!;
    const label = createLabel(this.boardId, name, color);
    const actions: Action[] = [{ type: 'label.create', label }];
    for (const e of this.labelTargets()) {
      actions.push({ type: 'element.patch', id: e.id, patch: { labels: [...e.labels, label.id] } });
    }
    this.store.dispatch({ type: 'batch', actions });
  }

  private deleteLabel(lid: ID) {
    const label = this.doc.labels[lid];
    if (!label) return;
    const actions: Action[] = [{ type: 'label.delete', label }];
    for (const e of Object.values(this.doc.elements)) {
      if (e.labels.includes(lid)) {
        actions.push({ type: 'element.patch', id: e.id, patch: { labels: e.labels.filter((l) => l !== lid) } });
      }
    }
    this.store.dispatch({ type: 'batch', actions });
  }

  private activeReactions(): Set<string> {
    const els = this.labelTargets();
    if (!els.length) return new Set();
    const out = new Set(els[0]!.reactions ?? []);
    for (const e of els.slice(1)) {
      for (const r of [...out]) if (!(e.reactions ?? []).includes(r)) out.delete(r);
    }
    return out;
  }

  private toggleReaction(emoji: string) {
    const on = !this.activeReactions().has(emoji);
    const actions: Action[] = this.labelTargets().map((e) => {
      const cur = e.reactions ?? [];
      const has = cur.includes(emoji);
      const next = on ? (has ? cur : [...cur, emoji]) : cur.filter((r) => r !== emoji);
      return { type: 'element.patch' as const, id: e.id, patch: { reactions: next.length ? next : undefined } };
    });
    if (actions.length) this.store.dispatch({ type: 'batch', actions });
  }

  private addCommentTo(cardId: ID, anchorOverride?: HTMLElement) {
    const anchor = this.doc.elements[cardId];
    if (!anchor || !this.boardId) return;
    const r = this.layer.rectOf(anchor);
    const el = createComment(this.doc, this.boardId, Math.round(r.x + r.w + 24), Math.round(r.y), cardId);
    this.store.dispatch({ type: 'element.create', el });
    this.selectOnly(el.id);
    const s = this.vp.toScreen(r.x + r.w, r.y);
    this.openCommentThread(el.id, anchorOverride ?? new DOMRect(s.x - 12, s.y - 12, 24, 24));
  }

  private titleTool(el: Element) {
    if (el.type === 'todo') {
      const c = todoDoc(el);
      if (c) {
        this.store.dispatch({
          type: 'element.patch',
          id: el.id,
          patch: { content: { todo: { ...c, showTitle: !c.showTitle } } },
        });
      }
      return;
    }
    if (el.type === 'heading') {
      const c = headingDoc(el);
      if (c) {
        this.store.dispatch({
          type: 'element.patch',
          id: el.id,
          patch: { content: { heading: { text: c.text, level: c.level === 1 ? 2 : 1 } } },
        });
      }
      return;
    }
    if (el.type === 'table') {
      this.beginEdit(el.id, undefined, 'title');
      return;
    }
    this.beginEdit(el.id);
  }

  private moreItems(sel: Element[]): MenuItem[] {
    const items: MenuItem[] = [];
    // An anchored comment renders only as a pin: lock/z-order/file are
    // no-ops, so the menu offers just the detach back to a free card.
    if (sel.length === 1 && sel[0]!.type === 'comment' && sel[0]!.anchorId !== undefined) {
      const el = sel[0]!;
      return [
        {
          label: t('detachComment'),
          onPick: () => {
            const r = this.layer.rectOf(el);
            this.store.dispatch({
              type: 'element.patch',
              id: el.id,
              patch: { anchorId: undefined, x: Math.round(r.x + r.w + 12), y: Math.round(r.y) },
            });
          },
        },
      ];
    }
    if (sel.length > 1) items.push({ label: t('connectLines'), onPick: () => this.connectSel() });
    if (sel.length === 1) {
      const el = sel[0]!;
      const c = el.content;
      if (('link' in c && c.link.url) || ('embed' in c && c.embed.url)) {
        const url = 'link' in c ? c.link.url : 'embed' in c ? c.embed.url : '';
        items.push({ label: t('copyLink'), onPick: () => void copyTextToClipboard(url) });
      }
      if ('image' in c) {
        items.push(
          { label: t('downloadOriginal'), onPick: () => void downloadBlobRef(c.image.blobRef, c.image.name || 'image') },
          { label: t('replaceImage'), onPick: () => this.replaceImage(el) },
          { label: t('cropToGrid'), onPick: () => void this.cropImageToGrid(el) },
        );
      }
      if ('file' in c) {
        items.push(
          { label: t('downloadFile'), onPick: () => void downloadBlobRef(c.file.blobRef, c.file.name) },
          {
            label: t('openFile'),
            onPick: () =>
              void blobUrl(c.file.blobRef).then((u) => {
                if (u) window.open(u, '_blank');
              }),
          },
        );
      }
      if ('note' in c) {
        items.push({ label: t('convertToDocument'), onPick: () => this.convertToDocument(el) });
      }
      if (el.syncGroup) {
        items.push({
          label: t('unlinkCopy'),
          onPick: () => this.store.dispatch({ type: 'element.patch', id: el.id, patch: { syncGroup: undefined } }),
        });
      }
      if ('document' in c) {
        items.push({ label: t('convertToNote'), onPick: () => this.convertToNote(el) });
      }
      if ('annotation' in c) {
        items.push(
          { label: t('downloadSvg'), onPick: () => this.downloadAnnotation(el) },
          { label: t('convertToSketch'), onPick: () => this.convertToSketch(el) },
        );
      }
      if ('boardRef' in c) {
        const ref = c.boardRef;
        items.push(
          { label: t('openNewTab'), onPick: () => window.open(this.boardUrl(ref), '_blank') },
          { label: t('copyLinkBoard'), onPick: () => void copyTextToClipboard(this.boardUrl(ref)) },
          { label: t('createShortcut'), onPick: () => this.createShortcut(el) },
          { label: t('convertToTemplate'), onPick: () => this.saveAsTemplate(ref) },
        );
      }
    }
    const allLocked = sel.every((e) => e.locked);
    items.push(
      { label: t('lockPosition'), checked: allLocked, onPick: () => this.toggleLock(!allLocked) },
      { label: t('bringToFront'), onPick: () => this.zOrder('front') },
      { label: t('sendToBack'), onPick: () => this.zOrder('back') },
    );
    // Keyboard/discoverability parity for the Opt+` filing shortcut.
    if (this.movableCards().length) {
      items.push({ label: t('sendToUnsorted'), onPick: () => this.fileToUnsorted() });
    }
    return items;
  }

  private toggleLock(locked: boolean) {
    const actions: Action[] = this.selectedEls().map((e) => ({
      type: 'element.patch',
      id: e.id,
      patch: { locked },
    }));
    if (actions.length) this.store.dispatch({ type: 'batch', actions });
  }

  zOrder(dir: 'front' | 'back') {
    if (this.lockedView()) return;
    const els = [...this.selectedEls()].sort((a, b) => a.z - b.z);
    if (!els.length) return;
    let actions: Action[];
    if (dir === 'front') {
      actions = els.map((e) => ({ type: 'element.patch' as const, id: e.id, patch: { z: ++this.doc.seq } }));
    } else {
      const min = Math.min(...this.layer.elements().map((e) => e.z));
      actions = els.map((e, i) => ({
        type: 'element.patch' as const,
        id: e.id,
        patch: { z: min - els.length + i },
      }));
    }
    this.store.dispatch({ type: 'batch', actions });
  }

  private alignSel(mode: 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom') {
    const els = this.movableCards();
    if (els.length < 2) return;
    const rects = new Map(els.map((e) => [e.id, this.layer.rectOf(e)]));
    const u = unionRect([...rects.values()])!;
    const actions: Action[] = els.map((e) => {
      const r = rects.get(e.id)!;
      const patch =
        mode === 'left'
          ? { x: Math.round(u.x) }
          : mode === 'center-h'
            ? { x: Math.round(u.x + (u.w - r.w) / 2) }
            : mode === 'right'
              ? { x: Math.round(u.x + u.w - r.w) }
              : mode === 'top'
                ? { y: Math.round(u.y) }
                : mode === 'middle-v'
                  ? { y: Math.round(u.y + (u.h - r.h) / 2) }
                  : { y: Math.round(u.y + u.h - r.h) };
      return { type: 'element.patch' as const, id: e.id, patch };
    });
    this.store.dispatch({ type: 'batch', actions });
  }

  private distributeSel(axis: 'h' | 'v') {
    const els = this.movableCards();
    if (els.length < 3) return;
    const rects = new Map(els.map((e) => [e.id, this.layer.rectOf(e)]));
    const sorted = [...els].sort((a, b) => {
      const ra = rects.get(a.id)!;
      const rb = rects.get(b.id)!;
      return axis === 'h' ? ra.x - rb.x : ra.y - rb.y;
    });
    const u = unionRect([...rects.values()])!;
    const span = axis === 'h' ? u.w : u.h;
    const total = sorted.reduce((n, e) => n + (axis === 'h' ? rects.get(e.id)!.w : rects.get(e.id)!.h), 0);
    const gap = (span - total) / (sorted.length - 1);
    let pos = axis === 'h' ? u.x : u.y;
    const actions: Action[] = [];
    for (const e of sorted) {
      const r = rects.get(e.id)!;
      actions.push({
        type: 'element.patch',
        id: e.id,
        patch: axis === 'h' ? { x: Math.round(pos) } : { y: Math.round(pos) },
      });
      pos += (axis === 'h' ? r.w : r.h) + gap;
    }
    this.store.dispatch({ type: 'batch', actions });
  }

  private connectSel() {
    const els = this.movableCards();
    if (els.length < 2 || !this.boardId) return;
    const sorted = [...els].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const actions: Action[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const ra = this.layer.rectOf(sorted[i]!);
      const rb = this.layer.rectOf(sorted[i + 1]!);
      const line = createLine(
        this.doc,
        this.boardId,
        { el: sorted[i]!.id, x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 },
        { el: sorted[i + 1]!.id, x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 },
      );
      actions.push({ type: 'element.create', el: line });
    }
    this.store.dispatch({ type: 'batch', actions });
  }

  private cycleMarker(el: Element, which: 'from' | 'to') {
    const c = lineDoc(el);
    if (!c) return;
    const cur = which === 'from' ? c.fromMarker : c.toMarker;
    const next: LineMarker = cur === 'none' ? 'arrow' : cur === 'arrow' ? 'dot' : 'none';
    this.store.dispatch({
      type: 'element.patch',
      id: el.id,
      patch: {
        content: { line: which === 'from' ? { ...c, fromMarker: next } : { ...c, toMarker: next } },
      },
    });
  }

  private toggleDashed(el: Element) {
    const c = lineDoc(el);
    if (!c) return;
    this.store.dispatch({
      type: 'element.patch',
      id: el.id,
      patch: { content: { line: { ...c, dashed: !c.dashed } } },
    });
  }

  private weightItems(el: Element): MenuItem[] {
    const c = lineDoc(el);
    const set = (weight: LineWeight) => {
      const cur = lineDoc(this.doc.elements[el.id]!);
      if (!cur) return;
      this.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: { content: { line: { ...cur, weight } } },
      });
    };
    const opts: [LineWeight, string][] = [
      ['thin', t('weightThin')],
      ['medium', t('weightMedium')],
      ['thick', t('weightThick')],
    ];
    return opts.map(([w, label]) => ({ label, checked: c?.weight === w, onPick: () => set(w) }));
  }

  private toggleShowValue(el: Element) {
    const c = swatchDoc(el);
    if (!c) return;
    this.store.dispatch({
      type: 'element.patch',
      id: el.id,
      patch: { content: { swatch: { ...c, showValue: !c.showValue } } },
    });
  }

  private togglePreview(el: Element) {
    const c = el.content;
    if ('link' in c) {
      this.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: { content: { link: { ...c.link, showPreview: !c.link.showPreview } } },
      });
    } else if ('embed' in c) {
      this.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: { content: { embed: { ...c.embed, showPreview: !c.embed.showPreview } } },
      });
    }
  }

  // Column -> nested board: members re-file to the new board, the column
  // is replaced by a board card in place. One batch, one undo.
  private convertColumn(el: Element) {
    if (el.type !== 'column' || !this.boardId) return;
    const members = columnMembers(this.doc, el.id);
    const board = createBoard({ parentId: this.boardId, title: columnTitle(el) || t('untitled') });
    const card = createBoardCard(this.doc, this.boardId, board.id, el.x, el.y);
    const actions: Action[] = [
      { type: 'board.create', board },
      { type: 'element.create', el: card },
      ...this.retargetAttachActions(el.id, card.id),
      ...members.map(
        (m, i): Action => ({
          type: 'element.patch',
          id: m.id,
          patch: { boardId: board.id, parentId: null, x: 80 + (i % 4) * 280, y: 80 + Math.floor(i / 4) * 200 },
        }),
      ),
      { type: 'element.delete', el },
    ];
    this.store.dispatch({ type: 'batch', actions });
    this.sel.delete(el.id);
    this.sel.add(card.id);
    this.render();
  }

  // Note -> Document: the note's text/html becomes the doc body, the
  // card swaps type in place. One batch, one undo.
  private convertToDocument(el: Element) {
    if (!('note' in el.content) || !this.boardId) return;
    const n = el.content.note;
    const doc = createDocument(this.doc, this.boardId, el.x, el.y);
    if (el.w !== undefined) doc.w = el.w;
    doc.z = el.z;
    doc.parentId = el.parentId;
    if (el.color !== undefined) doc.color = el.color;
    doc.labels = [...el.labels];
    if (el.reactions) doc.reactions = [...el.reactions];
    doc.content = {
      document: {
        title: '',
        text: n.text,
        ...(n.html !== undefined ? { html: n.html } : {}),
        displayMode: 'detail',
        caption: '',
      },
    };
    this.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'element.create', el: doc },
        ...this.retargetAttachActions(el.id, doc.id),
        { type: 'element.delete', el },
      ],
    });
    this.setSelection([doc.id]);
  }

  // Document -> Note: the doc body becomes note text/html, same swap.
  private convertToNote(el: Element) {
    const c = documentDoc(el);
    if (!c || !this.boardId) return;
    const note = createNote(this.doc, this.boardId, el.x, el.y, c.text);
    if (el.w !== undefined) note.w = el.w;
    note.z = el.z;
    note.parentId = el.parentId;
    if (el.color !== undefined) note.color = el.color;
    note.labels = [...el.labels];
    if (el.reactions) note.reactions = [...el.reactions];
    note.content = { note: c.html !== undefined ? { text: c.text, html: c.html } : { text: c.text } };
    this.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'element.create', el: note },
        ...this.retargetAttachActions(el.id, note.id),
        { type: 'element.delete', el },
      ],
    });
    this.setSelection([note.id]);
  }

  private downloadAnnotation(el: Element) {
    const c = annotationDoc(el);
    if (!c) return;
    downloadTextFile('annotation.svg', strokesToSvgFile(c.strokes), 'image/svg+xml');
  }

  // Annotation -> Sketch card: board-space strokes are rescaled into the
  // sketch pad's fixed 600x450 space, centered. One batch.
  private convertToSketch(el: Element) {
    const c = annotationDoc(el);
    if (!c || !this.boardId) return;
    const box = strokesBBox(c.strokes);
    const s = Math.min(
      4,
      (SKETCH_PAD_W - 40) / Math.max(1, box.w),
      (SKETCH_PAD_H - 40) / Math.max(1, box.h),
    );
    const ox = (SKETCH_PAD_W - box.w * s) / 2;
    const oy = (SKETCH_PAD_H - box.h * s) / 2;
    const strokes: Stroke[] = c.strokes.map((st) => ({
      color: st.color,
      size: Math.max(1, st.size * s),
      pts: st.pts.map(([px, py]): [number, number] => [(px - box.x) * s + ox, (py - box.y) * s + oy]),
    }));
    const sk = createSketch(this.doc, this.boardId, el.x, el.y);
    sk.w = Math.max(el.w ?? 0, 220);
    sk.z = el.z;
    if (el.color !== undefined) sk.color = el.color;
    sk.labels = [...el.labels];
    sk.content = { sketch: { strokes } };
    this.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'element.create', el: sk },
        ...this.retargetAttachActions(el.id, sk.id),
        { type: 'element.delete', el },
      ],
    });
    this.setSelection([sk.id]);
  }

  // --- file + media ingestion ---

  private viewCenter() {
    return this.vp.toBoard(this.vp.vw / 2, this.vp.vh / 2);
  }

  private pastePoint() {
    return this.pointer ?? this.viewCenter();
  }

  // Topmost column under a board point; file drops onto a column join it.
  private columnAt(pt: { x: number; y: number }): ID | null {
    const cols = this.layer
      .elements()
      .filter((el) => el.type === 'column')
      .sort((a, b) => b.z - a.z);
    for (const c of cols) {
      if (pointInRect(pt.x, pt.y, this.layer.rectOf(c))) return c.id;
    }
    return null;
  }

  private ingestApi(): IngestApi {
    const boardId = this.boardId!;
    return {
      doc: this.doc,
      boardId,
      dispatch: (a) => this.store.dispatch(a),
      // Async ingest resolves after the user may have switched boards:
      // only select when still on the board the files landed on.
      select: (ids) => {
        if (this.boardId === boardId) this.setSelection(ids);
      },
      parentFor: (pt) => this.columnAt(pt),
    };
  }

  ingestFileList(files: File[], pt: { x: number; y: number }) {
    if (!this.boardId || this.lockedView()) return;
    void ingestFiles(files, pt, this.ingestApi());
  }

  private pickFiles(accept: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'file-upload';
    input.accept = accept;
    input.multiple = true;
    input.addEventListener('change', () => {
      if (input.files?.length) this.ingestFileList([...input.files], this.viewCenter());
    });
    input.click();
  }

  // Image More > Replace Image: swap the blob, keep caption and position.
  // Strokes drop with the old natural space.
  private async replaceImage(el: Element) {
    const c = imageDoc(el);
    if (!c) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'image-replace';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const { blob, aspect, natW, natH } = await prepareImage(file);
          const ref = uid();
          await putBlob(ref, blob);
          const cur = imageDoc(this.doc.elements[el.id]!);
          if (!cur) return;
          const next = { ...cur, blobRef: ref, name: file.name || cur.name, aspect, natW, natH };
          delete next.strokes;
          this.store.dispatch({
            type: 'element.patch',
            id: el.id,
            patch: { content: { image: next } },
          });
        } catch {
          toast(t('imageMissing'));
        }
      })();
    });
    input.click();
  }

  // Image More > Crop Image to Fit Dot Grid: snap the card rect to the
  // dot grid, then centre-crop the bitmap so its aspect exactly fills
  // the snapped card (no CSS cover crop remains). Interpretation:
  // width AND rendered height land on grid multiples.
  private async cropImageToGrid(el: Element) {
    const c = imageDoc(el);
    if (!c) return;
    const w = Math.max(GRID, Math.round((el.w ?? IMAGE_W) / GRID) * GRID);
    const x = Math.round(el.x / GRID) * GRID;
    const y = Math.round(el.y / GRID) * GRID;
    const h = Math.max(GRID, Math.round(w / c.aspect / GRID) * GRID);
    const aspect = w / h;
    const patch: ElementPatch = { x, y, w };
    if (Math.abs(aspect - c.aspect) > 0.001) {
      const bmp = await loadBitmap(c.blobRef);
      if (!bmp) {
        toast(t('imageMissing'));
        return;
      }
      const srcA = bmp.width / bmp.height;
      const cw = srcA > aspect ? Math.round(bmp.height * aspect) : bmp.width;
      const ch = srcA > aspect ? bmp.height : Math.round(bmp.width / aspect);
      const out = cropImage(bmp, { x: (bmp.width - cw) / 2, y: (bmp.height - ch) / 2, w: cw, h: ch });
      const blob = await canvasBlob(out, true);
      if (!blob) return;
      const ref = uid();
      try {
        await putBlob(ref, blob);
      } catch {
        toast(t('imageMissing'));
        return;
      }
      const cur = imageDoc(this.doc.elements[el.id]!);
      if (!cur) return;
      const next = { ...cur, blobRef: ref, aspect, natW: cw, natH: ch };
      delete next.strokes;
      patch.content = { image: next };
    }
    this.store.dispatch({ type: 'element.patch', id: el.id, patch });
  }

  // OS-clipboard paste: internal element clipboard wins, then files,
  // then URL text -> link card. Text fields keep native paste.
  pasteExternal(e: ClipboardEvent) {
    if (this.isTextTarget(e) || !this.boardId || this.lockedView()) return;
    e.preventDefault();
    if (getClipboard()?.length) {
      this.paste();
      return;
    }
    const { files, url } = ingestPaste(e);
    const pt = this.pastePoint();
    if (files.length) {
      this.ingestFileList(files, pt);
      return;
    }
    if (url) this.createLinkAt(pt, url);
  }

  private createLinkAt(pt: { x: number; y: number }, url: string) {
    if (!this.boardId) return;
    const el = createLink(this.doc, this.boardId, Math.round(pt.x), Math.round(pt.y));
    const c = linkDoc(el)!;
    el.content = { link: { ...c, url, title: hostOf(url) } };
    this.stampBoardColor(el);
    this.store.dispatch({ type: 'element.create', el });
    this.setSelection([el.id]);
    this.enrichLink(el.id, url);
  }

  // --- unsorted / trash / panels ---

  private closePanel() {
    this.panel?.close();
    this.panel = null;
    this.panelKind = null;
  }

  fileToUnsorted() {
    if (this.lockedView()) return;
    const els = this.movableCards().filter((e) => e.parentId === null);
    if (!els.length) return;
    this.store.dispatch({
      type: 'batch',
      actions: els.map((e) => ({ type: 'element.patch' as const, id: e.id, patch: { parentId: UNSORTED } })),
    });
    for (const e of els) this.sel.delete(e.id);
    this.render();
  }

  private unsortedItems(): Element[] {
    return Object.values(this.doc.elements)
      .filter((e) => e.boardId === this.boardId && e.parentId === UNSORTED && e.type !== 'line')
      .sort((a, b) => b.z - a.z);
  }

  private takePanel(kind: 'unsorted' | 'trash' | 'search', handle: PanelHandle) {
    this.closePanel();
    this.panel = handle;
    this.panelKind = kind;
    handle.onClose = () => {
      if (this.panel === handle) {
        this.panel = null;
        this.panelKind = null;
      }
    };
  }

  openUnsorted() {
    if (this.panelKind === 'unsorted') {
      this.closePanel();
      return;
    }
    this.takePanel('unsorted', openPanel({ title: t('unsortedTitle'), helper: t('unsortedHelp') }));
    this.renderPanel();
  }

  openTrash() {
    if (this.panelKind === 'trash') {
      this.closePanel();
      return;
    }
    this.takePanel(
      'trash',
      openPanel({ title: t('trashTitle'), actionLabel: t('emptyTrash'), onAction: () => this.emptyTrash() }),
    );
    this.renderPanel();
  }

  openSearch() {
    if (this.panelKind === 'search') {
      this.closePanel();
      return;
    }
    const boardId = this.boardId;
    if (!boardId) return;
    this.takePanel(
      'search',
      openSearchPanel({
        search: (q) => searchBoard(this.doc, boardId, q),
        recents: () =>
          (this.prefs.recentBoards ?? [])
            .map((bid) => {
              const b = this.doc.boards[bid];
              return b ? { boardId: bid, title: b.title, ...(b.icon !== undefined ? { icon: b.icon } : {}) } : null;
            })
            .filter((r): r is NonNullable<typeof r> => !!r),
        recentIds: () => this.prefs.recentBoards ?? [],
        onJump: (hit) => this.jumpToHit(hit),
        onClose: () => {},
      }),
    );
  }

  openShortcuts() {
    openShortcutsPanel();
  }

  eyedrop() {
    if (this.sel.size !== 1 || this.lockedView()) return;
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } })
      .EyeDropper;
    if (!EyeDropperCtor) return;
    const id = [...this.sel][0]!;
    new EyeDropperCtor()
      .open()
      .then(({ sRGBHex }) => {
        if (!this.doc.elements[id]) return;
        this.store.dispatch({ type: 'element.patch', id, patch: { color: sRGBHex } });
      })
      .catch(() => {});
  }

  private jumpToHit(hit: SearchHit) {
    const q = hit.query ?? '';
    if (!hit.elementId) {
      this.openBoard(hit.boardId, q || undefined);
      this.applyRouteFilter();
      this.closePanel();
      return;
    }
    const hash = `#/b/${hit.boardId}?filter_query=${encodeURIComponent(q)}&filter_ids=${hit.elementId}`;
    if (hit.boardId !== this.boardId) {
      location.hash = hash;
    } else {
      history.pushState(null, '', hash);
      this.applyRouteFilter();
    }
    this.closePanel();
  }

  // Deep-link params: #/b/<id>?filter_query=<q>&filter_ids=<elementId>.
  // Selects matched cards and centres the first; highlight only.
  applyRouteFilter() {
    if (!this.boardId) return;
    const m = location.hash.match(/^#\/b\/[^?#]+\?([^#]*)$/);
    const params = m ? new URLSearchParams(m[1]!) : null;
    const fid = params?.get('filter_ids');
    const q = params?.get('filter_query') ?? '';
    let hits: Element[] = [];
    if (fid) {
      const el = this.doc.elements[fid];
      if (el && el.boardId === this.boardId) hits = [el];
    } else if (q) {
      hits = searchBoard(this.doc, this.boardId, q)
        .map((h) => (h.elementId ? this.doc.elements[h.elementId] : undefined))
        .filter((e): e is Element => !!e);
    }
    if (!hits.length) {
      // No usable filter params: drop any stale highlight (e.g. after
      // Back navigation stripped the query from a filtered URL).
      if (this.filterIds.size) {
        this.filterIds.clear();
        this.sel.clear();
        this.render();
      }
      return;
    }
    // Filtered mode: matched cards stay lit, the rest of the board dims
    // until the user selects something else.
    this.filterIds = new Set(hits.map((e) => e.id));
    this.sel = new Set(hits.map((e) => e.id));
    this.render();
    this.centerOn(this.layer.rectOf(hits[0]!));
  }

  private centerOn(r: Rect) {
    this.vp.x = this.vp.vw / 2 - (r.x + r.w / 2) * this.vp.z;
    this.vp.y = this.vp.vh / 2 - (r.y + r.h / 2) * this.vp.z;
    this.vp.changed();
  }

  private emptyTrash() {
    const ids = Object.keys(this.doc.trash);
    if (!ids.length) return;
    void releaseTrashBlobs(this.doc, ids);
    this.store.dispatch({ type: 'batch', actions: ids.map((id) => ({ type: 'trash.remove' as const, id })) });
  }

  private restoreTrash(id: ID, pt: { x: number; y: number }) {
    const entry = this.doc.trash[id];
    if (!entry) return;
    const boardId = this.boardId ?? entry.el.boardId;
    const el: Element = {
      ...entry.el,
      boardId,
      parentId: null,
      x: Math.round(pt.x),
      y: Math.round(pt.y),
      z: ++this.doc.seq,
    };
    // Dead or foreign-board anchors would leave the restored card
    // permanently invisible: it skips the layer, the pins overlay
    // (no anchor), and marquee.
    if (el.anchorId !== undefined && this.doc.elements[el.anchorId]?.boardId !== boardId) {
      delete el.anchorId;
    }
    el.labels = el.labels.filter((l) => this.doc.labels[l]?.boardId === boardId);
    if (boardId !== entry.el.boardId) delete el.syncGroup;
    this.stampBoardColor(el);
    this.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'element.create', el },
        { type: 'trash.remove', id },
      ],
    });
    this.setSelection([el.id]);
  }

  private snippetFor(el: Element): string {
    const c = el.content;
    if ('note' in c) return c.note.text.split('\n')[0] || t('railNote');
    if ('heading' in c) return c.heading.text || t('railHeading');
    if ('todo' in c) return c.todo.title || c.todo.items.find((i) => i.text)?.text || t('railTodo');
    if ('column' in c) return c.column.title || t('railColumn');
    if ('boardRef' in c) return this.doc.boards[c.boardRef]?.title ?? t('railBoard');
    if ('swatch' in c) return c.swatch.caption || c.swatch.color;
    if ('comment' in c) return c.comment.items[0]?.text ?? t('railComment');
    if ('line' in c) return c.line.label || t('railLine');
    if ('link' in c) return c.link.title || c.link.url || t('railLink');
    if ('embed' in c) {
      const label = { audio: t('railAudio'), map: t('railMap'), video: t('railVideo') }[c.embed.kind];
      return c.embed.title || c.embed.url || label;
    }
    if ('image' in c) return c.image.caption || c.image.name || t('railImage');
    if ('file' in c) return c.file.name;
    if ('document' in c) return c.document.title || c.document.text.split('\n')[0] || t('railDocument');
    if ('sketch' in c) return t('railSketch');
    if ('table' in c) {
      return c.table.title || c.table.cells.flat().find((cell) => cell.text)?.text || t('railTable');
    }
    if ('annotation' in c) return t('railAnnotation');
    return el.type;
  }

  private draggableRow(el: Element, extra: string | undefined, onDrop: (pt: { x: number; y: number }) => void) {
    const row = panelRow(typeIcon(el.type), this.snippetFor(el).slice(0, 60), extra);
    row.classList.add('draggable');
    row.addEventListener('pointerdown', (e) => {
      dragGhost(
        e,
        () => {
          const g = document.createElement('div');
          g.innerHTML = `${typeIcon(el.type)}<span></span>`;
          g.querySelector('span')!.textContent = this.snippetFor(el).slice(0, 30);
          return g;
        },
        (ev, moved) => {
          if (!moved) return;
          if (document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.side-panel, .rail, .rail-trash')) return;
          onDrop(this.boardPoint(ev));
        },
      );
    });
    return row;
  }

  private renderPanel() {
    if (!this.panel || !this.panelKind || this.panelKind === 'search') return;
    const body = this.panel.body;
    body.textContent = '';
    if (this.panelKind === 'unsorted') {
      const items = this.unsortedItems();
      if (!items.length) {
        body.appendChild(panelEmpty(t('unsortedEmpty')));
        return;
      }
      for (const el of items) {
        body.appendChild(
          this.draggableRow(el, undefined, (pt) => {
            this.store.dispatch({
              type: 'element.patch',
              id: el.id,
              patch: { parentId: null, x: Math.round(pt.x), y: Math.round(pt.y) },
            });
            this.setSelection([el.id]);
          }),
        );
      }
      return;
    }
    const entries = Object.entries(this.doc.trash).sort((a, b) => b[1].deletedAt - a[1].deletedAt);
    if (!entries.length) {
      body.appendChild(panelEmpty(t('trashEmpty')));
      return;
    }
    let group = '';
    for (const [id, entry] of entries) {
      const g = dayGroupLabel(entry.deletedAt);
      if (g !== group) {
        group = g;
        const head = document.createElement('div');
        head.className = 'sp-group';
        head.textContent = g;
        body.appendChild(head);
      }
      body.appendChild(this.draggableRow(entry.el, relTime(entry.deletedAt), (pt) => this.restoreTrash(id, pt)));
    }
  }

  // --- boards: icons, templates, preferences ---

  private placeBoard(hostId: ID, pt: { x: number; y: number }, tpl: import('./state/schema').Template | null) {
    if (tpl) {
      const { actions, cardId } = instantiateActions(this.doc, tpl, hostId, pt);
      this.store.dispatch({ type: 'batch', actions });
      this.setSelection([cardId]);
      return;
    }
    const board = createBoard({ parentId: hostId });
    const el = createBoardCard(this.doc, hostId, board.id, Math.round(pt.x), Math.round(pt.y));
    this.stampBoardColor(el);
    this.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'board.create', board },
        { type: 'element.create', el },
      ],
    });
    this.setSelection([el.id]);
  }

  private saveAsTemplate(ref: ID) {
    const tpl = snapshotTemplate(this.doc, ref, this.doc.boards[ref]?.title ?? '');
    if (!tpl) return;
    this.store.dispatch({ type: 'template.create', tpl });
    toast(t('tplSaved'));
  }

  // A second board card pointing at the same board, placed beside the
  // original like a duplicate.
  private createShortcut(el: Element) {
    const ref = boardRefOf(el);
    if (!ref || !this.boardId) return;
    const card = createBoardCard(this.doc, this.boardId, ref, el.x + 24, el.y + 24);
    this.stampBoardColor(card);
    this.store.dispatch({ type: 'element.create', el: card });
    this.setSelection([card.id]);
  }

  private setBoardIcon(boardId: ID, icon: string | undefined) {
    // The old icon blob stays: undo restores the 'b:' ref, and the
    // boot-time orphan purge reclaims it once it is truly dead.
    this.store.dispatch({ type: 'board.patch', id: boardId, patch: { icon } });
  }

  private iconPickerFor(boardId: ID, anchor: HTMLElement | DOMRect) {
    if (this.lockedView()) return;
    openIconPicker(anchor, {
      title: () => this.doc.boards[boardId]?.title ?? '',
      onPick: (icon) => this.setBoardIcon(boardId, icon),
      onUpload: () => this.uploadBoardIcon(boardId),
    });
  }

  private uploadBoardIcon(boardId: ID) {
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'board-icon-upload';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const { blob } = await prepareImage(file);
          const ref = uid();
          await putBlob(ref, blob);
          this.setBoardIcon(boardId, `b:${ref}`);
        } catch {
          toast(t('imageMissing'));
        }
      })();
    });
    input.click();
  }

  // --- preferences ---

  applyPrefs() {
    // Storage key keeps the planboard name for data continuity.
    localStorage.setItem('planboard:lang', this.prefs.lang ?? 'en');
    setTheme(this.prefs.theme === 'dark' ? 'dark' : 'light');
    setUiScale(this.prefs.uiScale ?? 1);
    setFormatting({
      browserLang: this.prefs.browserLang ?? true,
      lang: this.prefs.lang ?? 'en',
      currency: this.prefs.currency ?? 'USD',
    });
    this.renderer.invalidate();
    this.render();
  }

  toggleTheme() {
    this.prefs.theme = isDark() ? 'light' : 'dark';
    this.applyPrefs();
    this.scheduleSave();
  }

  stepUiScale(dir: number) {
    const cur = this.prefs.uiScale ?? 1;
    const i = SCALE_STEPS.indexOf(cur);
    const next = SCALE_STEPS[Math.max(0, Math.min(SCALE_STEPS.length - 1, (i < 0 ? 1 : i) + dir))]!;
    if (next === cur) return;
    this.prefs.uiScale = next;
    this.applyPrefs();
    this.scheduleSave();
  }

  private openSettings(anchor: HTMLElement) {
    const save = () => this.scheduleSave();
    openSettings(anchor, {
      theme: () => (this.prefs.theme === 'dark' ? 'dark' : 'light'),
      onTheme: (m) => {
        this.prefs.theme = m;
        this.applyPrefs();
        save();
      },
      scale: () => this.prefs.uiScale ?? 1,
      onScale: (sc) => {
        this.prefs.uiScale = sc;
        this.applyPrefs();
        save();
      },
      storage: async () => ({ doc: this.adapter.docBytes(), blobs: await blobTotalSize() }),
      lang: () => this.prefs.lang ?? 'en',
      // Module-level label tables are captured at boot; switching
      // languages reloads the shell after the prefs flush.
      onLang: (l: Lang) => {
        this.prefs.lang = l;
        // Storage key keeps the planboard name for data continuity.
        localStorage.setItem('planboard:lang', l);
        this.scheduleSave();
        void this.flush().then(() => location.reload());
      },
      browserLang: () => this.prefs.browserLang ?? true,
      onBrowserLang: (v) => {
        this.prefs.browserLang = v;
        this.applyPrefs();
        save();
      },
      currency: () => this.prefs.currency ?? ('USD' as Currency),
      onCurrency: (c) => {
        this.prefs.currency = c;
        this.applyPrefs();
        save();
      },
      flag: (k) => this.prefs[k] === true,
      onFlag: (k, v) => {
        this.prefs[k] = v;
        save();
        this.render();
      },
      guideAlpha: () => this.prefs.guideAlpha ?? 0,
      onGuideAlpha: (v) => {
        this.prefs.guideAlpha = v;
        save();
        this.render();
      },
      onTemplates: () => {
        if (!this.boardId) return;
        const boardId = this.boardId;
        openNewBoardPicker(anchor, {
          builtins: () => builtinTemplates(),
          customs: () => Object.values(this.doc.templates).sort((a, b) => b.createdAt - a.createdAt),
          onPick: (tpl) => this.placeBoard(boardId, this.viewCenter(), tpl),
          onRename: (id, name) => this.store.dispatch({ type: 'template.patch', id, patch: { name } }),
          onDelete: (id) => {
            const tpl = this.doc.templates[id];
            if (tpl) this.store.dispatch({ type: 'template.delete', tpl });
          },
        });
      },
      railItems: () => {
        const order = this.prefs.railOrder ?? CREATE_ITEMS.map((i) => i.key);
        const hidden = new Set(this.prefs.railHidden ?? []);
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
        const order = (this.prefs.railOrder ?? CREATE_ITEMS.map((i) => i.key)).slice();
        const i = order.indexOf(key);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j]!, order[i]!];
        this.prefs.railOrder = order;
        save();
        this.render();
      },
      onRailHide: (key, hidden) => {
        const set = new Set(this.prefs.railHidden ?? []);
        if (hidden) set.add(key);
        else set.delete(key);
        this.prefs.railHidden = [...set];
        save();
        this.render();
      },
      onRailReset: () => {
        delete this.prefs.railOrder;
        delete this.prefs.railHidden;
        save();
        this.render();
      },
    });
  }

  // First run only: one quiet dismissible hint, then never again.
  welcomeHint() {
    if (this.prefs.welcomed) return;
    hint(t('welcomeToast'), () => {
      this.prefs.welcomed = true;
      this.scheduleSave();
    });
  }

  // --- persistence ---

  scheduleSave() {
    if (this.saveState !== 'saving') {
      this.saveState = 'saving';
      this.topbar.setSaveState('saving');
    }
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DEBOUNCE);
  }

  private async saveNow() {
    const board = this.board();
    if (board) board.position = this.vp.snapshot();
    try {
      await this.adapter.save({ version: 1, doc: this.doc, savedAt: Date.now(), prefs: this.prefs });
    } catch {
      // Keep 'saving': the chip stays honest and flush() retries on
      // pagehide instead of the rejection going unhandled.
      return;
    }
    this.saveState = 'saved';
    this.topbar.setSaveState('saved');
  }

  async flush() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveState === 'saving') await this.saveNow();
  }
}
