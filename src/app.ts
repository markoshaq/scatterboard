import type { Store } from './state/store';
import { boardRefOf, createAnnotation, createColumn, createComment, createDocument, createEmbed, createHeading, createLine, createLink, createNote, createSketch, createSwatch, createTable, createTodo, documentDoc, imageDoc, lineDoc, sketchDoc, EDITOR_TYPES, UNSORTED, type Doc, type Element, type ElementType, type ID, type EmbedKind, type PresentOpts } from './state/schema';
import type { DocStorage, PersistedWorkspace, Prefs } from './persist/storage';
import { putBlob } from './persist/blobs';
import { scrubContent } from './ui/sanitize';
import { Viewport } from './canvas/viewport';
import { Renderer, type DraftLine, type Guide, type SceneLine } from './canvas/renderer';
import { CardsLayer } from './cards/layer';
import { cardAriaLabel } from './cards/factory';
import { Topbar, type Crumb } from './ui/topbar';
import { Rail } from './ui/rail';
import { attachPointer } from './canvas/input';
import { attachShortcuts } from './ui/shortcuts';
import { normRect, rectsIntersect, unionRect } from './canvas/hit';
import { hitLines, linePath, resolveLine, type LineHit } from './canvas/lines';
import { t } from './strings';
import { toast } from './ui/toast';
import type { EditorHandle } from './editor/doceditor';
import { imgModeFromHash, imgModeParam, type ImgMode } from './editor/imgmode';
import type { ImgEditorHandle } from './editor/imgeditor';
import { openShortcutsPanel } from './ui/shortcutpanel';
import { openCapturePopup } from './ui/capture';
import { openMobileMenu } from './ui/toolpopups';
import { mobileShell } from './ui/util';
import { closeBoardPopup, closeToolPopup } from './ui/popup';
import { builtinTemplates } from './state/templates';
import { openNewBoardPicker } from './ui/newboard';
import { BoardExport } from './app/export';
import { Editing } from './app/editing';
import { RailTools } from './app/tools';
import { Panels } from './app/panels';
import { Gestures } from './app/gestures';
import { Overlays } from './app/overlays';
import { Deletion } from './app/deletion';
import { Comments } from './app/comments';
import { FolderSync } from './app/syncdir';
import { Reminders } from './app/reminders';
import { Saver } from './app/persistence';
import { Present } from './app/present';
import { Preferences } from './app/prefs';
import { Ingest } from './app/ingest';
import { Clipboard } from './app/clipboard';
import { Minimap } from './ui/minimap';
import { dueSoonCount, type DueItem } from './ui/duepanel';


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
  // Folder backup (File System Access): mirrors the workspace into a
  // user-picked directory after each save; see app/syncdir.ts.
  readonly fsync = new FolderSync(this);
  readonly reminders = new Reminders(this);
  readonly saver = new Saver(this);
  readonly present = new Present(this);
  readonly settings = new Preferences(this);
  readonly ingest = new Ingest(this);
  readonly clipboard = new Clipboard(this);

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

  // savedAt of the last workspace this tab wrote or loaded; the folder
  // backup's newer-file check compares against it.
  lastSavedAt = 0;

  private renderQueued = false;

  // Elements touched by store changes since the last layer.sync; the
  // layer skips update() on untouched cards. refreshCards forces a
  // full pass for non-element inputs (theme, board meta, locale).
  private dirtyEls = new Set<ID>();

  refreshCards = true;

  private lastIz = 1;

  private wasDimming = false;

  private minimap: Minimap;

  private dueCache = { rev: -1, n: 0 };

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

  // Last pointer position kept in client space: the board point is
  // derived on read so a paste after a pan/zoom with no intervening
  // move still lands under the cursor.
  pointerClient: { x: number; y: number } | null = null;

  get pointer(): { x: number; y: number } | null {
    return this.pointerClient ? this.vp.toBoard(this.pointerClient.x, this.pointerClient.y) : null;
  }

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
      onDue: () => this.panels.openDue(),
      onView: (anchor) => this.present.openViewMenu(anchor),
      onHelp: (anchor) => this.settings.openHelp(anchor),
      onExport: (anchor) => this.exporter.openExportMenu(anchor),
      onSettings: (anchor) => this.settings.openSettings(anchor),
      onAgent: (anchor) => this.settings.openAgentMenu(anchor),
      onMore: (anchor) => this.openMobileMenu(anchor),
      onCrumbIcon: (id, anchor) => this.panels.iconPickerFor(id, anchor),
      onCrumbBoards: () => this.panels.openBoards(),
      onCrumbRename: (id, title) => {
        if (!this.lockedView()) this.store.dispatch({ type: 'board.patch', id, patch: { title } });
      },
      onUndo,
      onRedo,
    });
    this.rail = new Rail(root, {
      onDrop: (type, at, kind) => this.createFromRail(type, at, kind),
      onDropHint: (ev, type) => this.ingest.paletteDropHint(ev, type),
      onTool: (id, anchor) => this.tools.onTool(id, anchor),
      onAddImage: () => this.ingest.pickFiles('image/*'),
      onUpload: () => this.ingest.pickFiles('*/*'),
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
    this.minimap = new Minimap(this);
    vpEl.appendChild(this.minimap.node);
    this.saver.init();
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
      this.saver.schedulePosSave();
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
        // A mounted element editor whose card vanished (undo, cascade,
        // agent delete) must close too; its callbacks are all stale.
        if (this.overlayId === id) this.applyRoute();
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
    this.settings.init();
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
    // A lazy editor chunk in flight must not mount over the new board:
    // pushState navigation never fires hashchange, so bump the guard.
    this.editorSeq++;
    this.exitPresent();
    this.editing.endEdit();
    // A gesture in flight (marquee, card/line/endpoint drag, connect,
    // resize, pan) must not outlive the board it started on: cancel
    // each through its own pointercancel path, and drop board draw
    // mode the same way.
    this.gestures.cancelGestures();
    this.exitDrawMode();
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
    // seq alone cannot see deletes, converts or pushState navigation
    // while the lazy chunk loads: re-check element and route too.
    const stale = () => {
      const cur = this.doc.elements[el.id];
      const em = location.hash.match(/^#\/e\/([^/?#]+)/);
      return !cur || cur.type !== el.type || cur.boardId !== this.boardId || em?.[1] !== el.id;
    };
    let handle: EditorHandle | null = null;
    if (el.type === 'document') {
      if (!documentDoc(el)) return;
      const { openDocumentEditor } = await import('./editor/doceditor');
      if (seq !== this.editorSeq || stale()) return;
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
      if (seq !== this.editorSeq || stale()) return;
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
      if (seq !== this.editorSeq || stale()) return;
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
    // editor, switched boards or engaged the present lock meanwhile.
    if (this.boardDraw || this.overlay || !this.boardId || this.lockedView()) return;
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
    return this.present.locked();
  }


  enterPresent() {
    this.present.enter();
  }


  exitPresent() {
    this.present.exit();
  }


  togglePresent() {
    this.present.toggle();
  }


  // Agent shim: set presentation toggles explicitly (the View menu
  // toggles them one at a time). Same direct-mutation path.
  setPresentOpts(o: PresentOpts) {
    this.present.setOpts(o);
  }


  // 'Focus on selected cards': non-selected canvas items dim. Re-checked
  // in render() so the focus set follows live selection changes.
  dims(id: ID): boolean {
    return this.present.dims(id);
  }


  // Phone topbar overflow: one button fans out to the popups that
  // collapse out of the bar on narrow screens.
  private openMobileMenu(anchor: HTMLElement) {
    openMobileMenu(anchor, {
      onFit: () => this.fitView(),
      onView: (a) => this.present.openViewMenu(a),
      onExport: (a) => this.exporter.openExportMenu(a),
      onAgent: (a) => this.settings.openAgentMenu(a),
      onSettings: (a) => this.settings.openSettings(a),
      onHelp: (a) => this.settings.openHelp(a),
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
    this.topbar.setDue(this.dueCount());
    const showMap = this.prefs.minimap !== false && !!board && !this.presenting;
    this.minimap.node.style.display = showMap ? '' : 'none';
    if (showMap) this.minimap.draw();
    const title = board ? `${board.title || t('untitled')} · ${t('appName')}` : t('appName');
    if (document.title !== title) document.title = title;
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


  // Overdue + due-today items across every board, cached by store rev:
  // render() runs per frame during drags but the count only moves with
  // real doc changes.
  private dueCount(): number {
    if (this.dueCache.rev === this.store.rev) return this.dueCache.n;
    const n = dueSoonCount(this.doc);
    this.dueCache = { rev: this.store.rev, n };
    return n;
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
      let pts = l.pts;
      if (d && d.id === el.id) {
        // A dragged end is free, not attached: drop its exit side and
        // rebuild the path around the pointer position.
        if (d.which === 'from') {
          l.x1 = d.x;
          l.y1 = d.y;
          l.side1 = undefined;
        } else {
          l.x2 = d.x;
          l.y2 = d.y;
          l.side2 = undefined;
        }
        pts = linePath(l.x1, l.y1, l.side1, l.x2, l.y2, l.side2, lineDoc(el)?.route);
      }
      out.push({ el: l.el, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, pts, selected: this.sel.has(el.id), dim: this.dims(el.id) });
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
    // Image and file cards have no editable surface: a session would
    // open an empty undo group around nothing.
    if (el.type === 'image' || el.type === 'file') return;
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
    // Column members count as selected too: a select-all delete must
    // reach inside columns or the column delete spills them back out.
    const all = new Set<ID>();
    const walk = (id: ID) => {
      if (all.has(id)) return;
      all.add(id);
      for (const m of this.layer.members(id)) walk(m.id);
    };
    for (const e of this.layer.elements()) walk(e.id);
    this.setSelection(all);
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
    this.clipboard.duplicateSelection();
  }


  // --- clipboard + cloning ---

  copySet(): Element[] {
    return this.clipboard.copySet();
  }


  copySelection() {
    this.clipboard.copySelection();
  }


  cutSelection() {
    this.clipboard.cutSelection();
  }


  paste() {
    this.clipboard.paste();
  }


  pasteStyles() {
    this.clipboard.pasteStyles();
  }


  // Opt+drag: clone the dragged set in place (inside the move group), then
  // drag the clones. Returns the new drag ids and their drag origins.
  cloneForDrag(ids: ID[]): { ids: ID[]; origins: Map<ID, { x: number; y: number }> } | null {
    return this.clipboard.cloneForDrag(ids);
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

  // Present-mode arrow keys walk the cards in reading order like
  // slides: the landing card is selected (so Focus-on-selected dims
  // the rest) and fitted on screen.
  presentStep(dir: -1 | 1) {
    this.present.step(dir);
  }

  // Polite announcement channel for transient states (card nav) that
  // toasts should not carry visually. A beat of empty text first:
  // identical back-to-back messages do not re-announce otherwise.
  announce(msg: string) {
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


  fitInsets() {
    // Usable box inside the chrome: on desktop, 76px rail + 16 gap on
    // the left, 44px topbar + 14 gap up top, zoom HUD reserved at the
    // bottom; on phones the bar plus the floating trash/well own the
    // bottom edge, so the inset measures the buttons' top rather than
    // trusting a constant (they ride 80px above the screen bottom).
    if (mobileShell()) {
      const top = document.querySelector('.rail-trash')?.getBoundingClientRect().top;
      return { l: 12, t: 52, r: 12, b: top ? innerHeight - top + 8 : 84 };
    }
    return { l: 92, t: 58, r: 24, b: 64 };
  }

  fitView() {
    const r = unionRect(this.layer.elements().map((e) => this.layer.rectOf(e)));
    this.vp.fit(r, this.fitInsets());
  }

  // Z with a selection frames the picked cards instead of the board.
  fitSelection() {
    const rects = [...this.sel]
      .map((id) => this.doc.elements[id])
      .filter((e): e is Element => !!e)
      .map((e) => this.layer.rectOf(e));
    this.vp.fit(unionRect(rects), this.fitInsets());
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

  viewCenter() {
    return this.vp.toBoard(this.vp.vw / 2, this.vp.vh / 2);
  }


  // Topmost canvas card under a board point, if it is a column. File and
  // rail drops onto a column join it; same rule as updateDropTarget, so a
  // column covered by another card cannot be the target.
  columnAt(pt: { x: number; y: number }): ID | null {
    return this.ingest.columnAt(pt);
  }


  ingestFileList(files: File[], pt: { x: number; y: number }) {
    this.ingest.ingestFileList(files, pt);
  }


  // Image More > Replace Image: swap the blob, keep caption and position.
  // Strokes drop with the old natural space.
  replaceImage(el: Element) {
    return this.ingest.replaceImage(el);
  }


  // Image More > Crop Image to Fit Dot Grid: snap the card rect to the
  // dot grid, then centre-crop the bitmap so its aspect exactly fills
  // the snapped card (no CSS cover crop remains). Interpretation:
  // width AND rendered height land on grid multiples.
  cropImageToGrid(el: Element) {
    return this.ingest.cropImageToGrid(el);
  }


  // OS-clipboard paste: internal element clipboard wins, then files,
  // then URL text -> link card. Text fields keep native paste.
  pasteExternal(e: ClipboardEvent) {
    this.ingest.pasteExternal(e);
  }

  fileToUnsorted() {
    this.panels.fileToUnsorted();
  }

  openSearch() {
    this.panels.openSearch();
  }

  jumpToDue(d: DueItem) {
    this.panels.jumpToHit({
      boardId: d.boardId,
      elementId: d.elId,
      icon: '',
      snippet: '',
      modifiedAt: 0,
      unsorted: d.unsorted,
    });
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
    this.settings.applyPrefs();
  }


  toggleTheme() {
    this.settings.toggleTheme();
  }


  stepUiScale(dir: number) {
    this.settings.stepUiScale(dir);
  }


  // First run only: one quiet dismissible hint, then never again.
  welcomeHint() {
    this.settings.welcomeHint();
  }


  // --- persistence ---

  scheduleSave() {
    this.saver.scheduleSave();
  }


  markExported() {
    this.saver.markExported();
  }


  flush() {
    return this.saver.flush();
  }


  // External workspace writes (snapshot/folder restores) must land
  // after any in-flight autosave and stay last: freeze the save path
  // first so a debounced or queued saveNow can't slip a stale doc in
  // behind the restore, then chain the write behind saveTail.
  beginExternalSave() {
    this.saver.beginExternalSave();
  }

  // Re-arm autosave when the external write never landed; pending
  // edits need their debounce back.
  endExternalSave() {
    this.saver.endExternalSave();
  }

  saveExternal(w: PersistedWorkspace): Promise<void> {
    return this.saver.saveExternal(w);
  }

  // Folder-backup and snapshot restores write through the adapter
  // directly; other tabs still need the reload nudge.
  notifyExternalSave() {
    this.saver.notifyExternalSave();
  }


  reloadDiscarding() {
    this.saver.reloadDiscarding();
  }
}
