import type { Store } from './state/store';
import { boardRefOf, commentDoc, createAnnotation, createColumn, createComment, createDocument, createEmbed, createHeading, createLine, createLink, createNote, createSketch, createSwatch, createTable, createTodo, documentDoc, headingDoc, imageDoc, lineDoc, linkDoc, sketchDoc, uid, GRID, IMAGE_W, UNSORTED, type Doc, type Element, type ElementType, type ID, type EmbedKind, type LineEnd, type PresentOpts } from './state/schema';
import type { Action, ElementPatch } from './state/actions';
import { getClipboard, setClipboard } from './state/clipboard';
import type { DocStorage } from './persist/storage';
import { blobTotalSize, clearBlobs, putBlob } from './persist/blobs';
import { ingestFiles, ingestPaste, prepareImage, type IngestApi } from './ui/files';
import { hostOf } from './ui/embeds';
import { Viewport, type Rect } from './canvas/viewport';
import { Renderer, type DraftLine, type Guide, type SceneLine } from './canvas/renderer';
import { CardsLayer } from './cards/layer';
import { openThreadPopup } from './cards/comment';
import { Topbar, type Crumb } from './ui/topbar';
import { Rail } from './ui/rail';
import { attachPointer } from './canvas/input';
import { attachShortcuts } from './ui/shortcuts';
import { normRect, pointInRect, rectsIntersect, unionRect } from './canvas/hit';
import { hitLines, midpoint, resolveLine, type LineHit } from './canvas/lines';
import { t } from './strings';
import { choice, hint, toast } from './ui/toast';
import { ChipsLayer } from './ui/chips';
import { CommentPins } from './ui/pins';
import { AnnotationLayer } from './ui/annotations';
import { openDocumentEditor } from './editor/doceditor';
import { openBoardDraw, openSketchEditor } from './editor/draweditors';
import { imgModeFromHash, imgModeParam, openImageEditor, type ImgEditorHandle, type ImgMode } from './editor/imgeditor';
import { canvasBlob, cropImage, loadBitmap } from './canvas/imgops';
import { openShortcutsPanel } from './ui/shortcutpanel';
import { openCapturePopup } from './ui/capture';
import { setFormatting } from './ui/locale';
import type { Currency, Lang } from './persist/storage';
import { CREATE_ITEMS } from './ui/rail';
import { openViewMenu } from './ui/toolpopups';
import { closeBoardPopup, closeToolPopup } from './ui/popup';
import { remapElements } from './state/clone';
import { builtinTemplates } from './state/templates';
import { openNewBoardPicker } from './ui/newboard';
import { openSettings, SCALE_STEPS } from './ui/settings';
import { isDark, setTheme, setUiScale } from './ui/theme';
import type { Prefs } from './persist/storage';
import { BoardExport } from './app/export';
import { Editing } from './app/editing';
import { RailTools } from './app/tools';
import { Panels } from './app/panels';
import { Gestures } from './app/gestures';
const SAVE_DEBOUNCE = 700;
const DRAG_SLOP = 3;


export class App {

  readonly exporter = new BoardExport(this);
  readonly editing = new Editing(this);
  readonly tools = new RailTools(this);
  readonly panels = new Panels(this);
  readonly gestures = new Gestures(this);

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

  guides: Guide[] = [];

  private saveTimer: number | null = null;

  private saveState: 'saved' | 'saving' = 'saved';

  private saveKind: 0 | 1 | 2 = 0;

  private renderQueued = false;

  private lastIz = 1;

  private wasDimming = false;

  private draft: DraftLine | null = null;

  private endDraft: { id: ID; which: 'from' | 'to'; x: number; y: number } | null = null;

  private editingLabelId: ID | null = null;

  private connectHandle: HTMLElement;

  labelHost: HTMLElement;

  private labelPills = new Map<ID, HTMLElement>();

  rail: Rail;

  private chips: ChipsLayer;

  pins: CommentPins;

  anno: AnnotationLayer;

  private overlay: { close(): void } | null = null;

  private overlayId: ID | null = null;

  private imgEditor: ImgEditorHandle | null = null;

  private boardDraw: { close(): void } | null = null;

