import type { App } from '../app';
import { annotationDoc, boardRefOf, columnTitle, createBoard, createBoardCard, createComment, createDocument, createLabel, createLine, createNote, createSketch, documentDoc, embedDoc, headingDoc, lineDoc, linkDoc, nextZ, strokesBBox, swatchDoc, todoDoc, SKETCH_PAD_H, SKETCH_PAD_W, type Element, type CellType, type ID, type Label, type LineMarker, type LineWeight, type Stroke } from '../state/schema';
import type { Action, ElementPatch } from '../state/actions';
import { blobUrl, copyTextToClipboard, downloadBlobRef } from '../persist/blobs';
import { TodoCard } from '../cards/todo';
import { TableCard } from '../cards/table';
import { toolMenuItems, type ToolId } from '../ui/rail';
import { ICONS } from '../ui/icons';
import { unionRect } from '../canvas/hit';
import { t } from '../strings';
import { imgModeParam, type ImgMode } from '../editor/imgmode';
import { downloadTextFile, strokesToSvgFile } from '../draw/strokes';
import { LABEL_COLORS, openColorPopup, openLabelsPopup, openLinkInfoPopup, openCellAlignPopup, openMenuPopup, openReactionsPopup, openTextStylePopup, type MenuItem } from '../ui/toolpopups';
import { applyBlockStyle, applyHighlight, applyTextColor, blockStyleAt, execMark, toggleCenter, toggleInlineCode, toggleList } from '../ui/richtext';
export class RailTools {
  constructor(private a: App) {}


  // --- rail tools ---

