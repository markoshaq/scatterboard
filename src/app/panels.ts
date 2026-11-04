import type { App } from '../app';
import { boardRefOf, createBoard, createBoardCard, uid, UNSORTED, type Board, type Element, type ID } from '../state/schema';
import { putBlob } from '../persist/blobs';
import { prepareImage } from '../ui/files';
import type { Rect } from '../canvas/viewport';
import { toast } from '../ui/toast';
import { relTime, t } from '../strings';
import { typeIcon } from '../ui/icons';
import { dragGhost, DROP_EXCLUDE } from '../ui/util';
import { openPanel, panelEmpty, panelRow, dayGroupLabel, type PanelHandle } from '../ui/panel';
import { openSearchPanel, searchBoard, type SearchHit } from '../ui/search';
import { openBoardsPanel, type BoardRow, type BoardsPanel } from '../ui/boards';
import { choice } from '../ui/toast';
import { builtinTemplates, instantiateActions, snapshotTemplate } from '../state/templates';
import { openIconPicker } from '../ui/iconpicker';
import { openNewBoardPicker } from '../ui/newboard';
export class Panels {
  constructor(private a: App) {}

  lastPanelSig = '';

  panel: PanelHandle | null = null;

  panelKind: 'unsorted' | 'trash' | 'search' | 'boards' | null = null;

  collapsedBoards = new Set<ID>();


  // --- unsorted / trash / panels ---

  closePanel() {
    this.panel?.close();
    this.panel = null;
    this.panelKind = null;
  }


  fileToUnsorted() {
    if (this.a.lockedView()) return;
    const els = this.a.movableCards().filter((e) => e.parentId === null);
    if (!els.length) return;
    this.a.editing.endEdit();
    this.a.store.dispatch({
      type: 'batch',
      actions: els.map((e) => ({ type: 'element.patch' as const, id: e.id, patch: { parentId: UNSORTED } })),
    });
    for (const e of els) this.a.sel.delete(e.id);
    this.a.filterIds.clear();
    this.a.requestRender();
  }


  unsortedItems(): Element[] {
    return this.a.layer.members(UNSORTED).filter((e) => e.type !== 'line').reverse();
  }


