import type { App } from '../app';
import { annotationDoc, commentDoc, lineDoc, strokesBBoxCached, UNSORTED, type Element, type ID } from '../state/schema';
import type { Rect } from '../canvas/viewport';
import { pointInRect, rectsIntersect } from '../canvas/hit';
import { midpoint } from '../canvas/lines';
import type { SceneLine } from '../canvas/renderer';
import { ChipsLayer } from '../ui/chips';
import { CommentPins } from '../ui/pins';
import { ColumnCard } from '../cards/column';
import { AnnotationLayer } from '../ui/annotations';
import { startElementDrag } from '../canvas/input';
import { t } from '../strings';

// Overlay cull pads in board units: cards cull at 240 but affordances
// anchored near the view edge can afford a tighter pad.
const CHIP_PAD = 120;
const PIN_PAD = 60;
const ANNO_PAD = 60;

// Line label pills, label/reaction chips, comment pins, annotation svgs
// and the connect handle. All re-synced every render; each sync culls
// to the viewport and skips layout reads so the pass stays cheap.
export class Overlays {
  readonly chips: ChipsLayer;

  readonly pins: CommentPins;

  readonly anno: AnnotationLayer;

  readonly connectHandle: HTMLElement;

  readonly labelHost: HTMLElement;

  private labelPills = new Map<ID, HTMLElement>();

  private editingLabelId: ID | null = null;

