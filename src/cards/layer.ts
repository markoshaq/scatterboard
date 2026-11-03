import type { Doc, Element as El, ID } from '../state/schema';
import { defaultWidth, UNSORTED } from '../state/schema';
import { rectsIntersect } from '../canvas/hit';
import { lineRect, resolveLine } from '../canvas/lines';
import type { Rect } from '../canvas/viewport';
import type { Viewport } from '../canvas/viewport';
import { createCard, type CardCtx } from './factory';
import type { CardEvents, CardView } from './note';
import { ColumnCard } from './column';
import { BoardIndex } from './boardindex';
import { COL_GAP, COL_PAD, colBodyTop, fallbackHeight, memberChipPad } from './measure';

// Mount/unmount margin around the viewport in board units: generous so
// fast pans never flash an empty edge.
const CULL_PAD = 240;

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
  // Per-column member-id signatures and last-seen editing flags drive
  // the dirty-check in sync: a column re-renders when its member set
  // shifts or a view's editing state flips, even with no element patch.
  private memberSigs = new Map<ID, string>();
  private editMark = new Map<ID, boolean>();
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
      members: (id) => this.members(id),
      cardCount: (bid) => this.boardCardCount(bid),
      zoom: () => this.vp.z,
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

  boardCardCount(boardId: ID): number {
    this.ensureIndex();
    return this.index.cardCount(boardId);
  }

  // Per-board element counts across the whole doc, for sig-style
  // consumers like the boards panel.
  boardCounts(): Map<ID, number> {
    this.ensureIndex();
    return this.index.boardCounts;
  }

  canvasCounts(): Map<ID, number> {
    this.ensureIndex();
    return this.index.canvasCounts;
  }

  // Column-space y where the member stack starts: the mounted column
  // reports its real .col-body offset (measured post-layout inside the
  // RO callback), everything else falls back to the head estimate.
  private colTop(col: El, w?: number): number {
    const v = this.views.get(col.id);
    if (v instanceof ColumnCard) {
      const t = v.bodyTop();
      if (t >= 0) return t;
    }
    return colBodyTop(col, w);
  }

  heightOf(el: El, w?: number): number {
    const cached = this.heights.get(el.id);
    if (cached !== undefined) return cached;
    return fallbackHeight(el, (m, mw) => this.heightOf(m, mw), (id) => this.members(id), w);
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
        let y = cr.y + this.colTop(col, cr.w);
        for (const m of this.index.members(col.id)) {
          if (m.type === 'line' || m.type === 'annotation') continue;
          const mh = this.heightOf(m, w);
          if (m.id === el.id) return { x: cr.x + COL_PAD, y, w, h: mh };
          y += mh + COL_GAP + memberChipPad(m);
        }
        return { x: cr.x + COL_PAD, y, w, h: this.heightOf(el, w) };
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

  private memberSig(id: ID): string {
    let s = '';
    for (const m of this.index.members(id)) s += `${m.id},`;
    return s;
  }

  // `dirty` names the elements touched since the last sync; undefined
  // means every mounted view updates. Member edits mark their column,
  // and column member-set changes are caught by the sig diff, so
  // viewport-only frames skip update() on untouched cards entirely.
  sync(selection: Set<ID>, editingId: ID | null, locked = false, dirty?: Set<ID>) {
    const all = dirty === undefined;
    let d: Set<ID> | null = null;
    if (!all) {
      d = new Set(dirty);
      for (const id of dirty) {
        const p = this.doc.elements[id]?.parentId;
        if (p) d.add(p);
      }
    }
    const visible = this.vp.viewRect(CULL_PAD);
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
        this.memberSigs.delete(id);
        this.editMark.delete(id);
        view.destroy();
        this.views.delete(id);
      }
    }
    for (const el of els) {
      if (!wanted.has(el.id)) continue;
      let view = this.views.get(el.id);
      const fresh = !view;
      if (!view) {
        view = createCard(el, this.ctx);
        this.views.set(el.id, view);
        this.flat.set(el.id, view);
        this.node.appendChild(view.node);
      }
      const ed = !!view.editing;
      let need = all || !!d!.has(el.id) || ed || this.editMark.get(el.id) !== ed;
      if (el.type === 'column') {
        const sig = this.memberSig(el.id);
        if (sig !== this.memberSigs.get(el.id)) {
          this.memberSigs.set(el.id, sig);
          if (!fresh) need = true;
        }
      }
      if (need && !fresh) view.update(el);
      this.editMark.set(el.id, ed);
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
