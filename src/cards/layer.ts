import type { Doc, Element, ID } from '../state/schema';
import {
  annotationDoc,
  boardElements,
  columnMembers,
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

export class CardsLayer {
  node: HTMLElement;
  private doc: Doc;
  private vp: Viewport;
  private ctx: CardCtx;
  private views = new Map<ID, CardView>();
  private heights = new Map<ID, number>();
  boardId: ID | null = null;

  constructor(doc: Doc, vp: Viewport, events: CardEvents) {
    this.doc = doc;
    this.vp = vp;
    this.ctx = {
      doc,
      events: {
        ...events,
        onMeasure: (id, h) => {
          this.heights.set(id, h);
          events.onMeasure(id, h);
        },
      },
    };
    this.node = document.createElement('div');
    this.node.className = 'cards';
  }

  elements(): Element[] {
    return this.boardId ? boardElements(this.doc, this.boardId) : [];
  }

  heightOf(el: Element): number {
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
      let h = 60;
      for (const m of columnMembers(this.doc, el.id)) h += this.heightOf(m) + 8;
      return h + 8;
    }
    const text = noteText(el);
    const cpl = Math.max(8, Math.floor(((el.w ?? NOTE_W) - 28) / 7.4));
    const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
    return Math.round(26 + lines * 20.3);
  }

  rectOf(el: Element): Rect {
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
    if (el.parentId) {
      const v = this.view(el.id);
      if (v) {
        const r = v.node.getBoundingClientRect();
        const a = this.vp.toBoard(r.left, r.top);
        const b = this.vp.toBoard(r.right, r.bottom);
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      }
    }
    return { x: el.x, y: el.y, w: el.w ?? defaultWidth(el), h: this.heightOf(el) };
  }

  view(id: ID): CardView | undefined {
    const v = this.views.get(id);
    if (v) return v;
    for (const cv of this.views.values()) {
      const f = cv.findView?.(id);
      if (f) return f;
    }
    return undefined;
  }

  mountedIds(): ID[] {
    return [...this.views.keys()];
  }

  sync(selection: Set<ID>, editingId: ID | null, locked = false) {
    const visible = this.vp.viewRect(240);
    const els = this.elements();
    const wanted = new Set<ID>();
    for (const el of els) {
      if (el.type === 'line' || el.type === 'annotation') continue;
      if (el.type === 'comment' && el.anchorId !== undefined) continue;
      if (rectsIntersect(this.rectOf(el), visible)) wanted.add(el.id);
    }
    // An in-flight edit keeps its element mounted even when culled;
    // walking parents keeps a member's column alive too.
    for (let id = editingId; id; id = this.doc.elements[id]?.parentId ?? null) {
      wanted.add(id);
    }
    for (const [id, view] of this.views) {
      if (!wanted.has(id)) {
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
    for (const el of els.filter((e) => wanted.has(e.id)).sort((a, b) => a.z - b.z)) {
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
  }
}
