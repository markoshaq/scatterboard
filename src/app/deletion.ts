import type { App } from '../app';
import { boardRefOf, lineDoc, type Element, type ID } from '../state/schema';
import type { Action } from '../state/actions';
import { resolveLine } from '../canvas/lines';
import { closeToolPopup } from '../ui/popup';

// Shared deletion policy: subtree cascades, dangling board-card
// sweeps and line/comment detaches. deleteSelection, the boards-panel
// cascade and the convert paths all build on the same primitives.
export class Deletion {
  constructor(private a: App) {}

  deleteSelection() {
    if (!this.a.sel.size || this.a.lockedView()) return;
    this.a.editing.endEdit();
    closeToolPopup();
    const actions: Action[] = [];
    const deleting = new Set<ID>();
    const deadBoards = new Set<ID>();
    for (const id of this.a.sel) {
      const el = this.a.doc.elements[id];
      if (!el) continue;
      if (el.type === 'column') {
        // Members unfile next to the column's rendered rect: a nested
        // column's stored x/y is its stale pre-filing spot.
        const cr = this.a.layer.rectOf(el);
        this.a.layer.members(el.id).forEach((m, i) => {
          actions.push({
            type: 'element.patch',
            id: m.id,
            patch: { parentId: null, x: Math.round(cr.x + 24 + i * 20), y: Math.round(cr.y + 24 + i * 20) },
          });
        });
      }
      deleting.add(el.id);
      const ref = boardRefOf(el);
      if (ref) {
        for (const a of this.cascadeActions(ref)) {
          actions.push(a);
          if (a.type === 'element.delete') deleting.add(a.el.id);
          else if (a.type === 'board.delete') deadBoards.add(a.board.id);
        }
      }
    }
    // Board cards/shortcuts elsewhere that point at the deleted subtree
    // would dangle (same sweep deleteBoardCascade does).
    this.sweepDeadRefs(actions, deleting, deadBoards);
    this.prependDetach(actions, deleting);
    const now = Date.now();
    for (const id of this.a.sel) {
      const el = this.a.doc.elements[id];
      if (!el) continue;
      actions.push({ type: 'element.delete', el });
      // Board cards and cascade children skip the bin: a restored card
      // without its board would be broken.
      if (el.type !== 'board') actions.push({ type: 'trash.add', id: el.id, entry: { el, deletedAt: now } });
    }
    this.a.store.dispatch({ type: 'batch', actions });
    this.a.sel.clear();
    this.a.filterIds.clear();
  }

  // Board cards/shortcuts still pointing at boards about to be deleted.
  // Shared by deleteSelection and the panels cascade; the ordering of
  // the two detach unshifts below is semantically meaningful (undo
  // order), so both paths route through prependDetach.
  sweepDeadRefs(actions: Action[], deleting: Set<ID>, deadBoards: Set<ID>) {
    for (const el of Object.values(this.a.doc.elements)) {
      if (deleting.has(el.id)) continue;
      const ref = boardRefOf(el);
      if (ref && deadBoards.has(ref)) {
        deleting.add(el.id);
        actions.push({ type: 'element.delete', el });
      }
    }
  }

  // Detaches ride ahead of the deletes so undo replays them last:
  // comments first, then lines, matching the original hand-ordering.
  prependDetach(actions: Action[], deleting: Set<ID>) {
    actions.unshift(...this.detachCommentActions(deleting));
    actions.unshift(...this.detachLineActions(deleting));
  }

  // Lines attached to a deleted card keep their last resolved point as a free end.
  detachLineActions(deleting: Set<ID>): Action[] {
    const out: Action[] = [];
    const rectOf = (el: Element) => this.a.layer.rectOf(el);
    for (const el of Object.values(this.a.doc.elements)) {
      if (el.type !== 'line' || deleting.has(el.id)) continue;
      const c = lineDoc(el);
      if (!c) continue;
      const fromGone = c.from.el !== undefined && deleting.has(c.from.el);
      const toGone = c.to.el !== undefined && deleting.has(c.to.el);
      if (!fromGone && !toGone) continue;
      const l = resolveLine(el, this.a.doc, rectOf);
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
    for (const el of Object.values(this.a.doc.elements)) {
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
    for (const el of Object.values(this.a.doc.elements)) {
      if (el.type !== 'comment' || el.anchorId === undefined || deleting.has(el.id)) continue;
      const anchor = this.a.doc.elements[el.anchorId];
      if (!anchor || !deleting.has(anchor.id)) continue;
      const r = this.a.layer.rectOf(anchor);
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
      const board = this.a.doc.boards[bid];
      if (!board) return;
      for (const el of Object.values(this.a.doc.elements)) {
        if (el.boardId === bid) out.push({ type: 'element.delete', el });
      }
      for (const l of Object.values(this.a.doc.labels)) {
        // Board-scoped labels would orphan in the doc forever.
        if (l.boardId === bid) out.push({ type: 'label.delete', label: l });
      }
      out.push({ type: 'board.delete', board });
      for (const b of Object.values(this.a.doc.boards)) {
        if (b.parentId === bid) visit(b.id);
      }
    };
    visit(boardId);
    return out;
  }
}