  filterIds = new Set<ID>();

  pointer: { x: number; y: number } | null = null;

  presenting = false;

  prefs: Prefs = {};


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

    this.layer = new CardsLayer(
      store.doc,
      this.vp,
      {
        onTextInput: (id, text, html) => this.editing.onTextInput(id, text, html),
        onContent: (id, content) => this.editing.onContent(id, content),
        onMeasure: () => this.requestRender(),
        onResizeHandle: (id, e) => this.gestures.startResize(id, e),
        onEditEnd: () => this.editing.endEdit(),
        onLinkPopup: (id) => this.editing.openLinkPopupFor(id),
        onEditField: (id, field) => this.editing.beginEdit(id, undefined, field),
        onCellFocus: () => this.requestRender(),
      },
      () => this.store.rev,
    );
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
      onUnsorted: () => this.panels.openUnsorted(),
      onView: (anchor) => this.openViewMenu(anchor),
      onExport: (anchor) => this.exporter.openExportMenu(anchor),
      onSettings: (anchor) => this.openSettings(anchor),
      onCrumbIcon: (id, anchor) => this.panels.iconPickerFor(id, anchor),
      onCrumbBoards: () => this.panels.openBoards(),
      onUndo: () => {
        if (!this.lockedView()) this.store.undo();
      },
      onRedo: () => {
        if (!this.lockedView()) this.store.redo();
      },
    });
    this.rail = new Rail(root, {
      onDrop: (type, at, kind) => this.createFromRail(type, at, kind),
      onTool: (id, anchor) => this.tools.onTool(id, anchor),
      onAddImage: () => this.pickFiles('image/*'),
      onUpload: () => this.pickFiles('*/*'),
      onDraw: () => this.enterDrawMode(),
      onCapture: (anchor) => this.openCapture(anchor),
      onTrash: () => this.onRailTrash(),
      onBoardColor: (hex) => {
        if (this.boardId && !this.lockedView()) {
          this.tools.colorBurst(() =>
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

    document.addEventListener('selectionchange', () => this.editing.refreshEditGate());

    this.vp.onchange = () => {
      // Popups anchored to board space would float detached from their
      // anchor once the viewport moves; chrome-anchored ones stay.
      closeBoardPopup();
      this.applyTransform();
      this.schedulePosSave();
      this.requestRender();
    };
    this.store.onChange((c) => {
      for (const id of c.deleted) {
        this.sel.delete(id);
        // Ending the session is what closes the undo group; dropping
        // editingId alone would leak it and swallow history.
        if (this.editingId === id) this.editing.endEdit();
      }
      this.scheduleSave();
      this.requestRender();
    });

    attachPointer(vpEl, this);
    attachShortcuts(this);

    window.addEventListener('resize', () => this.layout());
    window.addEventListener('online', () => this.requestRender());
    window.addEventListener('offline', () => this.requestRender());
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
    this.editing.endEdit();
    this.draft = null;
    this.endDraft = null;
    if (this.editingLabelId) this.commitLabelEdit(this.editingLabelId);
    const prev = this.board();
    if (prev) {
      prev.position = this.vp.snapshot();
      this.adapter.saveBoardPos(prev.id, prev.position);
    }
    this.panels.closePanel();
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
      this.requestRender();
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
      this.panels.applyRouteFilter();
      return;
    }
    this.panels.applyRouteFilter();
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
    this.editing.endEdit();
    this.panels.closePanel();
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
        comment: (anchor) => this.tools.addCommentTo(el.id, anchor),
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
    this.requestRender();
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
    this.editing.endEdit();
    this.panels.closePanel();
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
    this.requestRender();
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
    this.editing.endEdit();
    if (this.editingLabelId) this.commitLabelEdit(this.editingLabelId);
    this.panels.closePanel();
    closeToolPopup();
    this.presenting = true;
    this.applyPresentClasses();
    this.requestRender();
  }


  exitPresent() {
    if (!this.presenting) return;
    this.presenting = false;
    this.applyPresentClasses();
    this.requestRender();
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
      presentOpts: () => this.board()?.presentOpts ?? {},
      onToggle: (key) => this.togglePresentOpt(key),
    });
  }


  applyTransform() {
    this.docEl.style.transform = `translate(${this.vp.x}px, ${this.vp.y}px) scale(${this.vp.z})`;
    // --iz restyles every counter-scaled node; only push it when the
    // inverse zoom moved enough to see (>2%), so zoom ticks stay cheap.
    const iz = 1 / this.vp.z;
    if (Math.abs(iz - this.lastIz) / this.lastIz > 0.02) {
      this.lastIz = iz;
      this.docEl.style.setProperty('--iz', String(iz));
    }
    this.topbar.setZoom(this.vp.z);
  }


  // Coalesces render() to one per frame: pointermove/wheel/keystroke
  // storms all land in a single DOM sync. render() stays public for
  // callers that need synchronous layout (beginEdit, route filters).
  requestRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
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
          !this.gestures.trashHover,
      )
      .map((e) => ({
        rect: this.layer.rectOf(e),
        // .card / .card.column / .card.board-card radii, so the selection
        // ring hugs the card's actual corner.
        radius: e.type === 'column' || e.type === 'board' ? 10 : 8,
      }));
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
    // The class-toggle pass only matters while presenting (focus dim)
    // or while a search filter is lit; run it then, plus once on the
    // way out to strip stale classes.
    const dimming = this.presenting || this.filterIds.size > 0;
    if (dimming || this.wasDimming) {
      for (const node of this.docEl.querySelectorAll<HTMLElement>(
        '.card, .chip-row, .comment-pin, .line-label, svg.anno',
      )) {
        node.classList.toggle('present-dim', !!node.dataset.id && this.dims(node.dataset.id));
        node.classList.toggle('filter-hit', !node.dataset.id || this.filterIds.has(node.dataset.id));
      }
    }
    this.wasDimming = dimming;
    this.docEl.classList.toggle('filtering', this.filterIds.size > 0);
    this.topbar.setUndoArrows(this.prefs.undoArrows !== false, this.store.canUndo, this.store.canRedo);
    this.rail.setPalette(this.prefs.railOrder, this.prefs.railHidden);
    this.rail.sync(this.selectedEls(), this.editing.editingEl());
    this.rail.setBoardColor(board?.color);
    this.editing.refreshEditGate();
    this.topbar.setCrumbs(this.crumbs());
    this.topbar.setUnsorted(this.unsortedCount());
    this.panels.renderPanel();
  }


  selectedEls(): Element[] {
    return [...this.sel].map((id) => this.doc.elements[id]).filter((e): e is Element => !!e);
  }


  movableCards(): Element[] {
    return this.selectedEls().filter(
      (e) => e.type !== 'line' && e.parentId === null && !(e.type === 'comment' && e.anchorId !== undefined),
    );
  }


  private unsortedCount(): number {
    return this.layer.members(UNSORTED).length;
  }


  // Cards the chips overlay can sit under: canvas cards + column members
  // on this board, minus anchored comments (those render as pins).
  // all=true skips the viewport cull for the export snapshot (pass the
  // staging layer so member rects come from its mounted views).
  chipTargets(all = false, layer = this.layer): { el: Element; rect: Rect; dim?: boolean }[] {
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
        for (const m of layer.members(el.id)) {
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


  pinItems(layer = this.layer): {
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


  syncPins() {
    this.pins.sync(this.pinItems());
  }


  private onPinClick(id: ID, pinEl: HTMLElement) {
    this.editing.endEdit();
    this.selectOnly(id);
    this.openCommentThread(id, pinEl);
  }


  annoItems() {
    return this.layer
      .elements()
      .filter((e) => e.type === 'annotation')
      .map((el) => ({ el, selected: this.sel.has(el.id), dim: this.dims(el.id) }));
  }


  syncAnno() {
    // Seat each svg before the lowest card above it so ink honours el.z;
    // the host fallback paints above all cards (topmost annotation).
    const els = this.layer.elements();
    this.anno.sync(this.annoItems(), (el) => {
      // els is z-ascending: binary-search the first element above el.z,
      // then scan up for the first mounted card.
      let lo = 0;
      let hi = els.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (els[mid]!.z <= el.z) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < els.length; i++) {
        const e = els[i]!;
        if (e.type === 'line' || e.type === 'annotation') continue;
        if (e.type === 'comment' && e.anchorId !== undefined) continue;
        const v = this.layer.view(e.id);
        if (v) return v.node;
      }
      return null;
    });
  }


  private onAnnoPick(id: ID, e: PointerEvent) {
    this.editing.endEdit();
    if (e.shiftKey) this.toggleSelect(id);
    else this.selectOnly(id);
  }


  openCommentThread(id: ID, anchor: HTMLElement | DOMRect) {
    const el = this.doc.elements[id];
    if (el?.type !== 'comment') return;
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
    const pop = openThreadPopup(anchor, items, {
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
      onDelete: (iid) => {
        if (this.lockedView()) return;
        const c = commentDoc(this.doc.elements[id]!);
        if (!c) return;
        this.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { comment: { items: c.items.filter((i) => i.id !== iid) } } },
        });
      },
    });
    // Anchored comments with no items would linger as blank pins; when
    // the popup closes empty, the element goes with it.
    const close = pop.close.bind(pop);
    pop.close = () => {
      close();
      const el = this.doc.elements[id];
      if (el?.anchorId !== undefined && !items().length) {
        this.store.dispatch({ type: 'element.delete', el });
      }
    };
  }


  resolvedLines(): SceneLine[] {
    const out: SceneLine[] = [];
    const rectOf = (el: Element) => this.layer.rectOf(el);
    for (const el of this.layer.lines()) {
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
    this.requestRender();
  }


  setGuides(g: Guide[]) {
    this.guides = g;
    this.requestRender();
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
    // The flat view map resolves member views directly.
    return this.layer.view(id)?.node ?? null;
  }


  // Whether a card covers a board point. Lines/labels/handles use it to
  // hide affordances whose anchor is occluded (they draw under or over
  // the card layer). `excludeId`'s own ancestors don't count as cover.
  private coveredByCard(x: number, y: number, excludeId?: ID): boolean {
    // Only mounted cards can occlude on-screen: unmounted ones are
    // off-canvas or nested inside a column (which covers them anyway).
    for (const v of this.layer.mounted()) {
      const e = this.doc.elements[v.id];
      if (!e || e.id === excludeId) continue;
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


  private onRailTrash() {
    if (this.editingId) this.deleteSelection();
    else this.panels.openTrash();
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
          this.editing.endEdit();
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
        // dataset.shown skips the innerText layout read per pill.
        if (pill.dataset.shown !== c.label) {
          pill.dataset.shown = c.label;
          pill.innerText = c.label;
        }
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
    if (el?.type !== 'line') return;
    this.editing.endEdit();
    this.selectOnly(id);
    this.editingLabelId = id;
    this.requestRender();
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
    this.requestRender();
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
      this.requestRender();
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
      this.requestRender();
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
      this.requestRender();
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
    this.requestRender();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const p = this.boardPoint(ev);
      this.draft = { x1: from.x, y1: from.y, x2: p.x, y2: p.y };
      const t = this.cardAtPoint(ev.clientX, ev.clientY);
      this.setConnectHint(t !== sourceId ? t : null);
      this.requestRender();
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
      this.requestRender();
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
      this.requestRender();
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
    this.editing.beginEdit(id, { x: e.clientX, y: e.clientY }, el.type === 'table' ? 'cell-edit' : undefined);
  }


  // --- selection ---

  selectOnly(id: ID) {
    if (this.sel.size === 1 && this.sel.has(id) && !this.filterIds.size) return;
    this.filterIds.clear();
    this.sel = new Set([id]);
    this.requestRender();
  }


  toggleSelect(id: ID) {
    this.filterIds.clear();
    if (this.sel.has(id)) this.sel.delete(id);
    else this.sel.add(id);
    this.requestRender();
  }


  setSelection(ids: Iterable<ID>) {
    this.filterIds.clear();
    this.sel = new Set(ids);
    this.requestRender();
  }


  clearSelection() {
    if (!this.sel.size && !this.filterIds.size) return;
    this.filterIds.clear();
    this.sel.clear();
    this.requestRender();
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

  beginEdit(id: ID, pos?: { x: number; y: number }, field?: string) {
    this.editing.beginEdit(id, pos, field);
  }

  endEdit() {
    this.editing.endEdit();
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
  stampBoardColor(el: Element) {
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
    this.editing.beginEdit(el.id, pos);
  }


  createFromRail(type: ElementType, at: { clientX: number; clientY: number } | null, kind?: EmbedKind) {
    const boardId = this.boardId;
    if (!boardId || this.lockedView()) return;
    const pt = at ? this.boardPoint(at) : this.viewCenter();
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    // A real drop onto a column files the new card as a member; clicks
    // that spawn at viewCenter always land on the canvas.
    const parentId = at && type !== 'line' ? this.columnAt(pt) : null;
    if (type === 'board') {
      const anchor = at ? new DOMRect(at.clientX, at.clientY, 0, 0) : new DOMRect(this.vp.vw / 2, this.vp.vh / 2, 0, 0);
      openNewBoardPicker(anchor, {
        builtins: builtinTemplates,
        customs: () => Object.values(this.doc.templates).sort((a, b) => b.createdAt - a.createdAt),
        onPick: (tpl) => this.panels.placeBoard(boardId, pt, tpl, parentId),
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
      el.parentId = parentId;
      this.stampBoardColor(el);
      this.store.dispatch({ type: 'element.create', el });
      this.setSelection([el.id]);
      // Fresh link/embed cards open on the paste-a-link input.
      this.editing.beginEdit(el.id, undefined, 'url');
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
    el.parentId = parentId;
    this.stampBoardColor(el);
    this.store.dispatch({ type: 'element.create', el });
    this.setSelection([el.id]);
  }


  chainCreate() {
    const from = this.editingId ? this.doc.elements[this.editingId] : undefined;
    this.editing.endEdit();
    if (!from) return;
    const r = this.layer.rectOf(from);
    this.createNoteAt(r.x, r.y + r.h + 40, undefined, from.parentId);
  }


  deleteSelection() {
    if (!this.sel.size || this.lockedView()) return;
    this.editing.endEdit();
    closeToolPopup();
    const actions: Action[] = [];
    const deleting = new Set<ID>();
    for (const id of this.sel) {
      const el = this.doc.elements[id];
      if (!el) continue;
      if (el.type === 'column') {
        this.layer.members(el.id).forEach((m, i) => {
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
  detachLineActions(deleting: Set<ID>): Action[] {
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
  retargetAttachActions(fromId: ID, toId: ID): Action[] {
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
  detachCommentActions(deleting: Set<ID>): Action[] {
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


  cascadeActions(boardId: ID): Action[] {
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
    this.editing.offerSyncCopies(
      src.map((s) => ({ src: s, clone: this.doc.elements[idMap.get(s.id)!]! })).filter((p) => !!p.clone),
    );
  }


  // --- clipboard + cloning ---

  private copySet(): Element[] {
    const out = new Map<ID, Element>();
    for (const el of this.selectedEls()) {
      out.set(el.id, el);
      if (el.type === 'column') for (const m of this.layer.members(el.id)) out.set(m.id, m);
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
    this.editing.offerSyncCopies(
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
      if (el.type === 'column') for (const m of this.layer.members(id)) src.set(m.id, m);
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

  dragMove(ids: ID[], origins: Map<ID, { x: number; y: number }>, start: { x: number; y: number }, ev: PointerEvent) {
    this.gestures.dragMove(ids, origins, start, ev);
  }


  hasAncestor(id: ID, ancestor: ID): boolean {
    let cur = this.doc.elements[id];
    let guard = 0;
    while (cur?.parentId && guard++ < 64) {
      if (cur.parentId === ancestor) return true;
      cur = this.doc.elements[cur.parentId];
    }
    return false;
  }

  endDrag(ev?: PointerEvent) {
    this.gestures.endDrag(ev);
  }

  abortDrag() {
    this.gestures.abortDrag();
  }

  startPan(e: PointerEvent) {
    this.gestures.startPan(e);
  }


  // Native color wells fire 'input' continuously; a short-lived undo
  // group collapses a whole scrub into one history entry.
  colorTimer = 0;

  zOrder(dir: 'front' | 'back') {
    this.tools.zOrder(dir);
  }


  // --- file + media ingestion ---

  private viewCenter() {
    return this.vp.toBoard(this.vp.vw / 2, this.vp.vh / 2);
  }


  private pastePoint() {
    return this.pointer ?? this.viewCenter();
  }


  // Topmost canvas card under a board point, if it is a column. File and
  // rail drops onto a column join it; same rule as updateDropTarget, so a
  // column covered by another card cannot be the target.
  private columnAt(pt: { x: number; y: number }): ID | null {
    let top: Element | null = null;
    for (const e of this.layer.elements()) {
      if (e.type === 'line' || e.type === 'annotation') continue;
      if (e.type === 'comment' && e.anchorId !== undefined) continue;
      if (!pointInRect(pt.x, pt.y, this.layer.rectOf(e))) continue;
      if (!top || e.z > top.z) top = e;
    }
    return top?.type === 'column' ? top.id : null;
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
  async replaceImage(el: Element) {
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
  async cropImageToGrid(el: Element) {
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
    this.editing.enrichLink(el.id, url);
  }

  fileToUnsorted() {
    this.panels.fileToUnsorted();
  }

  openSearch() {
    this.panels.openSearch();
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
    this.requestRender();
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
      flag: (k) => (k === 'undoArrows' ? this.prefs[k] !== false : this.prefs[k] === true),
      onFlag: (k, v) => {
        this.prefs[k] = v;
        save();
        this.requestRender();
      },
      guideAlpha: () => this.prefs.guideAlpha ?? 0,
      onGuideAlpha: (v) => {
        this.prefs.guideAlpha = v;
        save();
        this.requestRender();
      },
      onTemplates: () => {
        if (!this.boardId) return;
        const boardId = this.boardId;
        openNewBoardPicker(anchor, {
          builtins: () => builtinTemplates(),
          customs: () => Object.values(this.doc.templates).sort((a, b) => b.createdAt - a.createdAt),
          onPick: (tpl) => this.panels.placeBoard(boardId, this.viewCenter(), tpl),
          onRename: (id, name) => this.store.dispatch({ type: 'template.patch', id, patch: { name } }),
          onDelete: (id) => {
            const tpl = this.doc.templates[id];
            if (tpl) this.store.dispatch({ type: 'template.delete', tpl });
          },
        });
      },
      onReset: () => choice(t('resetAllQ'), t('resetAllAct'), () => void this.resetAll()),
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
        this.requestRender();
      },
      onRailHide: (key, hidden) => {
        const set = new Set(this.prefs.railHidden ?? []);
        if (hidden) set.add(key);
        else set.delete(key);
        this.prefs.railHidden = [...set];
        save();
        this.requestRender();
      },
      onRailReset: () => {
        delete this.prefs.railOrder;
        delete this.prefs.railHidden;
        save();
        this.requestRender();
      },
    });
  }


  // Settings "Reset everything": wipe doc storage, blobs and prefs,
  // then reload so the boot path re-seeds a fresh default doc.
  private async resetAll() {
    await this.flush();
    localStorage.removeItem('planboard:lang');
    await this.adapter.clear();
    await clearBlobs();
    location.reload();
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
    this.markSave(2);
  }


  // Viewport-only path: writes a small per-board position row instead
  // of serializing the whole doc.
  private schedulePosSave() {
    this.markSave(1);
  }


  private markSave(kind: 1 | 2) {
    if (kind > this.saveKind) this.saveKind = kind;
    if (this.saveState !== 'saving') {
      this.saveState = 'saving';
      this.topbar.setSaveState('saving');
    }
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DEBOUNCE);
  }


  private async saveNow() {
    const kind = this.saveKind;
    this.saveKind = 0;
    const board = this.board();
    if (board) board.position = this.vp.snapshot();
    try {
      if (kind === 1) {
        if (board) await this.adapter.saveBoardPos(board.id, board.position!);
      } else {
        await this.adapter.save({ version: 1, doc: this.doc, savedAt: Date.now(), prefs: this.prefs });
      }
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