  takePanel(kind: 'unsorted' | 'trash' | 'search' | 'boards', handle: PanelHandle) {
    this.closePanel();
    this.lastPanelSig = '';
    this.panel = handle;
    this.panelKind = kind;
    const prev = handle.onClose;
    handle.onClose = () => {
      prev?.();
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
    const boardId = this.a.boardId;
    if (!boardId) return;
    this.takePanel(
      'search',
      openSearchPanel({
        search: (q) => searchBoard(this.a.doc, boardId, q),
        recents: () =>
          (this.a.prefs.recentBoards ?? [])
            .map((bid) => {
              const b = this.a.doc.boards[bid];
              return b ? { boardId: bid, title: b.title, ...(b.icon !== undefined ? { icon: b.icon } : {}) } : null;
            })
            .filter((r): r is NonNullable<typeof r> => !!r),
        recentIds: () => this.a.prefs.recentBoards ?? [],
        onJump: (hit) => this.jumpToHit(hit),
        onClose: () => {},
      }),
    );
  }


  openBoards() {
    if (this.panelKind === 'boards') {
      this.closePanel();
      return;
    }
    this.takePanel(
      'boards',
      openBoardsPanel({
        boards: () => this.boardsList(),
        onOpen: (id) => this.a.openBoard(id, undefined, false, true),
        onRename: (id, title) => {
          if (!this.a.lockedView()) this.a.store.dispatch({ type: 'board.patch', id, patch: { title } });
        },
        onDelete: (id) => this.deleteBoardCascade(id),
        onNew: (anchor) => this.newProject(anchor),
        onToggleCollapse: (id) => {
          if (this.collapsedBoards.has(id)) this.collapsedBoards.delete(id);
          else this.collapsedBoards.add(id);
        },
      }),
    );
  }


  // The board tree in panel order: root boards (projects) in createdAt
  // order, each followed by its descendants one depth step deeper.
  boardsList(): BoardRow[] {
    const cards = this.a.layer.canvasCounts();
    const kids = new Map<ID | null, Board[]>();
    for (const b of Object.values(this.a.doc.boards)) {
      const list = kids.get(b.parentId) ?? [];
      list.push(b);
      kids.set(b.parentId, list);
    }
    for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    // A corrupted parent graph (JSON import) must not recurse forever.
    const subsSeen = new Set<ID>();
    const subs = (bid: ID): number => {
      if (subsSeen.has(bid)) return 0;
      subsSeen.add(bid);
      return (kids.get(bid) ?? []).reduce((n, k) => n + 1 + subs(k.id), 0);
    };
    const total = Object.keys(this.a.doc.boards).length;
    const locked = this.a.lockedView();
    const out: BoardRow[] = [];
    const visited = new Set<ID>();
    const visit = (b: Board, depth: number) => {
      if (visited.has(b.id)) return;
      visited.add(b.id);
      const subCount = subs(b.id);
      out.push({
        id: b.id,
        depth,
        title: b.title || t('untitled'),
        ...(b.icon !== undefined ? { icon: b.icon } : {}),
        cards: cards.get(b.id) ?? 0,
        boards: subCount,
        current: b.id === this.a.boardId,
        collapsed: this.collapsedBoards.has(b.id),
        editable: !locked,
        deletable: !locked && total - subCount > 1,
      });
      for (const k of kids.get(b.id) ?? []) visit(k, depth + 1);
    };
    for (const root of kids.get(null) ?? []) visit(root, 0);
    return out;
  }


  // Panel delete: cascade wipes the board subtree's own elements, and a
  // second sweep removes board cards/shortcuts elsewhere in the doc that
  // point at a deleted board (cascadeActions alone would leave them
  // dangling). One batch so undo restores everything.
  deleteBoardCascade(bid: ID) {
    const board = this.a.doc.boards[bid];
    if (!board || this.a.lockedView()) return;
    this.a.editing.endEdit();
    const actions = this.a.cascadeActions(bid);
    const deleting = new Set<ID>();
    const deadBoards = new Set<ID>();
    for (const a of actions) {
      if (a.type === 'element.delete') deleting.add(a.el.id);
      else if (a.type === 'board.delete') deadBoards.add(a.board.id);
    }
    // The app always needs a board to land on.
    if (deadBoards.size >= Object.keys(this.a.doc.boards).length) return;
    for (const el of Object.values(this.a.doc.elements)) {
      if (deleting.has(el.id)) continue;
      const ref = boardRefOf(el);
      if (ref && deadBoards.has(ref)) {
        deleting.add(el.id);
        actions.push({ type: 'element.delete', el });
      }
    }
    actions.unshift(...this.a.detachCommentActions(deleting));
    actions.unshift(...this.a.detachLineActions(deleting));
    let target: ID | null = null;
    if (this.a.boardId && deadBoards.has(this.a.boardId)) {
      let p = board.parentId;
      const seen = new Set<ID>();
      while (p && deadBoards.has(p) && !seen.has(p)) {
        seen.add(p);
        p = this.a.doc.boards[p]?.parentId ?? null;
      }
      target = p ?? this.fallbackBoard(deadBoards);
      // A parent-cycle exit or a missing 'home' fallback can leave a
      // dead or dangling id here.
      if (target && (deadBoards.has(target) || !this.a.doc.boards[target])) target = null;
    }
    this.a.store.dispatch({ type: 'batch', actions });
    for (const id of deleting) this.a.sel.delete(id);
    if (target) this.a.openBoard(target);
    // Undo pops whatever is newest in history, which may no longer be
    // this delete if the user kept working while the toast sat open.
    choice(t('boardDeleted').replace('{name}', board.title || t('untitled')), t('drawUndo'), () => {
      if (!this.a.lockedView()) this.a.store.undo();
    });
  }


  // First surviving root board in createdAt order; where deletes and
  // imports land when 'home' (or the intended parent) is gone.
  fallbackBoard(dead: Set<ID>): ID {
    const roots = Object.values(this.a.doc.boards)
      .filter((b) => b.parentId === null && !dead.has(b.id))
      .sort((a, b) => a.createdAt - b.createdAt);
    return roots[0]?.id ?? 'home';
  }


  newProject(anchor: HTMLElement) {
    if (this.a.lockedView()) return;
    openNewBoardPicker(anchor, {
      builtins: builtinTemplates,
      customs: () => Object.values(this.a.doc.templates).sort((a, b) => b.createdAt - a.createdAt),
      onPick: (tpl) => this.placeProject(tpl),
      onRename: (id, name) => this.a.store.dispatch({ type: 'template.patch', id, patch: { name } }),
      onDelete: (id) => {
        const tpl = this.a.doc.templates[id];
        if (tpl) this.a.store.dispatch({ type: 'template.delete', tpl });
      },
    });
  }


  // Root boards are projects: no board card lands on the current canvas.
  placeProject(tpl: import('../state/schema').Template | null) {
    if (this.a.lockedView()) return;
    let boardId: ID;
    if (tpl) {
      const { actions, boardId: bid } = instantiateActions(this.a.doc, tpl, null, { x: 0, y: 0 });
      this.a.store.dispatch({ type: 'batch', actions });
      boardId = bid;
    } else {
      const board = createBoard({ title: t('projectUntitled'), parentId: null });
      this.a.store.dispatch({ type: 'board.create', board });
      boardId = board.id;
    }
    this.a.openBoard(boardId);
  }


  jumpToHit(hit: SearchHit) {
    const q = hit.query ?? '';
    if (!hit.elementId) {
      this.a.openBoard(hit.boardId, q || undefined);
      this.applyRouteFilter();
      this.closePanel();
      return;
    }
    const hash = `#/b/${hit.boardId}?filter_query=${encodeURIComponent(q)}&filter_ids=${hit.elementId}`;
    if (hit.boardId !== this.a.boardId) {
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
    if (!this.a.boardId) return;
    const m = location.hash.match(/^#\/b\/[^?#]+\?([^#]*)$/);
    const params = m ? new URLSearchParams(m[1]!) : null;
    const fid = params?.get('filter_ids');
    const q = params?.get('filter_query') ?? '';
    let hits: Element[] = [];
    if (fid) {
      const el = this.a.doc.elements[fid];
      if (el && el.boardId === this.a.boardId) hits = [el];
    } else if (q) {
      hits = searchBoard(this.a.doc, this.a.boardId, q)
        .map((h) => (h.elementId ? this.a.doc.elements[h.elementId] : undefined))
        .filter((e): e is Element => !!e);
    }
    if (!hits.length) {
      // No usable filter params: drop any stale highlight (e.g. after
      // Back navigation stripped the query from a filtered URL).
      if (this.a.filterIds.size) {
        this.a.filterIds.clear();
        this.a.sel.clear();
        this.a.render();
      }
      return;
    }
    // Filtered mode: matched cards stay lit, the rest of the board dims
    // until the user selects something else.
    this.a.filterIds = new Set(hits.map((e) => e.id));
    this.a.sel = new Set(hits.map((e) => e.id));
    this.a.render();
    this.centerOn(this.a.layer.rectOf(hits[0]!));
  }


  centerOn(r: Rect) {
    this.a.vp.x = this.a.vp.vw / 2 - (r.x + r.w / 2) * this.a.vp.z;
    this.a.vp.y = this.a.vp.vh / 2 - (r.y + r.h / 2) * this.a.vp.z;
    this.a.vp.changed();
  }


  emptyTrash() {
    if (this.a.lockedView()) return;
    const ids = Object.keys(this.a.doc.trash);
    if (!ids.length) return;
    // Blobs are NOT released here: the trash.remove batch is undoable,
    // and an undo must restore entries with their media intact. The
    // boot-time orphan purge reclaims refs that stay dead.
    this.a.store.dispatch({ type: 'batch', actions: ids.map((id) => ({ type: 'trash.remove' as const, id })) });
  }


  restoreTrash(id: ID, pt: { x: number; y: number }) {
    if (this.a.lockedView()) return;
    const entry = this.a.doc.trash[id];
    if (!entry) return;
    const boardId = this.a.boardId ?? entry.el.boardId;
    const el: Element = {
      ...entry.el,
      boardId,
      parentId: this.a.columnAt(pt),
      x: Math.round(pt.x),
      y: Math.round(pt.y),
      z: ++this.a.doc.seq,
    };
    // Dead or foreign-board anchors would leave the restored card
    // permanently invisible: it skips the layer, the pins overlay
    // (no anchor), and marquee.
    if (el.anchorId !== undefined && this.a.doc.elements[el.anchorId]?.boardId !== boardId) {
      delete el.anchorId;
    }
    el.labels = el.labels.filter((l) => this.a.doc.labels[l]?.boardId === boardId);
    if (boardId !== entry.el.boardId) delete el.syncGroup;
    // Keep the card's own colour; only inherit the board accent on a
    // card that has none.
    if (el.color === undefined) this.a.stampBoardColor(el);
    this.a.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'element.create', el },
        { type: 'trash.remove', id },
      ],
    });
    this.a.setSelection([el.id]);
  }


  snippetFor(el: Element): string {
    const c = el.content;
    if ('note' in c) return c.note.text.split('\n')[0] || t('railNote');
    if ('heading' in c) return c.heading.text || t('railHeading');
    if ('todo' in c) return c.todo.title || c.todo.items.find((i) => i.text)?.text || t('railTodo');
    if ('column' in c) return c.column.title || t('railColumn');
    if ('boardRef' in c) return this.a.doc.boards[c.boardRef]?.title ?? t('railBoard');
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


  draggableRow(el: Element, extra: string | undefined, onDrop: (pt: { x: number; y: number }) => void) {
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
          if (document.elementFromPoint(ev.clientX, ev.clientY)?.closest(DROP_EXCLUDE)) return;
          onDrop(this.a.boardPoint(ev));
        },
      );
    });
    return row;
  }


  renderPanel() {
    if (!this.panel || !this.panelKind || this.panelKind === 'search') {
      this.lastPanelSig = '';
      return;
    }
    // Cheap signature so unchanged panels skip the full DOM rebuild.
    let sig = '';
    if (this.panelKind === 'unsorted') {
      const items = this.unsortedItems();
      sig = `u:${items.map((e) => `${e.id}:${e.modifiedAt}`).join(',')}`;
    } else if (this.panelKind === 'trash') {
      let n = 0;
      let m = 0;
      for (const t of Object.values(this.a.doc.trash)) {
        n++;
        if (t.deletedAt > m) m = t.deletedAt;
      }
      sig = `t:${n}:${m}`;
    } else {
      // Data sig, not rev: card drags bump the rev every frame while
      // the board list only changes with board meta or card counts.
      const boards = Object.values(this.a.doc.boards)
        .map((b) => `${b.id}:${b.title}:${b.icon ?? ''}:${b.parentId ?? ''}:${b.createdAt}`)
        .join('|');
      const counts = [...this.a.layer.canvasCounts()].map(([k, v]) => `${k}=${v}`).join(',');
      sig = `b:${boards}|${counts}|${[...this.collapsedBoards].join(',')}|${this.a.boardId ?? ''}`;
    }
    if (sig === this.lastPanelSig) return;
    this.lastPanelSig = sig;
    if (this.panelKind === 'boards') {
      (this.panel as BoardsPanel).render();
      return;
    }
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
            if (this.a.lockedView()) return;
            this.a.store.dispatch({
              type: 'element.patch',
              id: el.id,
              patch: { parentId: this.a.columnAt(pt), x: Math.round(pt.x), y: Math.round(pt.y) },
            });
            this.a.setSelection([el.id]);
          }),
        );
      }
      return;
    }
    const entries = Object.entries(this.a.doc.trash).sort((a, b) => b[1].deletedAt - a[1].deletedAt);
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

  placeBoard(
    hostId: ID,
    pt: { x: number; y: number },
    tpl: import('../state/schema').Template | null,
    parentId: ID | null = null,
  ) {
    if (this.a.lockedView()) return;
    if (tpl) {
      const { actions, cardId } = instantiateActions(this.a.doc, tpl, hostId, pt);
      if (parentId && cardId) actions.push({ type: 'element.patch', id: cardId, patch: { parentId } });
      this.a.store.dispatch({ type: 'batch', actions });
      if (cardId) this.a.setSelection([cardId]);
      return;
    }
    const board = createBoard({ parentId: hostId });
    const el = createBoardCard(this.a.doc, hostId, board.id, Math.round(pt.x), Math.round(pt.y));
    el.parentId = parentId;
    this.a.stampBoardColor(el);
    this.a.store.dispatch({
      type: 'batch',
      actions: [
        { type: 'board.create', board },
        { type: 'element.create', el },
      ],
    });
    this.a.setSelection([el.id]);
  }


  saveAsTemplate(ref: ID) {
    if (this.a.lockedView()) return;
    const tpl = snapshotTemplate(this.a.doc, ref, this.a.doc.boards[ref]?.title ?? '');
    if (!tpl) return;
    this.a.store.dispatch({ type: 'template.create', tpl });
    toast(t('tplSaved'));
  }


  // A second board card pointing at the same board, placed beside the
  // original like a duplicate.
  createShortcut(el: Element) {
    if (this.a.lockedView()) return;
    const ref = boardRefOf(el);
    if (!ref || !this.a.boardId) return;
    const card = createBoardCard(this.a.doc, this.a.boardId, ref, el.x + 24, el.y + 24);
    this.a.stampBoardColor(card);
    this.a.store.dispatch({ type: 'element.create', el: card });
    this.a.setSelection([card.id]);
  }


  setBoardIcon(boardId: ID, icon: string | undefined) {
    if (this.a.lockedView()) return;
    // The old icon blob stays: undo restores the 'b:' ref, and the
    // boot-time orphan purge reclaims it once it is truly dead.
    this.a.store.dispatch({ type: 'board.patch', id: boardId, patch: { icon } });
  }


  iconPickerFor(boardId: ID, anchor: HTMLElement | DOMRect) {
    if (this.a.lockedView()) return;
    openIconPicker(anchor, {
      title: () => this.a.doc.boards[boardId]?.title ?? '',
      onPick: (icon) => this.setBoardIcon(boardId, icon),
      onUpload: () => this.uploadBoardIcon(boardId),
    });
  }


  uploadBoardIcon(boardId: ID) {
    if (this.a.lockedView()) return;
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

}
