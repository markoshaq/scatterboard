import type { Doc, Element as El, ID } from '../state/schema';
import {
  annotationDoc,
  columnTitle,
  commentDoc,
  defaultWidth,
  documentDoc,
  embedDoc,
  headingDoc,
  imageDoc,
  linkDoc,
  noteText,
  strokesBBox,
  tableDoc,
  todoDoc,
  UNSORTED,
  DOC_W,
  LINK_W,
  NOTE_W,
  SKETCH_W,
} from '../state/schema';
import { rectsIntersect } from '../canvas/hit';
import { lineRect, resolveLine } from '../canvas/lines';
import type { Rect } from '../canvas/viewport';
import type { Viewport } from '../canvas/viewport';
import { createCard, type CardCtx } from './factory';
import type { CardEvents, CardView } from './note';
import { ColumnCard } from './column';
import { BoardIndex } from './boardindex';

// Column member geometry mirrors .card.column/.col-body in style.css:
// 10px card padding, a head row (title + member count), an 8px body
// top margin, then members stacked with 8px gaps.
const COL_PAD = 10;
const COL_COUNT_H = 18;
const COL_BODY_TOP = 8;
const COL_GAP = 8;
const COL_TITLE_MIN = 20;
const COL_TITLE_LH = 20.3;

export class CardsLayer {
  node: HTMLElement;
  private doc: Doc;
  private vp: Viewport;
  private ctx: CardCtx;
  private views = new Map<ID, CardView>();
  // Flat lookup across mounted views, column members included.
  private flat = new Map<ID, CardView>();
  // Measured heights reported by the shared ResizeObserver.
  private heights = new Map<ID, number>();
  // Board-space rects, cached until the doc rev or a measured height
  // changes (both clear the map in onResize/ensureIndex).
  private rects = new Map<ID, Rect>();
  private nodeView = new Map<HTMLElement, CardView>();
  private ro: ResizeObserver;
  private index = new BoardIndex();
  private revOf: () => number;
  boardId: ID | null = null;

  constructor(doc: Doc, vp: Viewport, events: CardEvents, revOf: () => number) {
    this.doc = doc;
    this.vp = vp;
    this.revOf = revOf;
    this.ro = new ResizeObserver((entries) => this.onResize(entries));
    this.ctx = {
      doc,
      events: {
        ...events,
        observeNode: (v) => this.observeView(v),
        unobserveNode: (v) => this.unobserveView(v),
      },
      registerView: (v) => this.flat.set(v.id, v),
      unregisterView: (v) => {
        if (this.flat.get(v.id) === v) this.flat.delete(v.id);
      },
    };
    this.node = document.createElement('div');
    this.node.className = 'cards';
  }

