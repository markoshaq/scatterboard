import type { App } from '../app';
import { defaultWidth, type Element, type ID } from '../state/schema';
import type { Action } from '../state/actions';
import { pointInRect, unionRect } from '../canvas/hit';
import type { Rect } from '../canvas/viewport';
import { snapDelta } from '../canvas/snap';
import { ColumnCard } from '../cards/column';
import { NOTE_MAX_W, NOTE_MIN_W } from '../state/schema';
export class Gestures {
  constructor(private a: App) {}

  dropColId: ID | null = null;

  // Member reorder drag-in-progress: the card is lifted onto the
  // pointer, a marker bar marks the slot, and z commits on endDrag.
  private memberReorder: { colId: ID; memberId: ID; z: number; dx: number; dy: number } | null = null;

  // Drop-slot inside the hinted column: filing lands mid-stack here
  // instead of appending at the end.
  private dropInsert: {
    colId: ID;
    beforeId: ID | null;
    prevZ: number | undefined;
    nextZ: number | undefined;
  } | null = null;

  // The board-space offset of a lifted member card, so selection
  // chrome can follow the card instead of its open slot.
  liftDelta(id: ID): { dx: number; dy: number } | null {
    const r = this.memberReorder;
    return r && r.memberId === id ? { dx: r.dx, dy: r.dy } : null;
  }

  trashRect: DOMRect | null | undefined;


  // --- drag gestures ---

