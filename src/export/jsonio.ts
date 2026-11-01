import type { Action } from '../state/actions';
import type { Board, Comment, Doc, Element, ID, Label, LineEnd } from '../state/schema';
import { createBoardCard, uid, UNSORTED } from '../state/schema';

// Full-board JSON export/import. The format carries the board subtree
// (board records, their elements, labels, comments) under version 1.
// Media stays as blobRef pointers: blobs are device-local IndexedDB
// entries, so an imported image whose blob never existed here renders
// the standard missing-image placeholder.

interface BoardExport {
  version: 1;
  board: ID;
  boards: Board[];
  elements: Element[];
  labels: Label[];
  comments: Comment[];
}

export function exportBoard(doc: Doc, rootId: ID): string | null {
  if (!doc.boards[rootId]) return null;
  const boards = new Map<ID, Board>();
  const visit = (bid: ID) => {
    if (boards.has(bid)) return;
    const b = doc.boards[bid];
    if (!b) return;
    boards.set(bid, b);
    for (const el of Object.values(doc.elements)) {
      if (el.boardId === bid && 'boardRef' in el.content) visit(el.content.boardRef);
    }
    for (const child of Object.values(doc.boards)) {
      if (child.parentId === bid) visit(child.id);
    }
  };
  visit(rootId);
  const bids = new Set(boards.keys());
  const elements = Object.values(doc.elements).filter((e) => bids.has(e.boardId));
  const elIds = new Set(elements.map((e) => e.id));
  const labels = Object.values(doc.labels).filter((l) => bids.has(l.boardId));
  const comments = Object.values(doc.comments).filter(
    (cm) => (cm.boardId !== undefined && bids.has(cm.boardId)) || (cm.cardId !== undefined && elIds.has(cm.cardId)),
  );
  const data: BoardExport = {
    version: 1,
    board: rootId,
    boards: [...boards.values()],
    elements,
    labels,
    comments,
  };
  return JSON.stringify(data, null, 2);
}

export function parseBoardExport(text: string): BoardExport | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const d = data as Partial<BoardExport>;
  if (!d || d.version !== 1 || typeof d.board !== 'string') return null;
  if (!Array.isArray(d.boards) || !Array.isArray(d.elements)) return null;
  if (!d.boards.length || d.boards.some((b) => !b || typeof b.id !== 'string')) return null;
  if (d.elements.some((e) => !e || typeof e.id !== 'string' || typeof e.type !== 'string' || !e.content)) {
    return null;
  }
  return {
    version: 1,
    board: d.board,
    boards: d.boards,
    elements: d.elements,
    labels: Array.isArray(d.labels) ? d.labels : [],
    comments: Array.isArray(d.comments) ? d.comments : [],
  };
}

// Build the create-actions for a re-idded copy of the export, attached
// under hostId via a fresh board card. One batch = one undo entry.
export function importActions(
  doc: Doc,
  data: BoardExport,
  hostId: ID,
): { actions: Action[]; boardId: ID } | null {
  if (!doc.boards[hostId]) return null;
  const bmap = new Map<ID, ID>();
  const emap = new Map<ID, ID>();
  const lmap = new Map<ID, ID>();
  for (const b of data.boards) bmap.set(b.id, uid());
  for (const e of data.elements) emap.set(e.id, uid());
  for (const l of data.labels) lmap.set(l.id, uid());
  const rootId = bmap.get(data.board) ?? bmap.get(data.boards[0]!.id)!;

  const boards: Board[] = data.boards.map((b) => ({
    ...structuredClone(b),
    id: bmap.get(b.id)!,
    parentId: b.id === data.board ? hostId : (b.parentId && bmap.get(b.parentId)) || hostId,
  }));

  const els: Element[] = [];
  for (const e of data.elements) {
    const bid = bmap.get(e.boardId);
    if (!bid) continue;
    const clone = structuredClone(e);
    clone.id = emap.get(e.id)!;
    clone.boardId = bid;
    clone.z = ++doc.seq;
    if (e.parentId === null || e.parentId === UNSORTED) {
      clone.parentId = e.parentId;
    } else {
      clone.parentId = emap.get(e.parentId) ?? null;
    }
    if (e.anchorId !== undefined) {
      const m = emap.get(e.anchorId);
      if (m) clone.anchorId = m;
      else delete clone.anchorId;
    }
    clone.labels = e.labels.map((l) => lmap.get(l)).filter((l): l is ID => !!l);
    if ('boardRef' in clone.content) {
      const target = bmap.get(clone.content.boardRef);
      if (!target) continue; // card pointed outside the export: drop it
      clone.content.boardRef = target;
    }
    if ('line' in clone.content) {
      const remap = (end: LineEnd): LineEnd =>
        end.el !== undefined && emap.has(end.el) ? { ...end, el: emap.get(end.el)! } : { x: end.x, y: end.y };
      clone.content.line = { ...clone.content.line, from: remap(clone.content.line.from), to: remap(clone.content.line.to) };
    }
    els.push(clone);
  }

  const labels: Label[] = data.labels
    .filter((l) => bmap.has(l.boardId))
    .map((l) => ({ ...structuredClone(l), id: lmap.get(l.id)!, boardId: bmap.get(l.boardId)! }));

  // Host card sits below existing content (or at origin on an empty board).
  let spot = { x: 80, y: 80 };
  const host = Object.values(doc.elements).filter((e) => e.boardId === hostId && e.parentId === null);
  if (host.length) spot = { x: Math.min(...host.map((e) => e.x)), y: Math.max(...host.map((e) => e.y)) + 300 };
  const card = createBoardCard(doc, hostId, rootId, spot.x, spot.y);

  const actions: Action[] = [
    ...boards.map((board): Action => ({ type: 'board.create', board })),
    ...labels.map((label): Action => ({ type: 'label.create', label })),
    ...els.map((el): Action => ({ type: 'element.create', el })),
    { type: 'element.create', el: card },
  ];
  return { actions, boardId: rootId };
}