  constructor(private a: App) {
    this.anno = new AnnotationLayer((id, e) => this.onAnnoPick(id, e));
    this.labelHost = document.createElement('div');
    this.labelHost.className = 'line-labels';
    this.connectHandle = document.createElement('div');
    this.connectHandle.className = 'connect-handle';
    this.connectHandle.innerHTML = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 5h5M5.5 2.8 7.7 5 5.5 7.2"/></svg>`;
    this.connectHandle.style.display = 'none';
    this.connectHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = this.connectHandle.dataset.id;
      if (id) this.a.startConnect(id, e);
    });
    this.chips = new ChipsLayer(a.doc, {
      onChip: (id, kind, chip) => {
        if (this.a.lockedView()) return;
        // Chip clicks act like the rail tools: the card joins the
        // selection unless it already is, then the same popups open.
        // Swallowed pointerdown skips onDown's endEdit, so end any
        // open edit session first (same as pin clicks).
        this.a.editing.endEdit();
        if (!this.a.sel.has(id)) this.a.selectOnly(id);
        this.a.tools.onTool(kind === 'label' ? 'labels' : 'reactions', chip);
      },
    });
    this.pins = new CommentPins((id, pinEl) => this.onPinClick(id, pinEl));
    a.docEl.append(this.anno.node, this.labelHost, this.connectHandle, this.chips.node, this.pins.node);
  }


  // --- label pills ---

  // all=true skips the midpoint cull for the export snapshot.
  syncLabelPills(lines: SceneLine[], all = false) {
    const seen = new Set<ID>();
    const view = all ? null : this.a.vp.viewRect(0);
    for (const l of lines) {
      const c = lineDoc(l.el);
      if (!c) continue;
      const editing = this.editingLabelId === l.el.id;
      if (!c.label && !editing) continue;
      const m = midpoint(l);
      // The pill sits at the line midpoint: an offscreen midpoint means
      // an offscreen pill, so unmount it like a culled card. An
      // in-flight edit stays mounted even when scrolled out.
      if (!editing && view && !pointInRect(m.x, m.y, view)) continue;
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
          this.a.editing.endEdit();
          this.a.selectOnly(lid);
        });
        pill.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.startLabelEdit(lid);
        });
        // The commit reads dataset.text, not innerText: typing writes
        // it here so the sync path never does a layout read.
        pill.addEventListener('input', (e) => {
          const p = e.currentTarget as HTMLElement;
          p.dataset.text = p.innerText;
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
      pill.style.left = `${m.x}px`;
      pill.style.top = `${m.y}px`;
      pill.classList.toggle('present-dim', !!l.dim);
      // Lines paint under cards; a label whose midpoint is card-covered
      // floats detached on the covering card and steals its clicks.
      pill.classList.toggle('covered', !editing && this.coveredByCard(m.x, m.y));
      if (editing) {
        if (pill.contentEditable !== 'true') {
          pill.dataset.text = c.label;
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
    if (this.a.lockedView()) return;
    const el = this.a.doc.elements[id];
    if (el?.type !== 'line') return;
    this.a.editing.endEdit();
    this.a.selectOnly(id);
    this.editingLabelId = id;
    this.a.requestRender();
  }


  commitLabelEdit(id: ID | null = this.editingLabelId) {
    const pill = id ? this.labelPills.get(id) : undefined;
    const el = id ? this.a.doc.elements[id] : undefined;
    this.editingLabelId = null;
    if (!id || !pill || !el) return;
    const c = lineDoc(el);
    const text = (pill.dataset.text ?? '').replace(/\n/g, ' ').trim();
    if (c && c.label !== text) {
      const content = { line: { ...c, label: text } };
      // Blur and pill unmount reach this from inside the overlay sync
      // pass: defer the patch so dispatch never re-enters render. The
      // lock re-check lives inside the task: present mode may have
      // engaged between blur and dispatch.
      queueMicrotask(() => {
        if (!this.a.lockedView()) this.a.store.dispatch({ type: 'element.patch', id, patch: { content } });
      });
    }
    this.a.requestRender();
  }


  // --- chips ---

  // Cards the chips overlay can sit under: canvas cards + column members
  // on this board, minus anchored comments (those render as pins).
  // all=true skips the viewport cull for the export snapshot (pass the
  // staging layer so member rects come from its mounted views).
  chipTargets(all = false, layer = this.a.layer): { el: Element; rect: Rect; dim?: boolean }[] {
    const visible = all ? null : this.a.vp.viewRect(CHIP_PAD);
    const out: { el: Element; rect: Rect; dim?: boolean }[] = [];
    const hideComments = this.a.presenting && !!this.a.board()?.presentOpts?.comments;
    const push = (el: Element) => {
      if (el.type === 'line') return;
      if (el.type === 'comment' && (el.anchorId !== undefined || hideComments)) return;
      const r0 = layer.rectOf(el);
      // A member mid-reorder rides the pointer: rectOf reports the open
      // slot, so seat the row on the lifted position instead.
      const lift = this.a.gestures.liftDelta(el.id);
      const rect = lift ? { x: r0.x + lift.dx, y: r0.y + lift.dy, w: r0.w, h: r0.h } : r0;
      if (!visible || rectsIntersect(rect, visible)) out.push({ el, rect, dim: this.a.dims(el.id) });
    };
    const lift = this.a.gestures.liftMember();
    for (const el of layer.elements()) {
      push(el);
      // Culled-column members report a stale pre-filing x/y; skip them.
      // A member mid-reorder occludes its siblings: their chips hide
      // rather than float above the card riding the pointer.
      if (el.type === 'column')
        for (const m of layer.members(el.id)) {
          if (lift && lift.colId === el.id && m.id !== lift.memberId) continue;
          if (all || layer.view(m.id)) push(m);
        }
    }
    return out;
  }


  // Member-attached lines: the board-canvas stroke hides under the
  // column's opaque surface, so each mounted column re-strokes the
  // inside span inside its own box, under the member stack.
  private syncColumnLines(lines: SceneLine[]) {
    for (const v of this.a.layer.mounted()) {
      if (!(v instanceof ColumnCard)) continue;
      const col = this.a.doc.elements[v.id];
      if (!col) continue;
      const rect = this.a.layer.rectOf(col);
      const inside: SceneLine[] = [];
      for (const l of lines) {
        const c = lineDoc(l.el);
        if (!c) continue;
        const memberEnd = [c.from, c.to].some((end) => end.el && this.a.doc.elements[end.el]?.parentId === col.id);
        if (memberEnd) inside.push(l);
      }
      v.setLineSpans(rect, inside);
    }
  }


  private syncChips() {
    this.chips.sync(this.chipTargets(), (id) => {
      const el = this.a.doc.elements[id];
      if (!el) return null;
      // Member rows seat after their column: .cards shares board space,
      // and cards above the column (a drag mid-air included) cover the
      // chips like they cover the members.
      return this.a.layer.view(el.parentId ?? id)?.node ?? null;
    });
  }


  // --- comment pins ---

  // all=true skips the viewport cull for the export snapshot.
  pinItems(layer = this.a.layer, all = false) {
    const out: {
      id: ID;
      rect: Rect;
      count: number;
      selected: boolean;
      unread: number;
      color: string | undefined;
      seat: HTMLElement | null;
    }[] = [];
    const visible = all ? null : this.a.vp.viewRect(PIN_PAD);
    const lifted = this.a.gestures.liftMember();
    for (const el of layer.elements()) {
      if (el.type !== 'comment' || el.anchorId === undefined) continue;
      const anchor = this.a.doc.elements[el.anchorId];
      if (!anchor || anchor.parentId === UNSORTED) continue;
      // Member anchors use a DOM rect: an unmounted column member would
      // report its stale pre-filing x/y and leave an orphan pin.
      if (anchor.parentId && !layer.view(anchor.id)) continue;
      if (lifted && anchor.parentId === lifted.colId && anchor.id !== lifted.memberId) continue;
      const r0 = layer.rectOf(anchor);
      const lift = this.a.gestures.liftDelta(anchor.id);
      const rect = lift ? { x: r0.x + lift.dx, y: r0.y + lift.dy, w: r0.w, h: r0.h } : r0;
      if (visible && !rectsIntersect(rect, visible)) continue;
      const c = commentDoc(el);
      const count = c?.items.length ?? 0;
      const seen = this.a.prefs.commentSeen?.[el.id] ?? 0;
      out.push({
        id: el.id,
        rect,
        count,
        selected: this.a.sel.has(el.id),
        unread: Math.max(0, count - seen),
        color: el.color,
        // Seated after the anchor card so covering cards hide the pin;
        // member anchors seat after their column for the same reason.
        seat: layer.view(anchor.parentId ?? anchor.id)?.node ?? null,
      });
    }
    return out;
  }


  syncPins() {
    this.pins.sync(this.pinItems());
  }


  private onPinClick(id: ID, pinEl: HTMLElement) {
    this.a.editing.endEdit();
    this.a.selectOnly(id);
    this.a.comments.openThread(id, pinEl);
  }


  // --- annotations ---

  // all=true skips the viewport cull for the export snapshot.
  annoItems(all = false) {
    const visible = all ? null : this.a.vp.viewRect(ANNO_PAD);
    const out: { el: Element; selected: boolean; dim?: boolean }[] = [];
    for (const e of this.a.layer.elements()) {
      if (e.type !== 'annotation') continue;
      if (visible) {
        const c = annotationDoc(e);
        if (!c) continue;
        const b = strokesBBoxCached(c.strokes);
        const r = { x: e.x + b.x, y: e.y + b.y, w: Math.max(1, b.w), h: Math.max(1, b.h) };
        if (!rectsIntersect(r, visible)) continue;
      }
      out.push({ el: e, selected: this.a.sel.has(e.id), dim: this.a.dims(e.id) });
    }
    return out;
  }


  syncAnno() {
    // Seat each svg before the lowest card above it so ink honours el.z;
    // the host fallback paints above all cards (topmost annotation).
    const els = this.a.layer.elements();
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
        const v = this.a.layer.view(e.id);
        if (v) return v.node;
      }
      return null;
    });
  }


  private onAnnoPick(id: ID, e: PointerEvent) {
    this.a.editing.endEdit();
    startElementDrag(e, this.a, id);
  }


  // --- connect handle + occlusion ---

  syncConnectHandle() {
    const id = this.a.sel.size === 1 ? [...this.a.sel][0]! : null;
    const el = id ? this.a.doc.elements[id] : undefined;
    if (
      !el ||
      el.type === 'line' ||
      el.type === 'comment' ||
      this.a.editingId ||
      el.locked ||
      this.a.lockedView() ||
      this.a.gestures.dragging
    ) {
      this.connectHandle.style.display = 'none';
      return;
    }
    const r = this.a.layer.rectOf(el);
    // The handle is counter-scaled (~16 screen px, offset 2px right of
    // the edge); hide it when a covering card would make it float.
    const hx = r.x + r.w + 10 / this.a.vp.z;
    const hy = r.y + r.h / 2;
    if (pointInRect(hx, hy, this.a.vp.viewRect(0)) && this.coveredByCard(hx, hy, el.id)) {
      this.connectHandle.style.display = 'none';
      return;
    }
    this.connectHandle.style.display = 'flex';
    this.connectHandle.style.left = `${r.x + r.w}px`;
    this.connectHandle.style.top = `${r.y + r.h / 2}px`;
    this.connectHandle.dataset.id = el.id;
  }


  // Whether a card covers a board point. Lines/labels/handles use it to
  // hide affordances whose anchor is occluded (they draw under or over
  // the card layer). `excludeId`'s own ancestors don't count as cover.
  private coveredByCard(x: number, y: number, excludeId?: ID): boolean {
    // Only mounted cards can occlude on-screen: unmounted ones are
    // off-canvas or nested inside a column (which covers them anyway).
    for (const v of this.a.layer.mounted()) {
      const e = this.a.doc.elements[v.id];
      if (!e || e.id === excludeId) continue;
      if (e.type === 'comment' && e.anchorId !== undefined) continue;
      if (excludeId && this.a.hasAncestor(excludeId, e.id)) continue;
      if (pointInRect(x, y, this.a.layer.rectOf(e))) return true;
    }
    return false;
  }


  // The full per-render overlay pass.
  sync(lines: SceneLine[]) {
    this.syncConnectHandle();
    this.syncLabelPills(lines);
    this.syncColumnLines(lines);
    this.syncChips();
    this.syncPins();
    this.syncAnno();
  }
}