  // `start` is the pointerdown BOARD point: subtracting board points
  // keeps the grab under the cursor even across a ctrl+wheel zoom
  // mid-drag (a client delta re-scaled by the new z would jump).
  dragMove(ids: ID[], origins: Map<ID, { x: number; y: number }>, start: { x: number; y: number }, ev: PointerEvent) {
    if (this.a.lockedView()) return;
    // A mid-gesture delete (shortcut undo, Backspace) drops elements
    // out from under the drag; skip them instead of crashing on x/y.
    ids = ids.filter((id) => this.a.doc.elements[id] && origins.has(id));
    if (!ids.length) return;
    const cur = this.a.boardPoint(ev);
    let dx = cur.x - start.x;
    let dy = cur.y - start.y;

    // A single member dragged inside its own column re-seats by z order
    // rather than lifting out; crossing the column edge takes the normal
    // refile path below.
    const soloParent = ids.length === 1 ? this.a.doc.elements[ids[0]!]?.parentId : null;
    const colEl = soloParent ? this.a.doc.elements[soloParent] : undefined;
    if (colEl && pointInRect(cur.x, cur.y, this.a.layer.rectOf(colEl))) {
      this.memberHover(soloParent!, ids[0]!, cur, start);
      this.updateDropTarget(null, ids);
      this.setTrashHint(this.overTrashRect(ids), ids);
      this.a.requestRender();
      return;
    }

    // The pointer left the column: drop the lift affordance, the card
    // refiles to the canvas and drags like any other.
    if (this.memberReorder) this.clearMemberReorder();

    const refile = ids.filter((id) => this.a.doc.elements[id]?.parentId !== null);
    if (refile.length) {
      this.a.store.dispatch({
        type: 'batch',
        actions: refile.map((id) => ({ type: 'element.patch' as const, id, patch: { parentId: null } })),
      });
    }

    const rects = ids.map((id) => {
      const el = this.a.doc.elements[id]!;
      const o = origins.get(id)!;
      return { x: o.x, y: o.y, w: el.w ?? defaultWidth(el), h: this.a.layer.heightOf(el) };
    });
    const union = unionRect(rects)!;
    const statics = this.a.layer
      .elements()
      .filter((el) => !this.a.sel.has(el.id) && el.type !== 'line' && el.type !== 'annotation')
      .map((el) => this.a.layer.rectOf(el));
    const snap = snapDelta({ x: union.x + dx, y: union.y + dy, w: union.w, h: union.h }, statics, this.a.vp.z);
    dx += snap.dx;
    dy += snap.dy;
    this.a.guides = snap.guides;
    this.a.store.dispatch({
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
    this.a.requestRender();
  }


  // The drop target is the card, not the cursor: a big card reaches the
  // can well before the pointer does, so the hint and the drop test the
  // dragged rects against the button's box. A parked locked card that
  // happens to overlap it never counts (only the dragged ids are read).
  overTrashRect(ids: ID[]) {
    // The rail can't move mid-gesture: cache its rect once (reset in
    // endDrag/abortDrag) and test board rects instead of DOM reads.
    if (this.trashRect === undefined) {
      this.trashRect = document.querySelector('.rail-trash')?.getBoundingClientRect() ?? null;
    }
    const t = this.trashRect;
    if (!t) return false;
    return ids.some((id) => {
      const el = this.a.doc.elements[id];
      if (!el) return false;
      const r = this.a.layer.rectOf(el);
      const a = this.a.vp.toScreen(r.x, r.y);
      const b = this.a.vp.toScreen(r.x + r.w, r.y + r.h);
      return a.x < t.right && b.x > t.left && a.y < t.bottom && b.y > t.top;
    });
  }


  // Trash affordance mirrors the column .drop-hint ring; while the
  // pointer is over rail chrome the board hit-test is suppressed too.
  // body.over-trash lifts the viewport so the dragged cards ride above
  // the rail wearing the danger ring instead of sliding under it.
  trashHover = false;

  setTrashHint(on: boolean, dragged: ID[] = []) {
    if (on === this.trashHover) return;
    this.trashHover = on;
    document.querySelector('.rail-trash')?.classList.toggle('drop-hint', on);
    document.body.classList.toggle('over-trash', on);
    if (on) {
      for (const id of dragged) this.a.layer.view(id)?.node.classList.add('over-trash');
    } else {
      document.querySelectorAll('.card.over-trash').forEach((n) => {
        n.classList.remove('over-trash');
      });
    }
  }


  updateDropTarget(pt: { x: number; y: number } | null, dragged: ID[]) {
    let col: ID | null = null;
    // Only the topmost card under the pointer can be the drop target:
    // a column fully covered by another card must not hint or file.
    let top: Element | null = null;
    if (pt) {
      for (const e of this.a.layer.elements()) {
        if (e.type === 'line' || e.type === 'annotation' || dragged.includes(e.id)) continue;
        if (e.type === 'comment' && e.anchorId !== undefined) continue;
        if (dragged.some((id) => this.a.hasAncestor(e.id, id))) continue;
        if (!pointInRect(pt.x, pt.y, this.a.layer.rectOf(e))) continue;
        if (!top || e.z > top.z) top = e;
      }
      if (top?.type === 'column') col = top.id;
    }
    // Slot marker inside the target column: the same bar a same-column
    // reorder shows, so the drop can land mid-stack instead of only
    // appending to the end.
    if (col && pt) {
      const slot = this.memberSlot(col, dragged, pt);
      this.dropInsert = { colId: col, ...slot };
      const v = this.a.layer.view(col);
      if (v instanceof ColumnCard) v.showInsert(slot.beforeId);
    } else {
      this.dropInsert = null;
    }
    if (col === this.dropColId) return;
    if (this.dropColId) {
      const pv = this.a.layer.view(this.dropColId);
      if (pv instanceof ColumnCard) pv.hideInsert();
      pv?.node.classList.remove('drop-hint');
    }
    if (col) this.a.layer.view(col)?.node.classList.add('drop-hint');
    this.dropColId = col;
  }


  // Where a dragged member would land inside its column: the z it will
  // take on drop (fractional, between its new neighbours) and the
  // member the insertion marker seats in front of.
  private memberSlot(colId: ID, exclude: readonly ID[], pt: { x: number; y: number }) {
    const others = this.a.layer
      .members(colId)
      .filter((m) => m.type !== 'line' && m.type !== 'annotation' && !exclude.includes(m.id));
    let insert = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = this.a.layer.rectOf(others[i]!);
      if (pt.y < r.y + r.h / 2) {
        insert = i;
        break;
      }
    }
    const prev = others[insert - 1];
    const next = others[insert];
    const z =
      prev === undefined ? (next?.z ?? 0) - 1 : next === undefined ? prev.z + 1 : (prev.z + next.z) / 2;
    return { z, beforeId: next?.id ?? null, prevZ: prev?.z, nextZ: next?.z };
  }

  // While a member drags inside its own column the card lifts onto the
  // pointer and a marker bar opens the slot it will land in; the z
  // commit waits for endDrag so the move stays one undoable step.
  private memberHover(colId: ID, memberId: ID, pt: { x: number; y: number }, start: { x: number; y: number }) {
    const { z, beforeId } = this.memberSlot(colId, [memberId], pt);
    const dx = pt.x - start.x;
    const dy = pt.y - start.y;
    this.memberReorder = { colId, memberId, z, dx, dy };
    const node = this.a.layer.view(memberId)?.node;
    if (node) {
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      node.classList.add('drag-lift');
    }
    const colView = this.a.layer.view(colId);
    if (colView instanceof ColumnCard) colView.showInsert(beforeId);
    this.a.guides = [];
  }

  private clearMemberReorder() {
    const r = this.memberReorder;
    this.memberReorder = null;
    if (!r) return;
    const colView = this.a.layer.view(r.colId);
    if (colView instanceof ColumnCard) colView.hideInsert();
    const node = this.a.layer.view(r.memberId)?.node;
    if (node) {
      node.style.transform = '';
      node.classList.remove('drag-lift');
    }
  }


  clearDropHint() {
    if (this.dropColId) {
      const v = this.a.layer.view(this.dropColId);
      if (v instanceof ColumnCard) v.hideInsert();
      v?.node.classList.remove('drop-hint');
    }
    this.dropColId = null;
    this.dropInsert = null;
  }


  endDrag(ev?: PointerEvent) {
    this.trashRect = undefined;
    this.setTrashHint(false);
    if (ev) {
      const dragged = [...this.a.sel].filter((id) => {
        const el = this.a.doc.elements[id];
        return (
          !!el &&
          el.type !== 'line' &&
          !el.locked &&
          !(el.type === 'comment' && el.anchorId !== undefined) &&
          !!this.a.layer.view(id)
        );
      });
      if (this.overTrashRect(dragged)) {
        this.clearDropHint();
        this.clearMemberReorder();
        this.a.guides = [];
        this.a.deleteSelection();
        this.a.requestRender();
        return;
      }
    }
    // A member dragged inside its own column commits its new slot
    // here, inside the move group, as a single undoable z patch.
    const rr = this.memberReorder;
    this.clearMemberReorder();
    if (rr) {
      const el = this.a.doc.elements[rr.memberId];
      if (el && el.parentId === rr.colId && el.z !== rr.z) {
        this.a.store.dispatch({ type: 'element.patch', id: rr.memberId, patch: { z: rr.z } });
      }
    }
    if (this.dropColId) {
      const colId = this.dropColId;
      // The slot marker's gap: inserted elements spread evenly between
      // its neighbour z values so multi-drops keep pointer order.
      const slot = this.dropInsert?.colId === colId ? this.dropInsert : null;
      this.clearDropHint();
      const actions: Action[] = [...this.a.sel]
        .map((id) => this.a.doc.elements[id])
        .filter(
          (e): e is Element =>
            !!e &&
            e.type !== 'line' &&
            e.type !== 'annotation' &&
            e.parentId !== colId &&
            !e.locked &&
            !(e.type === 'comment' && e.anchorId !== undefined),
        )
        .map((e, i, arr) => {
          let z = ++this.a.doc.seq;
          if (slot) {
            const lo = slot.prevZ ?? (slot.nextZ ?? 0) - 1;
            const hi = slot.nextZ ?? lo + arr.length + 1;
            z = lo + ((hi - lo) * (i + 1)) / (arr.length + 1);
          }
          return { type: 'element.patch', id: e.id, patch: { parentId: colId, z } };
        });
      if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
    } else {
      this.pushOverlaps();
    }
    this.a.guides = [];
    this.a.requestRender();
  }


  // pointercancel mid-drag: clear the in-flight drop/gesture chrome.
  abortDrag() {
    this.trashRect = undefined;
    this.clearMemberReorder();
    this.clearDropHint();
    this.setTrashHint(false);
    this.a.guides = [];
    this.a.requestRender();
  }


  // Card-overlap prevention pref: after a card lands or grows, push
  // neighbours aside along the shorter axis. Iterative, capped; the
  // patches join the caller's undo group (drag/resize stay open here).
  pushOverlaps() {
    if (!this.a.prefs.noOverlap || !this.a.boardId || this.a.lockedView()) return;
    const movable = (e: Element) =>
      e.boardId === this.a.boardId &&
      e.parentId === null &&
      e.type !== 'line' &&
      e.type !== 'annotation' &&
      !(e.type === 'comment' && e.anchorId !== undefined) &&
      !e.locked;
    const anchors = this.a.selectedEls().filter(movable);
    if (!anchors.length) return;
    const pos = new Map<ID, { x: number; y: number }>();
    const others = this.a.layer.elements().filter((e) => movable(e) && !this.a.sel.has(e.id));
    // Virtual positions bypass rectOf: its id-keyed cache would return
    // the unpushed rect (or cache the virtual one under the real id).
    const rectAt = (e: Element): Rect => {
      const p = pos.get(e.id);
      return p ? { x: p.x, y: p.y, w: e.w ?? defaultWidth(e), h: this.a.layer.heightOf(e) } : this.a.layer.rectOf(e);
    };
    for (let pass = 0; pass < 6; pass++) {
      let pushed = false;
      for (const a of anchors) {
        const ae = this.a.doc.elements[a.id]!;
        const ra = rectAt(ae);
        for (const o of others) {
          const oe = this.a.doc.elements[o.id]!;
          const ro = rectAt(oe);
          const ox = Math.min(ra.x + ra.w, ro.x + ro.w) - Math.max(ra.x, ro.x);
          const oy = Math.min(ra.y + ra.h, ro.y + ro.h) - Math.max(ra.y, ro.y);
          if (ox <= 0 || oy <= 0) continue;
          const cur = pos.get(oe.id) ?? { x: oe.x, y: oe.y };
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
      this.a.store.dispatch({
        type: 'batch',
        actions: [...pos].map(([id, p]) => ({ type: 'element.patch' as const, id, patch: p })),
      });
    }
  }


  startResize(id: ID, e: PointerEvent) {
    if (this.a.lockedView()) return;
    e.preventDefault();
    const el = this.a.doc.elements[id];
    if (!el || el.parentId || el.locked) return;
    const pid = e.pointerId;
    const start = this.a.boardPoint(e);
    const w0 = el.w ?? defaultWidth(el);
    this.a.store.beginGroup();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const cur = this.a.boardPoint(ev);
      const w = Math.round(Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, w0 + (cur.x - start.x))));
      this.a.store.dispatch({ type: 'element.patch', id, patch: { w } });
    };
    const done = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      if (!this.a.sel.has(id)) this.a.sel = new Set([id]);
      this.pushOverlaps();
      this.a.store.endGroup('resize');
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
      this.a.vp.panBy(ev.clientX - lx, ev.clientY - ly);
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

}
