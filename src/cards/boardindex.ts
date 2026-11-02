import type { Doc, Element, ID } from '../state/schema';

// Per-board element index, rebuilt lazily when the doc rev or the open
// board changes. Replaces the repeated Object.values(doc.elements)
// scans renders used to do a dozen times per pass.
export class BoardIndex {
  // Canvas elements of this board (parentId === null), z-ascending.
  els: Element[] = [];
  // Canvas lines only (member/unsorted lines render nowhere).
  lines: Element[] = [];
  // parentId -> member elements, z-ascending; UNSORTED holds filed items.
  byParent = new Map<ID, Element[]>();
  private lastRev = -1;
  private lastBoard: ID | null = null;

  // Rebuilds when stale; returns true when the index was (re)built.
  ensure(doc: Doc, boardId: ID | null, rev: number): boolean {
    if (rev === this.lastRev && boardId === this.lastBoard) return false;
    this.lastRev = rev;
    this.lastBoard = boardId;
    this.els = [];
    this.lines = [];
    this.byParent.clear();
    if (boardId === null) return true;
    for (const el of Object.values(doc.elements)) {
      if (el.boardId !== boardId) continue;
      if (el.parentId === null) {
        this.els.push(el);
        if (el.type === 'line') this.lines.push(el);
      } else {
        const list = this.byParent.get(el.parentId);
        if (list) list.push(el);
        else this.byParent.set(el.parentId, [el]);
      }
    }
    this.els.sort((a, b) => a.z - b.z);
    this.lines.sort((a, b) => a.z - b.z);
    for (const list of this.byParent.values()) list.sort((a, b) => a.z - b.z);
    return true;
  }

  members(id: ID): Element[] {
    return this.byParent.get(id) ?? [];
  }
}