  // One observer for every mounted view: a mount burst produces a
  // single callback batch, and only real height changes trigger the
  // app's re-render (via events.onMeasure).
  private onResize(entries: ResizeObserverEntry[]) {
    for (const e of entries) {
      const v = this.nodeView.get(e.target as HTMLElement);
      if (!v) continue;
      const h = e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).offsetHeight;
      if (h !== this.heights.get(v.id)) {
        this.heights.set(v.id, h);
        this.rects.clear();
        this.ctx.events.onMeasure(v.id, h);
      }
      if (v instanceof ColumnCard) v.noteBodyTop();
    }
  }

  private observeView(v: CardView) {
    this.nodeView.set(v.node, v);
    this.ro.observe(v.node);
  }

  private unobserveView(v: CardView) {
    this.ro.unobserve(v.node);
    this.nodeView.delete(v.node);
  }

  private ensureIndex() {
    if (this.index.ensure(this.doc, this.boardId, this.revOf())) this.rects.clear();
  }

  elements(): El[] {
    this.ensureIndex();
    return this.index.els;
  }

  lines(): El[] {
    this.ensureIndex();
    return this.index.lines;
  }

  members(id: ID): El[] {
    this.ensureIndex();
    return this.index.members(id);
  }

  private colHeadH(el: El): number {
    const title = columnTitle(el);
    const cpl = Math.max(8, Math.floor(((el.w ?? defaultWidth(el)) - COL_PAD * 2) / 7.4));
    const lines = title.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
    return Math.max(COL_TITLE_MIN, lines * COL_TITLE_LH) + COL_COUNT_H;
  }

  // Column-space y where the member stack starts: the mounted column
  // reports its real .col-body offset (measured post-layout inside the
  // RO callback), everything else falls back to the head estimate.
  private colTop(col: El): number {
    const v = this.views.get(col.id);
    if (v instanceof ColumnCard) {
      const t = v.bodyTop();
      if (t >= 0) return t;
    }
    return COL_PAD + this.colHeadH(col) + COL_BODY_TOP;
  }

  heightOf(el: El): number {
    const cached = this.heights.get(el.id);
    if (cached !== undefined) return cached;
    if (el.type === 'board') return 64;
    if (el.type === 'swatch') return 176;
    if (el.type === 'todo') {
      const c = todoDoc(el);
      const items = c?.items.length ?? 1;
      return 20 + (c?.showTitle ? 26 : 0) + items * 27;
    }
    if (el.type === 'heading') {
      const c = headingDoc(el);
      const lh = c?.level === 2 ? 24 : 32;
      const cpl = Math.max(6, Math.floor(((el.w ?? NOTE_W) - 20) / (c?.level === 2 ? 8 : 11)));
      const lines = (c?.text ?? '')
        .split('\n')
        .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
      return 10 + Math.max(1, lines) * lh;
    }
    if (el.type === 'comment') {
      const c = commentDoc(el);
      return 56 + (c?.items.length ?? 0) * 46;
    }
    if (el.type === 'link' || el.type === 'embed') {
      const c = linkDoc(el) ?? embedDoc(el);
      if (!c?.url) return 54;
      const w = el.w ?? LINK_W;
      const hero = c.showPreview ? Math.round((w * 9) / 16) : 0;
      return hero + 62 + (c.caption ? 20 : 0);
    }
    if (el.type === 'image') {
      const c = imageDoc(el);
      const w = el.w ?? NOTE_W;
      const aspect = c?.aspect && c.aspect > 0 ? c.aspect : 1;
      return Math.round(w / aspect) + (c?.caption ? 26 : 14);
    }
    if (el.type === 'file') return 62;
    if (el.type === 'document') {
      const c = documentDoc(el);
      if (c?.displayMode !== 'detail') return 64;
      const cpl = Math.max(8, Math.floor(((el.w ?? DOC_W) - 28) / 7.4));
      const lines = (c?.text ?? '')
        .split('\n')
        .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
      return 74 + Math.min(320, lines * 20) + (c?.caption ? 22 : 0);
    }
    if (el.type === 'sketch') return Math.round((el.w ?? SKETCH_W) * 0.75) + 16;
    if (el.type === 'table') {
      const c = tableDoc(el);
      const rows = c?.cells.length ?? 4;
      return 16 + rows * 34 + (c?.title ? 26 : 0) + (c?.caption ? 22 : 0);
    }
    if (el.type === 'annotation') {
      const c = annotationDoc(el);
      return c ? Math.max(1, Math.round(strokesBBox(c.strokes).h)) : 0;
    }
    if (el.type === 'column') {
      let h = COL_PAD + this.colHeadH(el) + COL_BODY_TOP + COL_PAD;
      for (const m of this.members(el.id)) {
        if (m.type === 'line' || m.type === 'annotation') continue;
        h += this.heightOf(m) + COL_GAP;
      }
      return h;
    }
    const text = noteText(el);
    const cpl = Math.max(8, Math.floor(((el.w ?? NOTE_W) - 28) / 7.4));
    const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
    return Math.round(26 + lines * 20.3);
  }

  rectOf(el: El): Rect {
    this.ensureIndex();
    const hit = this.rects.get(el.id);
    if (hit) return hit;
    const r = this.computeRect(el);
    this.rects.set(el.id, r);
    return r;
  }

  private computeRect(el: El): Rect {
    if (el.type === 'line') {
      const l = resolveLine(el, this.doc, (t) => this.rectOf(t));
      if (l) return lineRect(l);
      return { x: el.x, y: el.y, w: 0, h: 0 };
    }
    // Anchored comments render as a pin at the anchor's top-right corner.
    if (el.type === 'comment' && el.anchorId !== undefined) {
      const anchor = this.doc.elements[el.anchorId];
      if (anchor) {
        const r = this.rectOf(anchor);
        return { x: r.x + r.w - 12, y: r.y - 12, w: 24, h: 24 };
      }
    }
    // Column members stack inside .col-body in z order: x/w come from
    // the column rect minus padding, y is the cumulative member height.
    if (el.parentId && el.parentId !== UNSORTED) {
      const col = this.doc.elements[el.parentId];
      if (col) {
        const cr = this.rectOf(col);
        const w = cr.w - COL_PAD * 2;
        let y = cr.y + this.colTop(col);
        for (const m of this.index.members(col.id)) {
          if (m.type === 'line' || m.type === 'annotation') continue;
          const mh = this.heightOf(m);
          if (m.id === el.id) return { x: cr.x + COL_PAD, y, w, h: mh };
          y += mh + COL_GAP;
        }
        return { x: cr.x + COL_PAD, y, w, h: this.heightOf(el) };
      }
    }
    return { x: el.x, y: el.y, w: el.w ?? defaultWidth(el), h: this.heightOf(el) };
  }

  view(id: ID): CardView | undefined {
    return this.flat.get(id);
  }

  // Top-level mounted views (members live inside their column view).
  mounted(): IterableIterator<CardView> {
    return this.views.values();
  }

  sync(selection: Set<ID>, editingId: ID | null, locked = false) {
    const visible = this.vp.viewRect(240);
    const els = this.elements();
    const wanted = new Set<ID>();
    for (const el of els) {
      if (el.type === 'line' || el.type === 'annotation') continue;
      if (el.type === 'comment' && el.anchorId !== undefined) continue;
      // A playing embed keeps its iframe alive off-screen: culling
      // would reload it on every pan back.
      if (rectsIntersect(this.rectOf(el), visible) || this.views.get(el.id)?.playing) wanted.add(el.id);
    }
    // An in-flight edit keeps its element mounted even when culled;
    // walking parents keeps a member's column alive too.
    for (let id = editingId; id; id = this.doc.elements[id]?.parentId ?? null) {
      wanted.add(id);
    }
    for (const [id, view] of this.views) {
      if (!wanted.has(id)) {
        this.flat.delete(id);
        view.destroy();
        this.views.delete(id);
      }
    }
    for (const el of els) {
      if (!wanted.has(el.id)) continue;
      let view = this.views.get(el.id);
      if (!view) {
        view = createCard(el, this.ctx);
        this.views.set(el.id, view);
        this.flat.set(el.id, view);
        this.node.appendChild(view.node);
      }
      view.update(el);
      view.setSelected(selection.has(el.id));
      view.setHandle(selection.size === 1 && selection.has(el.id) && editingId !== el.id && !el.locked && !locked);
      view.syncInner?.(selection, editingId);
    }
    // Paint order follows el.z; column members live inside their column
    // view, so only the layer's direct card children reorder. Seated
    // overlays (chips, pins, anno svgs) interleave between cards, so
    // only .card siblings count: moving a card every render would
    // detach it and steal DOM focus from its inputs.
    let prev: Node | null = null;
    for (const el of els) {
      if (!wanted.has(el.id)) continue;
      const node = this.views.get(el.id)!.node;
      let sib: Node | null = prev ? prev.nextSibling : this.node.firstChild;
      while (sib && !(sib instanceof Element && sib.classList.contains('card'))) sib = sib.nextSibling;
      if (sib !== node) this.node.insertBefore(node, sib);
      prev = node;
    }
  }

  destroy() {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.flat.clear();
    this.ro.disconnect();
  }
}
