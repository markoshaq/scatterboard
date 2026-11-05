import type { Store } from './state/store';
import { boardRefOf, createAnnotation, createColumn, createComment, createDocument, createEmbed, createHeading, createLine, createLink, createNote, createSketch, createSwatch, createTable, createTodo, documentDoc, headingDoc, imageDoc, linkDoc, sketchDoc, uid, EDITOR_TYPES, GRID, IMAGE_W, UNSORTED, type Doc, type Element, type ElementType, type ID, type EmbedKind, type ImageDoc, type PresentOpts } from './state/schema';
import type { Action, ElementPatch } from './state/actions';
import { getClipboard, setClipboard } from './state/clipboard';
import type { DocStorage, Lang, Prefs } from './persist/storage';
import { blobTotalSize, clearBlobs, putBlob } from './persist/blobs';
import { ingestFiles, ingestPaste, prepareImage, type IngestApi } from './ingest/files';
import { scrubContent } from './ui/sanitize';
import { hostOf, urlTitle } from './net/embeds';
import { Viewport } from './canvas/viewport';
import { Renderer, type DraftLine, type Guide, type SceneLine } from './canvas/renderer';
import { CardsLayer } from './cards/layer';
import { cardAriaLabel } from './cards/factory';
import { Topbar, type Crumb } from './ui/topbar';
import { Rail } from './ui/rail';
import { attachPointer } from './canvas/input';
import { attachShortcuts } from './ui/shortcuts';
import { normRect, pointInRect, rectsIntersect, unionRect } from './canvas/hit';
import { hitLines, resolveLine, type LineHit } from './canvas/lines';
import { lang as activeLang, t } from './strings';
import { choice, hint, toast } from './ui/toast';
import type { EditorHandle } from './editor/doceditor';
import { imgModeFromHash, imgModeParam, type ImgMode } from './editor/imgmode';
import type { ImgEditorHandle } from './editor/imgeditor';
import { openShortcutsPanel } from './ui/shortcutpanel';
import { openCapturePopup } from './ui/capture';
import { setFormatting } from './locale';
import { CREATE_ITEMS } from './ui/rail';
import { openHelpMenu, openMobileMenu, openViewMenu } from './ui/toolpopups';
import { installAvailable, runInstall } from './ui/install';
import { DROP_EXCLUDE, mobileShell } from './ui/util';
import { closeBoardPopup, closeToolPopup } from './ui/popup';
import { remapElements } from './state/clone';
import { builtinTemplates } from './state/templates';
import { openNewBoardPicker } from './ui/newboard';
import { openAboutPopup, openAgentPopup, openSettings, SCALE_STEPS } from './ui/settings';
import { isDark, setTheme, setUiScale, systemDark } from './ui/theme';
import { BoardExport } from './app/export';
import { Editing } from './app/editing';
import { RailTools } from './app/tools';
import { Panels } from './app/panels';
import { Gestures } from './app/gestures';
import { Overlays } from './app/overlays';
import { Deletion } from './app/deletion';
import { Comments } from './app/comments';
const SAVE_DEBOUNCE = 700;


export class App {

  readonly exporter = new BoardExport(this);
  // Agent surface: blob writes go through the same IndexedDB store as
  // drop/paste ingest.
  readonly blobStore = { put: putBlob };
  readonly editing = new Editing(this);
  readonly tools = new RailTools(this);
  readonly panels = new Panels(this);
  readonly gestures = new Gestures(this);
  readonly deletion = new Deletion(this);
  readonly comments = new Comments(this);

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


  docEl: HTMLElement;

  private canvasEl: HTMLCanvasElement;

  private chromeEl: HTMLCanvasElement;

  private marquee: { x1: number; y1: number; x2: number; y2: number } | null = null;

  guides: Guide[] = [];

  private saveTimer: number | null = null;

  private saveState: 'saved' | 'saving' = 'saved';

  private saveKind: 0 | 1 | 2 = 0;

  private saveChip = false;

  private renderQueued = false;

  // Elements touched by store changes since the last layer.sync; the
  // layer skips update() on untouched cards. refreshCards forces a
  // full pass for non-element inputs (theme, board meta, locale).
  private dirtyEls = new Set<ID>();

  private refreshCards = true;

  private lastIz = 1;

  private wasDimming = false;

  private wasFiltering = false;

  draft: DraftLine | null = null;

  // Screen-space helpers outside .doc's transform: the empty-board
  // hint render() toggles, and a visually-hidden live region that
  // announces where keyboard card nav lands.
  private emptyEl: HTMLElement;

  private liveEl: HTMLElement;

  endDraft: { id: ID; which: 'from' | 'to'; x: number; y: number } | null = null;

  readonly overlays: Overlays;

  rail: Rail;

  private overlay: { close(): void } | null = null;

  private overlayId: ID | null = null;

  private imgEditor: ImgEditorHandle | null = null;

  private boardDraw: { close(): void } | null = null;

  filterIds = new Set<ID>();

  pointer: { x: number; y: number } | null = null;

  presenting = false;

  prefs: Prefs = {};