  onTool(id: ToolId, anchor: HTMLElement | DOMRect) {
    if (this.a.lockedView()) return;
    const sel = this.a.selectedEls();
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
        const editing = this.a.editing.editingEl();
        if (editing?.type === 'table') {
          const v = this.tableView();
          if (v) openMenuPopup(anchor, this.cellMoreItems(v));
        } else {
          openMenuPopup(anchor, this.moreItems(sel));
        }
        break;
      }
      case 'tx-style': {
        const el = this.a.editing.editingEl();
        if (el?.type === 'table') this.tableView()?.startCellEdit();
        const surface = this.a.editing.editSurface();
        if (!el || !surface) return;
        if (el.type === 'heading') {
          const c = headingDoc(el);
          if (!c) return;
          const setLevel = (level: 1 | 2) => {
            if (this.a.lockedView()) return;
            const e = this.a.doc.elements[el.id];
            const cur = e ? headingDoc(e) : null;
            if (!cur) return;
            this.a.store.dispatch({
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
      case 'tx-strike':
      case 'tx-underline': {
        const surface = this.a.editing.editSurface();
        if (!surface) return;
        execMark(
          surface,
          id === 'tx-bold' ? 'bold' : id === 'tx-italic' ? 'italic' : id === 'tx-strike' ? 'strikeThrough' : 'underline',
        );
        break;
      }
      case 'tx-code': {
        const surface = this.a.editing.editSurface();
        if (surface) toggleInlineCode(surface);
        break;
      }
      case 'tx-bullet':
      case 'tx-numbered': {
        const surface = this.a.editing.editSurface();
        if (surface) toggleList(surface, id === 'tx-bullet' ? 'ul' : 'ol');
        break;
      }
      case 'tx-center': {
        const surface = this.a.editing.editSurface();
        if (surface) toggleCenter(surface);
        break;
      }
      case 'tx-link':
        if (this.a.editingId) this.a.editing.openLinkPopupFor(this.a.editingId);
        break;
      case 'due': {
        const el = this.a.editing.editingEl();
        const view = el ? this.a.layer.view(el.id) : undefined;
        if (view instanceof TodoCard) {
          const iid = view.focusedItemId();
          if (iid) view.openDueFor(iid);
        }
        break;
      }
      case 'assign': {
        const el = this.a.editing.editingEl();
        const view = el ? this.a.layer.view(el.id) : undefined;
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
        this.a.overlays.startLabelEdit(sel[0]!.id);
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
        if (ref) this.a.panels.iconPickerFor(ref, anchor);
        break;
      }
      case 'rename':
        this.a.editing.beginEdit(sel[0]!.id, undefined, 'title');
        break;
      case 'caption':
        this.a.editing.beginEdit(sel[0]!.id, undefined, 'caption');
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
          this.a.store.dispatch({
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


  // Right-click an element: select it (or keep it inside the current
  // selection) and offer its rail tools plus the More items as one flat
  // icon list anchored at the pointer. Cards, comment pins, annotation
  // ink and lines count; bare canvas just keeps the browser menu off.
  contextMenu(e: MouseEvent) {
    if (this.a.lockedView()) return;
    // Touch long-press reports pointerType 'touch': opening the sheet
    // mid-gesture would also trigger beginEdit on the pointer's release,
    // so touch keeps long-press meaning nothing (marquee lives on the
    // background path instead).
    if ('pointerType' in e && e.pointerType === 'touch') return;
    const target = e.target as HTMLElement;
    let id = this.a.cardIdAt(e);
    if (!id) {
      const hitEl = target.closest?.('.comment-pin, svg.anno');
      if (hitEl instanceof HTMLElement || hitEl instanceof SVGElement) {
        id = (hitEl as HTMLElement).dataset.id ?? null;
      }
    }
    if (!id) {
      const hit = this.a.lineHit(this.a.boardPoint(e));
      if (hit) id = hit.id;
    }
    if (!id) return;
    if (!this.a.sel.has(id)) this.a.selectOnly(id);
    const sel = this.a.selectedEls();
    if (!sel.length) return;
    // Nested popups (colour, labels, submenus) re-anchor to the pointer
    // spot: the DOMRect stays valid after the menu itself closes.
    const rect = new DOMRect(e.clientX, e.clientY, 0, 0);
    const items: MenuItem[] = [
      ...toolMenuItems(sel).map((tool) => ({
        label: tool.label,
        icon: tool.icon,
        onPick: () => this.onTool(tool.id, rect),
      })),
      ...this.moreItems(sel),
    ];
    if (items.length) openMenuPopup(rect, items);
  }


  // The TableCard for the element being edited, when a cell is focused.
  tableView(): TableCard | null {
    const el = this.a.editing.editingEl();
    const v = el ? this.a.layer.view(el.id) : undefined;
    return v instanceof TableCard ? v : null;
  }


  cellMoreItems(v: TableCard): MenuItem[] {
    const f = v.focusedCell();
    if (!f) return [];
    return [
      { label: t('addRowAbove'), icon: ICONS.addRow, hint: 'Opt+Up', onPick: () => v.insertRow(f.r) },
      { label: t('addColLeft'), icon: ICONS.addCol, hint: 'Opt+Left', onPick: () => v.insertColumn(f.c) },
      { label: t('addRowBelow'), icon: ICONS.addRow, hint: 'Opt+Down', onPick: () => v.insertRow(f.r + 1) },
      { label: t('addColRight'), icon: ICONS.addCol, hint: 'Opt+Right', onPick: () => v.insertColumn(f.c + 1) },
      { label: t('clearCell'), icon: ICONS.eraser, onPick: () => v.clearFocusedCell() },
      { label: t('deleteRow'), icon: ICONS.trash, onPick: () => v.deleteFocusedRow() },
      { label: t('deleteCol'), icon: ICONS.trash, onPick: () => v.deleteFocusedColumn() },
    ];
  }

  // Native color wells fire 'input' continuously; a short-lived undo
  // group collapses a whole scrub into one history entry.
  private colorTimer = 0;

  colorBurst(fn: () => void) {
    if (!this.colorTimer) this.a.store.beginGroup();
    clearTimeout(this.colorTimer);
    this.colorTimer = window.setTimeout(() => {
      this.colorTimer = 0;
      this.a.store.endGroup('color');
    }, 400);
    fn();
  }


  setColor(color: string | undefined) {
    this.colorBurst(() => {
      const actions: Action[] = this.a.selectedEls().map((e) => ({
        type: 'element.patch',
        id: e.id,
        patch: { color },
      }));
      if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
    });
  }


  boardLabels(): Label[] {
    return Object.values(this.a.doc.labels)
      .filter((l) => l.boardId === this.a.boardId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }


  labelTargets(): Element[] {
    return this.a.selectedEls().filter((e) => e.type !== 'line');
  }


  labelApplied(lid: ID): 'all' | 'some' | 'none' {
    const els = this.labelTargets();
    if (!els.length) return 'none';
    const n = els.filter((e) => e.labels.includes(lid)).length;
    return n === 0 ? 'none' : n === els.length ? 'all' : 'some';
  }


  toggleLabel(lid: ID) {
    const apply = this.labelApplied(lid) !== 'all';
    const actions: Action[] = this.labelTargets().map((e) => ({
      type: 'element.patch',
      id: e.id,
      patch: {
        labels: apply ? (e.labels.includes(lid) ? e.labels : [...e.labels, lid]) : e.labels.filter((l) => l !== lid),
      },
    }));
    if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
  }


  createLabel(name: string) {
    if (!this.a.boardId) return;
    const color = LABEL_COLORS[this.boardLabels().length % LABEL_COLORS.length]!;
    const label = createLabel(this.a.boardId, name, color);
    const actions: Action[] = [{ type: 'label.create', label }];
    for (const e of this.labelTargets()) {
      actions.push({ type: 'element.patch', id: e.id, patch: { labels: [...e.labels, label.id] } });
    }
    this.a.store.dispatch({ type: 'batch', actions });
  }


  deleteLabel(lid: ID) {
    const label = this.a.doc.labels[lid];
    if (!label) return;
    const actions: Action[] = [{ type: 'label.delete', label }];
    for (const e of Object.values(this.a.doc.elements)) {
      if (e.labels.includes(lid)) {
        actions.push({ type: 'element.patch', id: e.id, patch: { labels: e.labels.filter((l) => l !== lid) } });
      }
    }
    this.a.store.dispatch({ type: 'batch', actions });
  }


  activeReactions(): Set<string> {
    const els = this.labelTargets();
    if (!els.length) return new Set();
    const out = new Set(els[0]!.reactions ?? []);
    for (const e of els.slice(1)) {
      for (const r of [...out]) if (!(e.reactions ?? []).includes(r)) out.delete(r);
    }
    return out;
  }


  toggleReaction(emoji: string) {
    const on = !this.activeReactions().has(emoji);
    const actions: Action[] = this.labelTargets().map((e) => {
      const cur = e.reactions ?? [];
      const has = cur.includes(emoji);
      const next = on ? (has ? cur : [...cur, emoji]) : cur.filter((r) => r !== emoji);
      return { type: 'element.patch' as const, id: e.id, patch: { reactions: next.length ? next : undefined } };
    });
    if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
  }


  addCommentTo(cardId: ID, anchorOverride?: HTMLElement) {
    const anchor = this.a.doc.elements[cardId];
    if (!anchor || !this.a.boardId) return;
    const r = this.a.layer.rectOf(anchor);
    const el = createComment(this.a.doc, this.a.boardId, Math.round(r.x + r.w + 24), Math.round(r.y), cardId);
    this.a.store.dispatch({ type: 'element.create', el });
    this.a.selectOnly(el.id);
    const s = this.a.vp.toScreen(r.x + r.w, r.y);
    this.a.comments.openThread(el.id, anchorOverride ?? new DOMRect(s.x - 12, s.y - 12, 24, 24));
  }


  titleTool(el: Element) {
    if (el.type === 'todo') {
      const c = todoDoc(el);
      if (c) {
        this.a.store.dispatch({
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
        this.a.store.dispatch({
          type: 'element.patch',
          id: el.id,
          patch: { content: { heading: { ...c, level: c.level === 1 ? 2 : 1 } } },
        });
      }
      return;
    }
    if (el.type === 'table') {
      this.a.editing.beginEdit(el.id, undefined, 'title');
      return;
    }
    this.a.editing.beginEdit(el.id);
  }


  moreItems(sel: Element[]): MenuItem[] {
    const items: MenuItem[] = [];
    // An anchored comment renders only as a pin: lock/z-order/file are
    // no-ops, so the menu offers just the detach back to a free card.
    if (sel.length === 1 && sel[0]!.type === 'comment' && sel[0]!.anchorId !== undefined) {
      const el = sel[0]!;
      return [
        {
          label: t('detachComment'),
          icon: ICONS.comment,
          onPick: () => {
            const r = this.a.layer.rectOf(el);
            this.a.store.dispatch({
              type: 'element.patch',
              id: el.id,
              patch: { anchorId: undefined, x: Math.round(r.x + r.w + 12), y: Math.round(r.y) },
            });
          },
        },
      ];
    }
    if (sel.length > 1) items.push({ label: t('connectLines'), icon: ICONS.line, onPick: () => this.connectSel() });
    if (sel.length === 1) {
      const el = sel[0]!;
      const c = el.content;
      if (('link' in c && c.link.url) || ('embed' in c && c.embed.url)) {
        const url = 'link' in c ? c.link.url : 'embed' in c ? c.embed.url : '';
        items.push({ label: t('copyLink'), icon: ICONS.copy, onPick: () => void copyTextToClipboard(url) });
      }
      if ('image' in c) {
        items.push(
          { label: t('downloadOriginal'), icon: ICONS.download, onPick: () => void downloadBlobRef(c.image.blobRef, c.image.name || 'image') },
          { label: t('replaceImage'), icon: ICONS.image, onPick: () => this.a.replaceImage(el) },
          { label: t('cropToGrid'), icon: ICONS.crop, onPick: () => void this.a.cropImageToGrid(el) },
        );
      }
      if ('file' in c) {
        items.push(
          { label: t('downloadFile'), icon: ICONS.download, onPick: () => void downloadBlobRef(c.file.blobRef, c.file.name) },
          {
            label: t('openFile'),
            icon: ICONS.ext,
            // window.open inside .then is popup-blocked: open the blank
            // window inside the gesture, then navigate it to the blob
            // URL ('noopener' would return a null handle here).
            onPick: () => {
              const w = window.open('', '_blank');
              void blobUrl(c.file.blobRef).then((u) => {
                if (u && w) w.location.href = u;
                else w?.close();
              });
            },
          },
        );
      }
      if ('note' in c) {
        items.push({ label: t('convertToDocument'), icon: ICONS.document, onPick: () => this.convertToDocument(el) });
      }
      if (el.syncGroup) {
        items.push({
          label: t('unlinkCopy'),
          icon: ICONS.unlink,
          onPick: () => this.a.store.dispatch({ type: 'element.patch', id: el.id, patch: { syncGroup: undefined } }),
        });
      }
      if ('document' in c) {
        items.push({ label: t('convertToNote'), icon: ICONS.note, onPick: () => this.convertToNote(el) });
      }
      if ('annotation' in c) {
        items.push(
          { label: t('downloadSvg'), icon: ICONS.download, onPick: () => this.downloadAnnotation(el) },
          { label: t('convertToSketch'), icon: ICONS.sketch, onPick: () => this.convertToSketch(el) },
        );
      }
      if ('boardRef' in c) {
        const ref = c.boardRef;
        items.push(
          { label: t('openNewTab'), icon: ICONS.ext, onPick: () => window.open(this.a.boardUrl(ref), '_blank', 'noopener') },
          { label: t('copyLinkBoard'), icon: ICONS.copy, onPick: () => void copyTextToClipboard(this.a.boardUrl(ref)) },
          { label: t('createShortcut'), icon: ICONS.board, onPick: () => this.a.panels.createShortcut(el) },
          { label: t('convertToTemplate'), icon: ICONS.template, onPick: () => this.a.panels.saveAsTemplate(ref) },
        );
      }
    }
    const allLocked = sel.every((e) => e.locked);
    items.push(
      { label: t('lockPosition'), icon: ICONS.lock, checked: allLocked, onPick: () => this.toggleLock(!allLocked) },
      { label: t('bringToFront'), icon: ICONS.bringFront, onPick: () => this.zOrder('front') },
      { label: t('sendToBack'), icon: ICONS.sendBack, onPick: () => this.zOrder('back') },
    );
    // Keyboard/discoverability parity for the Opt+` filing shortcut.
    if (this.a.movableCards().length) {
      items.push({ label: t('sendToUnsorted'), icon: ICONS.inbox, onPick: () => this.a.panels.fileToUnsorted() });
    }
    return items;
  }


  toggleLock(locked: boolean) {
    const actions: Action[] = this.a.selectedEls().map((e) => ({
      type: 'element.patch',
      id: e.id,
      patch: { locked },
    }));
    if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
  }


  zOrder(dir: 'front' | 'back') {
    if (this.a.lockedView()) return;
    const els = [...this.a.selectedEls()].sort((a, b) => a.z - b.z);
    if (!els.length) return;
    let actions: Action[];
    if (dir === 'front') {
      actions = els.map((e) => ({ type: 'element.patch' as const, id: e.id, patch: { z: nextZ(this.a.doc) } }));
    } else {
      const min = Math.min(...this.a.layer.elements().map((e) => e.z));
      actions = els.map((e, i) => ({
        type: 'element.patch' as const,
        id: e.id,
        patch: { z: min - els.length + i },
      }));
    }
    this.a.store.dispatch({ type: 'batch', actions });
  }


  alignSel(mode: 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom') {
    const els = this.a.movableCards().filter((e) => !e.locked);
    if (els.length < 2) return;
    const rects = new Map(els.map((e) => [e.id, this.a.layer.rectOf(e)]));
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
    this.a.store.dispatch({ type: 'batch', actions });
  }


  distributeSel(axis: 'h' | 'v') {
    const els = this.a.movableCards().filter((e) => !e.locked);
    if (els.length < 3) return;
    const rects = new Map(els.map((e) => [e.id, this.a.layer.rectOf(e)]));
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
    this.a.store.dispatch({ type: 'batch', actions });
  }


  connectSel() {
    const els = this.a.movableCards();
    if (els.length < 2 || !this.a.boardId) return;
    const sorted = [...els].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const actions: Action[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const ra = this.a.layer.rectOf(sorted[i]!);
      const rb = this.a.layer.rectOf(sorted[i + 1]!);
      const line = createLine(
        this.a.doc,
        this.a.boardId,
        { el: sorted[i]!.id, x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 },
        { el: sorted[i + 1]!.id, x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 },
      );
      actions.push({ type: 'element.create', el: line });
    }
    this.a.store.dispatch({ type: 'batch', actions });
  }


  cycleMarker(el: Element, which: 'from' | 'to') {
    const c = lineDoc(el);
    if (!c) return;
    const cur = which === 'from' ? c.fromMarker : c.toMarker;
    const next: LineMarker = cur === 'none' ? 'arrow' : cur === 'arrow' ? 'dot' : 'none';
    this.a.store.dispatch({
      type: 'element.patch',
      id: el.id,
      patch: {
        content: { line: which === 'from' ? { ...c, fromMarker: next } : { ...c, toMarker: next } },
      },
    });
  }


  toggleDashed(el: Element) {
    const c = lineDoc(el);
    if (!c) return;
    this.a.store.dispatch({
      type: 'element.patch',
      id: el.id,
      patch: { content: { line: { ...c, dashed: !c.dashed } } },
    });
  }


  weightItems(el: Element): MenuItem[] {
    const c = lineDoc(el);
    const set = (weight: LineWeight) => {
      if (this.a.lockedView()) return;
      const e = this.a.doc.elements[el.id];
      const cur = e ? lineDoc(e) : null;
      if (!cur) return;
      this.a.store.dispatch({
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


  toggleShowValue(el: Element) {
    const c = swatchDoc(el);
    if (!c) return;
    this.a.store.dispatch({
      type: 'element.patch',
      id: el.id,
      patch: { content: { swatch: { ...c, showValue: !c.showValue } } },
    });
  }


  togglePreview(el: Element) {
    const c = el.content;
    if ('link' in c) {
      this.a.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: { content: { link: { ...c.link, showPreview: !c.link.showPreview } } },
      });
    } else if ('embed' in c) {
      this.a.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: { content: { embed: { ...c.embed, showPreview: !c.embed.showPreview } } },
      });
    }
  }


  // Column -> nested board: members re-file to the new board, the column
  // is replaced by a board card in place. One batch, one undo.
  convertColumn(el: Element) {
    if (el.type !== 'column' || !this.a.boardId) return;
    const members = this.a.layer.members(el.id);
    // Nested members (a column inside the column) ride along: their
    // boardId has to move with the parent or they vanish from both boards.
    const memberIds = new Set(members.map((m) => m.id));
    const nested: Element[] = [];
    const collect = (id: ID) => {
      for (const m of this.a.layer.members(id)) {
        if (memberIds.has(m.id)) continue;
        memberIds.add(m.id);
        nested.push(m);
        collect(m.id);
      }
    };
    for (const m of members) collect(m.id);
    // Lines pinned to members would point into the child board: detach
    // to their resolved spot. Comment pins follow their member instead.
    const memberPins = Object.values(this.a.doc.elements).filter(
      (e) => e.type === 'comment' && e.anchorId !== undefined && memberIds.has(e.anchorId),
    );
    const board = createBoard({ parentId: this.a.boardId, title: columnTitle(el) || t('untitled') });
    const card = createBoardCard(this.a.doc, this.a.boardId, board.id, el.x, el.y);
    // The child board starts with no labels and owns no syncGroups:
    // clear refs that would dangle there, and drop a comment's
    // anchorId when its anchor is not moving with it.
    const movePatch = (m: Element): ElementPatch => {
      const p: ElementPatch = { boardId: board.id, labels: [] };
      if (m.syncGroup !== undefined) p.syncGroup = undefined;
      if (m.anchorId !== undefined && !memberIds.has(m.anchorId)) p.anchorId = undefined;
      return p;
    };
    const actions: Action[] = [
      { type: 'board.create', board },
      { type: 'element.create', el: card },
      ...this.a.retargetAttachActions(el.id, card.id),
      ...this.a.detachLineActions(memberIds),
      ...memberPins.map(
        (c): Action => ({ type: 'element.patch', id: c.id, patch: movePatch(c) }),
      ),
      ...members.map(
        (m, i): Action => ({
          type: 'element.patch',
          id: m.id,
          patch: { ...movePatch(m), parentId: null, x: 80 + (i % 4) * 280, y: 80 + Math.floor(i / 4) * 200 },
        }),
      ),
      ...nested.map((m): Action => ({ type: 'element.patch', id: m.id, patch: movePatch(m) })),
      { type: 'element.delete', el },
    ];
    this.a.store.dispatch({ type: 'batch', actions });
    this.a.sel.delete(el.id);
    this.a.sel.add(card.id);
    this.a.requestRender();
  }


  // Converts carry the card's frame fields onto the replacement:
  // position, lock, colour, labels and reactions survive the type swap.
  private carryCardFields(src: Element, dst: Element) {
    dst.z = src.z;
    dst.parentId = src.parentId;
    dst.locked = src.locked;
    if (src.color !== undefined) dst.color = src.color;
    dst.labels = [...src.labels];
    if (src.reactions) dst.reactions = [...src.reactions];
  }

  // The convert batch: create the replacement, retarget lines and
  // comment anchors onto it, delete the original. One undo entry.
  private replaceElementActions(src: Element, dst: Element): Action[] {
    return [
      { type: 'element.create', el: dst },
      ...this.a.retargetAttachActions(src.id, dst.id),
      { type: 'element.delete', el: src },
    ];
  }


  // Note -> Document: the note's text/html becomes the doc body, the
  // card swaps type in place. One batch, one undo.
  convertToDocument(el: Element) {
    if (!('note' in el.content) || !this.a.boardId) return;
    const n = el.content.note;
    const doc = createDocument(this.a.doc, this.a.boardId, el.x, el.y);
    if (el.w !== undefined) doc.w = el.w;
    this.carryCardFields(el, doc);
    doc.content = {
      document: {
        title: '',
        text: n.text,
        ...(n.html !== undefined ? { html: n.html } : {}),
        displayMode: 'detail',
        caption: '',
      },
    };
    this.a.store.dispatch({ type: 'batch', actions: this.replaceElementActions(el, doc) });
    this.a.setSelection([doc.id]);
  }


  // Document -> Note: the doc body becomes note text/html, same swap.
  convertToNote(el: Element) {
    const c = documentDoc(el);
    if (!c || !this.a.boardId) return;
    // The doc title has no note field: fold it into the body (text and
    // html) so it survives the swap.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const text = c.title ? `${c.title}\n${c.text}` : c.text;
    const html = c.title && c.html !== undefined ? `<h1>${esc(c.title)}</h1>${c.html}` : c.html;
    const note = createNote(this.a.doc, this.a.boardId, el.x, el.y, text);
    if (el.w !== undefined) note.w = el.w;
    this.carryCardFields(el, note);
    note.content = { note: html !== undefined ? { text, html } : { text } };
    this.a.store.dispatch({ type: 'batch', actions: this.replaceElementActions(el, note) });
    this.a.setSelection([note.id]);
  }


  downloadAnnotation(el: Element) {
    const c = annotationDoc(el);
    if (!c) return;
    downloadTextFile('annotation.svg', strokesToSvgFile(c.strokes), 'image/svg+xml');
  }


  // Annotation -> Sketch card: board-space strokes are rescaled into the
  // sketch pad's fixed 600x450 space, centered. One batch.
  convertToSketch(el: Element) {
    const c = annotationDoc(el);
    if (!c || !this.a.boardId) return;
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
    const sk = createSketch(this.a.doc, this.a.boardId, el.x, el.y);
    sk.w = Math.max(el.w ?? 0, 220);
    this.carryCardFields(el, sk);
    sk.content = { sketch: { strokes } };
    this.a.store.dispatch({ type: 'batch', actions: this.replaceElementActions(el, sk) });
    this.a.setSelection([sk.id]);
  }

}