  // Live bridge socket state, driven by the lazy agent client; read by
  // the settings status line.
  agentConnected = false;


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

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'board-empty';
    this.emptyEl.style.display = 'none';
    const beTitle = document.createElement('div');
    beTitle.className = 'be-title';
    const beHint = document.createElement('div');
    beHint.className = 'be-hint';
    const beActions = document.createElement('div');
    beActions.className = 'be-actions';
    const beNote = document.createElement('button');
    beNote.type = 'button';
    beNote.textContent = t('emptyAddNote');
    beNote.addEventListener('click', () => this.createFromRail('note', null));
    const beKeys = document.createElement('button');
    beKeys.type = 'button';
    beKeys.textContent = t('emptyShortcuts');
    beKeys.addEventListener('click', () => openShortcutsPanel());
    beActions.append(beNote, beKeys);
    this.emptyEl.append(beTitle, beHint, beActions);
    this.liveEl = document.createElement('div');
    this.liveEl.className = 'vh';
    this.liveEl.setAttribute('aria-live', 'polite');
    this.liveEl.setAttribute('aria-atomic', 'true');
    vpEl.append(this.emptyEl, this.liveEl);

    this.layer = new CardsLayer(
      store.doc,
      this.vp,
      {
        onTextInput: (id, text, html) => this.editing.onTextInput(id, text, html),
        onContent: (id, content) => this.editing.onContent(id, content),
        onPatch: (id, patch) => this.store.dispatch({ type: 'element.patch', id, patch }),
        onMeasure: () => this.requestRender(),
        onResizeHandle: (id, e) => this.gestures.startResize(id, e),
        onEditEnd: () => this.editing.endEdit(),
        onLinkPopup: (id) => this.editing.openLinkPopupFor(id),
        onEditField: (id, field) => this.editing.beginEdit(id, undefined, field),
        onCellFocus: () => this.requestRender(),
        editable: () => !this.lockedView(),
      },
      () => this.store.rev,
    );
    this.docEl.appendChild(this.layer.node);
    this.overlays = new Overlays(this);
    this.renderer = new Renderer(this.canvasEl, this.chromeEl, this.vp);
    const onUndo = () => {
      if (!this.lockedView()) this.store.undo();
    };
    const onRedo = () => {
      if (!this.lockedView()) this.store.redo();
    };
    this.topbar = new Topbar(root, {
      onZoomIn: () => this.vp.zoomStep(1),
      onZoomOut: () => this.vp.zoomStep(-1),
      onZoomReset: () => this.vp.reset(),
      onFit: () => this.fitView(),
      onNavigate: (id) => this.openBoard(id),
      onUnsorted: () => this.panels.openUnsorted(),
      onView: (anchor) => this.openViewMenu(anchor),
      onHelp: (anchor) => this.openHelp(anchor),
      onExport: (anchor) => this.exporter.openExportMenu(anchor),
      onSettings: (anchor) => this.openSettings(anchor),
      onAgent: (anchor) => this.openAgentMenu(anchor),
      onMore: (anchor) => this.openMobileMenu(anchor),
      onCrumbIcon: (id, anchor) => this.panels.iconPickerFor(id, anchor),
      onCrumbBoards: () => this.panels.openBoards(),
      onUndo,
      onRedo,
    });
    this.rail = new Rail(root, {
      onDrop: (type, at, kind) => this.createFromRail(type, at, kind),
      onDropHint: (ev, type) => this.paletteDropHint(ev, type),
      onTool: (id, anchor) => this.tools.onTool(id, anchor),
      onAddImage: () => this.pickFiles('image/*'),
      onUpload: () => this.pickFiles('*/*'),
      onDraw: () => this.enterDrawMode(),
      onCapture: (anchor) => this.openCapture(anchor),
      onUndo,
      onRedo,
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
      this.schedulePosSave();
      this.requestRender();
    };
    this.store.onChange((c) => {
      if (c.deleted.size && !c.replay) this.layer.markExits(c.deleted);
      for (const id of c.elements) this.dirtyEls.add(id);
      for (const id of c.deleted) {
        this.dirtyEls.add(id);
        this.sel.delete(id);
        if (this.prefs.commentSeen?.[id] !== undefined) {
          delete this.prefs.commentSeen[id];
          this.scheduleSave();
        }
        // Ending the session is what closes the undo group; dropping
        // editingId alone would leak it and swallow history.
        if (this.editingId === id) this.editing.endEdit();
      }
      // Board patches (title/icon/color) are read by card views but
      // carry no element id, so they force a full view pass.
      if (c.boards.size) this.refreshCards = true;
      this.scheduleSave();
      this.requestRender();
    });

    attachPointer(vpEl, this);
    attachShortcuts(this);

    // Keyboard focus on a card selects it; Tab-ing out of an edit into
    // another card commits it, matching the pointer path.
    document.addEventListener('focusin', (e) => {
      const card = e.target instanceof HTMLElement ? e.target.closest('.card') : null;
      const id = card instanceof HTMLElement ? card.dataset.id : undefined;
      if (!id) return;
      if (this.editingId && this.editingId !== id) this.endEdit();
      if (!this.editingId && !this.sel.has(id)) this.selectOnly(id);
    });

    // Casual print path: styles/print.css hides the chrome while we
    // fit the board so the page captures everything, then restore the
    // view the user had.
    let printSnap: { x: number; y: number; z: number } | null = null;
    window.addEventListener('beforeprint', () => {
      printSnap = this.vp.snapshot();
      const r = unionRect(this.layer.elements().map((e) => this.layer.rectOf(e)));
      const t = this.vp.fitTarget(r, { l: 20, t: 20, r: 20, b: 20 });
      this.vp.snapTo(t ?? this.vp.resetTarget());
    });
    window.addEventListener('afterprint', () => {
      if (!printSnap) return;
      this.vp.restore(printSnap);
      printSnap = null;
    });
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('online', () => {
      this.refreshCards = true;
      this.requestRender();
    });
    window.addEventListener('offline', () => {
      this.refreshCards = true;
      this.requestRender();
    });
    // Follow OS theme changes while the theme pref stays on System.
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!this.prefs.theme) this.applyPrefs();
      });
    } catch {}
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


  // keepPanel: the boards panel navigates without closing itself.
  openBoard(id: ID, filterQuery?: string, keepHash = false, keepPanel = false) {
    const board = this.doc.boards[id];
    if (!board) return;
    const sameBoard = id === this.boardId;
    this.exitPresent();
    this.editing.endEdit();
    this.draft = null;
    this.endDraft = null;
    this.overlays.commitLabelEdit();
    const prev = this.board();
    if (prev) {
      prev.position = this.vp.snapshot();
      this.adapter.saveBoardPos(prev.id, prev.position);
    }
    if (!keepPanel) this.panels.closePanel();
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
    // The swap repaints in one frame; a quick fade on .doc keeps the
    // jump between boards from reading as a hard cut.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.docEl.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 170, easing: 'ease-out' });
    }
  }


  // Hash routing entry point (boot + hashchange): #/e/<id> mounts the
  // element's dedicated editor over its board; #/b/<id> opens a board.
  applyRoute() {
    const em = location.hash.match(/^#\/e\/([^/?#]+)/);
    if (em) {
      const el = this.doc.elements[em[1]!];
      if (el && EDITOR_TYPES.has(el.type)) {
        void this.openElementEditor(el);
        return;
      }
    }
    this.closeElementEditor();
    // A stale #/e route (element gone or a type with no editor) gets
    // rewritten to the board so Back/Forward semantics stay sane.
    if (em && this.boardId) history.replaceState(null, '', `#/b/${this.boardId}`);
    const bm = location.hash.match(/^#\/b\/([^/?#]+)/);
    if (bm && bm[1] !== this.boardId) {
      this.openBoard(bm[1]!);
      this.panels.applyRouteFilter();
      return;
    }
    this.panels.applyRouteFilter();
  }


  private editorSeq = 0;

  private async openElementEditor(el: Element) {
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
    // Editor modules are lazy chunks; the seq guard drops a stale open
    // if the route moved on while the chunk was loading.
    const seq = ++this.editorSeq;
    let handle: EditorHandle | null = null;
    if (el.type === 'document') {
      if (!documentDoc(el)) return;
      const { openDocumentEditor } = await import('./editor/doceditor');
      if (seq !== this.editorSeq) return;
      this.store.beginGroup();
      let ed: ReturnType<typeof openDocumentEditor>;
      try {
        ed = openDocumentEditor(el, {
          boards: () => Object.values(this.doc.boards).sort((a, b) => a.title.localeCompare(b.title)),
          boardUrl: (id) => this.boardUrl(id),
          doc: () => {
            const cur = this.doc.elements[el.id];
            return cur ? documentDoc(cur) : null;
          },
          patch: (doc) => {
            const cur = this.doc.elements[el.id];
            if (cur && documentDoc(cur)) {
              scrubContent(doc);
              this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { document: doc } } });
            }
          },
          comment: (anchor) => this.tools.addCommentTo(el.id, anchor),
          exit: () => this.exitEditor(el.boardId),
        });
      } catch (err) {
        // A mount throw must not leak the group: later dispatches
        // would be silently absorbed and undo would stop working.
        this.store.endGroup();
        throw err;
      }
      handle = {
        close: () => {
          // A throw inside ed.close() must not leak the undo group: a
          // stuck group silently swallows every later dispatch.
          try {
            ed.close();
          } finally {
            this.store.endGroup('edit');
          }
        },
      };
    } else if (el.type === 'sketch') {
      const { openSketchEditor } = await import('./editor/draweditors');
      if (seq !== this.editorSeq) return;
      handle = openSketchEditor(el, {
        ink: this.prefs.ink,
        patch: (doc) => {
          const cur = this.doc.elements[el.id];
          const cd = cur ? sketchDoc(cur) : null;
          if (cd && JSON.stringify(cd.strokes) !== JSON.stringify(doc.strokes)) {
            this.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { sketch: doc } } });
          }
        },
        exit: () => this.exitEditor(el.boardId),
      });
    } else if (el.type === 'image') {
      if (!imageDoc(el)) return;
      const { openImageEditor } = await import('./editor/imgeditor');
      if (seq !== this.editorSeq) return;
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
          const fq = location.hash.match(/[?&]filter_query=[^#]*/)?.[0] ?? '';
          history.replaceState(null, '', `#/e/${el.id}${imgModeParam(m)}${fq ? `&${fq.slice(1)}` : ''}`);
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
    const q = location.hash.match(/[?&]filter_query=[^&]*/)?.[0] ?? '';
    history.replaceState(null, '', `#/b/${boardId}${q ? `?${q.slice(1)}` : ''}`);
    this.applyRoute();
  }


  private closeElementEditor() {
    this.editorSeq++;
    this.imgEditor = null;
    this.overlay?.close();
    this.overlay = null;
    this.overlayId = null;
    closeToolPopup();
  }


  // Board draw mode (rail Draw / Shift+D): strokes land as one
  // annotation element. Esc saves, Discard backs out.
  async enterDrawMode() {
    if (this.boardDraw || this.overlay || !this.boardId || this.lockedView()) return;
    this.editing.endEdit();
    this.panels.closePanel();
    closeToolPopup();
    this.clearSelection();
    const { openBoardDraw } = await import('./editor/draweditors');
    // The lazy editor chunk may race a route change that opened an
    // editor or re-entered draw mode in the meantime.
    if (this.boardDraw || this.overlay) return;
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
    this.overlays.commitLabelEdit();
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


  // Agent shim: set presentation toggles explicitly (the View menu
  // toggles via togglePresentOpt). Same direct-mutation path.
  setPresentOpts(o: PresentOpts) {
    const board = this.board();
    if (!board) return;
    board.presentOpts = { ...board.presentOpts, ...o };
    this.scheduleSave();
    this.applyPresentClasses();
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
  dims(id: ID): boolean {
    return this.presenting && this.sel.size > 0 && !this.sel.has(id) && !!this.board()?.presentOpts?.focus;
  }


  // Phone topbar overflow: one button fans out to the popups that
  // collapse out of the bar on narrow screens.
  private openMobileMenu(anchor: HTMLElement) {
    openMobileMenu(anchor, {
      onFit: () => this.fitView(),
      onView: (a) => this.openViewMenu(a),
      onExport: (a) => this.exporter.openExportMenu(a),
      onAgent: (a) => this.openAgentMenu(a),
      onSettings: (a) => this.openSettings(a),
      onHelp: (a) => this.openHelp(a),
    });
  }


  private openViewMenu(anchor: HTMLElement) {
    if (!this.boardId) return;
    openViewMenu(anchor, {
      presentOpts: () => this.board()?.presentOpts ?? {},
      onToggle: (key) => this.togglePresentOpt(key),
      grid: () => this.board()?.grid ?? true,
      onToggleGrid: () => this.toggleGrid(),
      onPresent: () => this.enterPresent(),
      onFit: () => this.fitView(),
    });
  }


  applyTransform() {
    // Snap the translate to the device-pixel grid: a fractional pan
    // offset puts every 1px border and text stem across two pixels.
    const dpr = devicePixelRatio || 1;
    const sx = Math.round(this.vp.x * dpr) / dpr;
    const sy = Math.round(this.vp.y * dpr) / dpr;
    this.docEl.style.transform = `translate(${sx}px, ${sy}px) scale(${this.vp.z})`;
    // Semantic zoom threshold: below ~20% card faces collapse to blocks.
    this.docEl.classList.toggle('far', this.vp.z < 0.2);
    // --iz restyles every counter-scaled node; only push it when the
    // inverse zoom moved enough to see, so zoom ticks stay cheap.
    const iz = 1 / this.vp.z;
    if (Math.abs(iz - this.lastIz) / this.lastIz > 0.08) {
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
      // Viewport writes are coalesced into the frame too: a wheel storm
      // would otherwise restyle .doc far more often than it can paint.
      this.applyTransform();
      this.render();
    });
  }


  // Canvas-only scene push used by the light render path (marquee
  // drags): outlines and lines are cheap to recompute, everything
  // downstream of setScene stays untouched.
  private pushScene() {
    const board = this.board();
    const outlines = [...this.sel]
      .map((id) => this.doc.elements[id])
      .filter(
        (e): e is Element =>
          !!e &&
          e.type !== 'line' &&
          !(e.type === 'comment' && e.anchorId !== undefined) &&
          !this.gestures.trashHover &&
          // Mounted cards carry a DOM ring at their own z; the canvas
          // ring stays only for culled (unmounted) selections.
          !this.layer.view(e.id),
      )
      .map((e) => {
        const r = this.layer.rectOf(e);
        const lift = this.gestures.liftDelta(e.id);
        return {
          rect: lift ? { x: r.x + lift.dx, y: r.y + lift.dy, w: r.w, h: r.h } : r,
            // Card radius is unified at 10px; the ring hugs the corner.
          radius: 10,
        };
      });
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
    return lines;
  }

  renderScene() {
    this.pushScene();
  }

  render() {
    const board = this.board();
    const lines = this.pushScene();
    const dirty = this.refreshCards ? undefined : this.dirtyEls;
    this.dirtyEls = new Set();
    this.refreshCards = false;
    this.layer.sync(this.sel, this.editingId, this.lockedView(), dirty);
    this.overlays.sync(lines);
    // The class-toggle pass only matters while presenting (focus dim)
    // or while a search filter is lit; run it then, plus once on the
    // way out to strip stale classes. filter-hit writes only run while
    // a filter is active or just got stripped, so present-only frames
    // do one class write per node.
    const dimming = this.presenting || this.filterIds.size > 0;
    const filtering = this.filterIds.size > 0;
    if (dimming || this.wasDimming) {
      const stripFilter = this.wasFiltering && !filtering;
      for (const node of this.docEl.querySelectorAll<HTMLElement>(
        '.card, .chip-row, .comment-pin, .line-label, svg.anno',
      )) {
        node.classList.toggle('present-dim', !!node.dataset.id && this.dims(node.dataset.id));
        if (filtering || stripFilter) {
          node.classList.toggle('filter-hit', !node.dataset.id || this.filterIds.has(node.dataset.id));
        }
      }
    }
    this.wasDimming = dimming;
    this.wasFiltering = filtering;
    this.docEl.classList.toggle('filtering', this.filterIds.size > 0);
    this.topbar.setUndoArrows(this.prefs.undoArrows !== false, this.store.canUndo, this.store.canRedo);
    this.rail.setUndoArrows(this.prefs.undoArrows !== false, this.store.canUndo, this.store.canRedo);
    this.rail.setPalette(this.prefs.railOrder, this.prefs.railHidden);
    this.rail.sync(this.selectedEls(), this.editing.editingEl());
    this.rail.setBoardColor(board?.color);
    this.editing.refreshEditGate();
    this.topbar.setCrumbs(this.crumbs());
    this.topbar.setUnsorted(this.unsortedCount());
    this.panels.renderPanel();
    // A board with no visible cards gets a centered hint; the moment a
    // card lands (or presenting starts) it is gone again.
    const empty =
      !!board &&
      !this.presenting &&
      !this.layer
        .elements()
        .some((e) => e.type !== 'line' && e.type !== 'annotation' && !(e.type === 'comment' && e.anchorId !== undefined));
    this.emptyEl.style.display = empty ? '' : 'none';
    if (empty) {
      this.emptyEl.querySelector<HTMLElement>('.be-title')!.textContent = t('emptyBoardTitle');
      this.emptyEl.querySelector<HTMLElement>('.be-hint')!.textContent = t(mobileShell() ? 'emptyBoardHintMob' : 'emptyBoardHint');
    }
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


  private linesCache: { key: string; lines: SceneLine[] } | null = null;

  // Line resolution walks every line + its endpoint rects; pointerdown
  // hit-tests reuse the frame's result via this cache, invalidated by
  // doc rev, board, rect or gesture-state changes.
  resolvedLines(): SceneLine[] {
    const lift = this.gestures.liftMember();
    const ld = lift ? this.gestures.liftDelta(lift.memberId) : null;
    const d = this.endDraft;
    const key = [
      this.store.rev,
      this.boardId,
      this.layer.rectRev,
      this.presenting,
      this.board()?.presentOpts?.focus,
      this.sel.size ? [...this.sel].join(',') : '',
      d ? `${d.id}:${d.which}:${d.x},${d.y}` : '',
      lift && ld ? `${lift.memberId}:${ld.dx},${ld.dy}` : '',
    ].join('|');
    if (this.linesCache?.key === key) return this.linesCache.lines;
    const out: SceneLine[] = [];
    // Lifted members keep their arrows glued: endpoints resolve against
    // the lifted rect, same as chips and the selection outline.
    const rectOf = (el: Element) => {
      const r = this.layer.rectOf(el);
      const lift = this.gestures.liftDelta(el.id);
      return lift ? { x: r.x + lift.dx, y: r.y + lift.dy, w: r.w, h: r.h } : r;
    };
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
    this.linesCache = { key, lines: out };
    return out;
  }


  lineHit(pt: { x: number; y: number }): LineHit | null {
    return hitLines(this.resolvedLines(), this.sel, pt, this.vp.z);
  }


  setMarquee(m: { x1: number; y1: number; x2: number; y2: number } | null) {
    this.marquee = m;
    // Marquee is canvas-only state: repaint the scene directly instead
    // of running the full card/overlay pass per pointermove.
    this.renderScene();
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
    if (this.editingId || this.sel.size) this.deletion.deleteSelection();
    else this.panels.openTrash();
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
      // Carry filter_query through the editor route so exitEditor can
      // restore the board's filtered view.
      const q = location.hash.match(/[?&]filter_query=[^&]*/)?.[0] ?? '';
      location.hash = `#/e/${el.id}${q ? `?${q.slice(1)}` : ''}`;
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
    // setMarquee only repaints the canvas now; selection still wants
    // the full pass for card classes and the rail.
    this.requestRender();
  }

  beginEdit(id: ID, pos?: { x: number; y: number }, field?: string) {
    this.editing.beginEdit(id, pos, field);
  }

  endEdit() {
    this.editing.endEdit();
  }


  // Quick-capture: files the text as a note into this board's Unsorted.
  private openCapture(anchor: HTMLElement | DOMRect) {
    if (!this.boardId || this.lockedView()) return;
    openCapturePopup(anchor, (text) => this.fileCaptured(text));
  }

  // One capture path shared by the quick-capture popup and the OS
  // share target (manifest share_target boots with ?share=1).
  fileCaptured(text: string) {
    if (!this.boardId || this.lockedView()) return;
    const el = createNote(this.doc, this.boardId, 0, 0, text);
    el.parentId = UNSORTED;
    this.stampBoardColor(el);
    this.store.dispatch({ type: 'element.create', el });
    toast(t('qcSaved'), 'ok');
  }

  // Manifest shortcut entries (?capture=1 / ?newboard=1 at boot): no
  // real anchor exists yet, so the surfaces anchor to a screen point.
  openShortcutCapture() {
    this.openCapture(new DOMRect(innerWidth / 2, Math.max(60, innerHeight - 220), 0, 0));
  }

  openShortcutNewBoard() {
    this.panels.newProject(new DOMRect(innerWidth / 2, innerHeight * 0.35, 0, 0));
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


  // Rail-drop types that open straight into editing when the
  // autoEdit pref is on: every card with an obvious first text field.
  private static readonly AUTO_EDIT_TYPES = new Set<ElementType>([
    'note',
    'todo',
    'heading',
    'document',
    'comment',
    'table',
    'column',
  ]);

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
    // Text-first cards open straight into editing unless the pref is off.
    if (App.AUTO_EDIT_TYPES.has(type) && this.prefs.autoEdit !== false) this.editing.beginEdit(el.id);
  }


  chainCreate() {
    const from = this.editingId ? this.doc.elements[this.editingId] : undefined;
    this.editing.endEdit();
    if (!from) return;
    const r = this.layer.rectOf(from);
    this.createNoteAt(r.x, r.y + r.h + 40, undefined, from.parentId);
  }


  deleteSelection() {
    this.deletion.deleteSelection();
  }


  detachLineActions(deleting: Set<ID>) {
    return this.deletion.detachLineActions(deleting);
  }


  detachCommentActions(deleting: Set<ID>) {
    return this.deletion.detachCommentActions(deleting);
  }


  retargetAttachActions(fromId: ID, toId: ID) {
    return this.deletion.retargetAttachActions(fromId, toId);
  }


  cascadeActions(boardId: ID) {
    return this.deletion.cascadeActions(boardId);
  }


  startLineDrag(id: ID, e: PointerEvent) {
    this.gestures.startLineDrag(id, e);
  }


  startEndpointGesture(id: ID, which: 'from' | 'to', e: PointerEvent) {
    this.gestures.startEndpointGesture(id, which, e);
  }


  startConnect(sourceId: ID, e: PointerEvent) {
    this.gestures.startConnect(sourceId, e);
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
    // Members come along transitively: a column can sit inside a column.
    const collect = (el: Element) => {
      if (out.has(el.id)) return;
      out.set(el.id, el);
      if (el.type === 'column') for (const m of this.layer.members(el.id)) collect(m);
    };
    for (const el of this.selectedEls()) collect(el);
    return [...out.values()];
  }


  copySelection() {
    const set = this.copySet();
    if (set.length) setClipboard(set);
  }


  cutSelection() {
    if (this.lockedView()) return;
    this.copySelection();
    this.deletion.deleteSelection();
  }


  // Shared clone path for paste, Opt+drag and duplicate: new ids/z, column
  // members re-file to their cloned column, line endpoints re-attach only
  // when the card came along, comments drop a stale anchor.
  private cloneElements(els: Element[], dx: number, dy: number): { clones: Element[]; idMap: Map<ID, ID> } {
    const rectOf = (t: Element) => this.layer.rectOf(t);
    // Members cloned without their column unfile at their rendered
    // slot: the stored x/y is a stale pre-filing position.
    const srcIds = new Set(els.map((e) => e.id));
    els = els.map((e) => {
      if (e.parentId === null || srcIds.has(e.parentId)) return e;
      const r = this.layer.rectOf(e);
      return { ...e, x: Math.round(r.x), y: Math.round(r.y) };
    });
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
        // Line labels render nowhere; don't write dead data.
        labels: e.type === 'line' ? e.labels : [...labels],
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
      // cardOrigin resolves members to their rendered slot, so a
      // member clone does not jump to its stale stored x/y mid-drag.
      origins.set(id, this.cardOrigin(id));
    }
    this.setSelection(newIds);
    return { ids: newIds, origins };
  }


  // Keyboard card nav: dir 0 picks the card nearest the viewport
  // centre (the arrow-key entry when nothing is selected), ±1 walks
  // the cards in reading order from the focused one.
  stepCard(dir: -1 | 0 | 1) {
    const els = this.layer
      .elements()
      .filter((e) => e.type !== 'line' && e.type !== 'annotation' && !(e.type === 'comment' && e.anchorId !== undefined))
      .map((e) => ({ e, r: this.layer.rectOf(e) }))
      .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
    if (!els.length) return;
    let target: Element;
    if (dir === 0) {
      const vr = this.vp.viewRect();
      const cx = vr.x + vr.w / 2;
      const cy = vr.y + vr.h / 2;
      let best = els[0]!;
      let bd = Infinity;
      for (const c of els) {
        const d = (c.r.x + c.r.w / 2 - cx) ** 2 + (c.r.y + c.r.h / 2 - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      target = best.e;
    } else {
      const curCard = document.activeElement instanceof HTMLElement ? document.activeElement.closest('.card') : null;
      const cur = curCard instanceof HTMLElement ? curCard.dataset.id : undefined;
      const i = els.findIndex((c) => c.e.id === cur);
      target = els[(i + dir + els.length) % els.length]!.e;
    }
    const r = this.layer.rectOf(target);
    if (!rectsIntersect(r, this.vp.viewRect())) this.panels.centerOn(r);
    this.selectOnly(target.id);
    // Render now so the view mounts before it takes focus.
    this.render();
    this.layer.view(target.id)?.node.focus({ preventScroll: true });
    // The card's own aria-label names only the type; add its title.
    this.announce(`${cardAriaLabel(target)}: ${this.panels.snippetFor(target)}`);
  }

  // Polite announcement channel for transient states (card nav) that
  // toasts should not carry visually. A beat of empty text first:
  // identical back-to-back messages do not re-announce otherwise.
  private announce(msg: string) {
    this.liveEl.textContent = '';
    requestAnimationFrame(() => {
      this.liveEl.textContent = msg;
    });
  }


  nudge(dx: number, dy: number) {
    // Arrows with no selection enter keyboard card nav instead.
    if (!this.sel.size) {
      this.stepCard(0);
      return;
    }
    if (this.lockedView()) return;
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
    // Usable box inside the chrome: on desktop, 76px rail + 16 gap on
    // the left, 44px topbar + 14 gap up top, zoom HUD reserved at the
    // bottom; on phones the bar plus the floating trash/well own the
    // bottom edge, so the inset measures the buttons' top rather than
    // trusting a constant (they ride 80px above the screen bottom).
    let insets = { l: 92, t: 58, r: 24, b: 64 };
    if (mobileShell()) {
      const top = document.querySelector('.rail-trash')?.getBoundingClientRect().top;
      insets = { l: 12, t: 52, r: 12, b: top ? innerHeight - top + 8 : 84 };
    }
    this.vp.fit(r, insets);
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


  // Palette drags share the card-drag drop ring so a new card can be seen
  // filing into the column under the pointer. updateDropTarget runs with
  // no dragged ids to exclude (the ghost is not an element); lines never
  // file, and rail chrome is not a target, matching the drop-time guard.
  paletteDropHint(ev: PointerEvent | null, type: ElementType) {
    const over = ev ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
    const ok = !!ev && type !== 'line' && !this.lockedView() && !over?.closest(DROP_EXCLUDE);
    this.gestures.updateDropTarget(ok ? this.boardPoint(ev) : null, []);
  }


  // Topmost canvas card under a board point, if it is a column. File and
  // rail drops onto a column join it; same rule as updateDropTarget, so a
  // column covered by another card cannot be the target.
  columnAt(pt: { x: number; y: number }): ID | null {
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
          // The card may be gone after the async work (delete/undo).
          const curEl = this.doc.elements[el.id];
          const cur = curEl ? imageDoc(curEl) : null;
          if (!cur || this.lockedView()) return;
          const next = { ...cur, blobRef: ref, name: file.name || cur.name, aspect, natW, natH };
          delete next.strokes;
          this.store.dispatch({
            type: 'element.patch',
            id: el.id,
            patch: { content: { image: next } },
          });
        } catch {
          toast(t('imageMissing'), 'err');
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
    const h = Math.max(GRID, Math.round(w / c.aspect / GRID) * GRID);
    const aspect = w / h;
    let content: { image: ImageDoc } | undefined;
    if (Math.abs(aspect - c.aspect) > 0.001) {
      try {
        const { loadBitmap, cropImage, canvasBlob } = await import('./editor/imgops');
        const bmp = await loadBitmap(c.blobRef);
        if (!bmp) {
          toast(t('imageMissing'), 'err');
          return;
        }
        const srcA = bmp.width / bmp.height;
        const cw = srcA > aspect ? Math.round(bmp.height * aspect) : bmp.width;
        const ch = srcA > aspect ? bmp.height : Math.round(bmp.width / aspect);
        const out = cropImage(bmp, { x: (bmp.width - cw) / 2, y: (bmp.height - ch) / 2, w: cw, h: ch });
        const blob = await canvasBlob(out, true);
        if (!blob) return;
        const ref = uid();
        await putBlob(ref, blob);
        const next = { ...c, blobRef: ref, aspect, natW: cw, natH: ch };
        delete next.strokes;
        content = { image: next };
      } catch {
        toast(t('imageMissing'), 'err');
        return;
      }
    }
    // Re-read the element after the async work: the card may have been
    // deleted or moved, and the grid snap applies to where it is now.
    const curEl = this.doc.elements[el.id];
    const cur = curEl ? imageDoc(curEl) : null;
    if (!cur || this.lockedView()) return;
    const patch: ElementPatch = {
      x: Math.round(curEl.x / GRID) * GRID,
      y: Math.round(curEl.y / GRID) * GRID,
      w: Math.max(GRID, Math.round((curEl.w ?? IMAGE_W) / GRID) * GRID),
      ...(content ? { content } : {}),
    };
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
    el.content = { link: { ...c, url, title: urlTitle(url) ?? hostOf(url) } };
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
        if (!this.doc.elements[id] || this.lockedView()) return;
        this.store.dispatch({ type: 'element.patch', id, patch: { color: sRGBHex } });
      })
      .catch(() => {});
  }


  // --- preferences ---

  applyPrefs() {
    // The lang/theme mirrors only exist for explicit choices so the
    // next boot can re-run browser/OS detection when a pref is unset.
    if (this.prefs.lang) localStorage.setItem('scatterboard:lang', this.prefs.lang);
    else localStorage.removeItem('scatterboard:lang');
    if (this.prefs.theme) localStorage.setItem('scatterboard:theme', this.prefs.theme);
    else localStorage.removeItem('scatterboard:theme');
    setTheme(this.prefs.theme ?? (systemDark() ? 'dark' : 'light'));
    setUiScale(this.prefs.uiScale ?? 1);
    setFormatting({
      browserLang: this.prefs.browserLang ?? true,
      lang: this.prefs.lang ?? activeLang(),
      currency: this.prefs.currency ?? null,
    });
    // Theme/scale change every card's colours and counter-scale, none
    // of which shows up as an element patch.
    this.refreshCards = true;
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


  private openHelp(anchor: HTMLElement) {
    openHelpMenu(anchor, {
      onShortcuts: () => openShortcutsPanel(),
      canInstall: installAvailable,
      onInstall: runInstall,
      onAbout: (a) =>
        openAboutPopup(a, {
          storage: async () => ({
            doc: this.adapter.docBytes(),
            blobs: await blobTotalSize(),
            persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
          }),
        }),
    });
  }


  // Robot-icon menu in the topbar: only local-agent state lives here;
  // the general online prefs stay in Settings.
  private openAgentMenu(anchor: HTMLElement) {
    openAgentPopup(anchor, {
      flag: () => this.prefs.agent === true,
      onFlag: (_k, v) => {
        this.prefs.agent = v;
        this.scheduleSave();
        this.requestRender();
        void import('./agent/index').then((m) => m.setAgentEnabled(this, v));
      },
      agentStatus: () => this.agentConnected,
      agentPaired: () => !!this.prefs.agentBridge,
    });
  }


  private openSettings(anchor: HTMLElement) {
    const save = () => this.scheduleSave();
    openSettings(anchor, {
      theme: () => this.prefs.theme ?? 'system',
      onTheme: (m) => {
        if (m === 'system') delete this.prefs.theme;
        else this.prefs.theme = m;
        this.applyPrefs();
        save();
      },
      scale: () => this.prefs.uiScale ?? 1,
      onScale: (sc) => {
        this.prefs.uiScale = sc;
        this.applyPrefs();
        save();
      },
      lang: () => this.prefs.lang ?? null,
      // Module-level label tables are captured at boot; switching
      // languages reloads the shell after the prefs flush.
      onLang: (l: Lang | null) => {
        if (l) {
          this.prefs.lang = l;
          localStorage.setItem('scatterboard:lang', l);
        } else {
          delete this.prefs.lang;
          localStorage.removeItem('scatterboard:lang');
        }
        this.scheduleSave();
        void this.flush().then(() => location.reload());
      },
      browserLang: () => this.prefs.browserLang ?? true,
      onBrowserLang: (v) => {
        this.prefs.browserLang = v;
        this.applyPrefs();
        save();
      },
      currency: () => this.prefs.currency ?? null,
      onCurrency: (c) => {
        if (c) this.prefs.currency = c;
        else delete this.prefs.currency;
        this.applyPrefs();
        save();
      },
      flag: (k) =>
        k === 'undoArrows' || k === 'autoEdit' || k === 'unfurl'
          ? this.prefs[k] !== false
          : this.prefs[k] === true,
      onFlag: (k, v) => {
        this.prefs[k] = v;
        save();
        this.requestRender();
        if (k === 'agent') void import('./agent/index').then((m) => m.setAgentEnabled(this, v));
      },
      agentStatus: () => this.agentConnected,
      agentPaired: () => !!this.prefs.agentBridge,
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
    try {
      await this.flush();
      localStorage.removeItem('scatterboard:lang');
      localStorage.removeItem('scatterboard:theme');
      await this.adapter.clear();
      await clearBlobs();
    } catch {
      toast(t('exFail'), 'err');
      return;
    }
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
    this.saveState = 'saving';
    // Camera-only saves (kind 1) write a small position row: persist
    // them silently. The chip only reports real doc changes.
    if (kind === 2 && !this.saveChip) {
      this.saveChip = true;
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
    if (this.saveChip) {
      this.saveChip = false;
      this.topbar.setSaveState('saved');
    }
  }


  async flush() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveState === 'saving') await this.saveNow();
  }
}

