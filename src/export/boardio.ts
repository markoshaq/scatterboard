import type { Action } from '../state/actions';
import type { Board, Doc, Element, ID, Label, LineEnd } from '../state/schema';
import { createBoardCard, nextZ, uid, UNSORTED } from '../state/schema';
import { sanitizeHtml } from '../ui/sanitize';
import { CONTENT_KEY, isSafeUrl, NOTE_MAX_W, NOTE_MIN_W, saneContent } from '../state/schema';

// Full-board JSON export/import. The format carries the board subtree
// (board records, their elements and labels) under version 1.
// Media stays as blobRef pointers: blobs are device-local IndexedDB
// entries, so an imported image whose blob never existed here renders
// the standard missing-image placeholder.

interface BoardExport {
  version: 1;
  board: ID;
  boards: Board[];
  elements: Element[];
  labels: Label[];
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
  const labels = Object.values(doc.labels).filter((l) => bids.has(l.boardId));
  const data: BoardExport = {
    version: 1,
    board: rootId,
    boards: [...boards.values()],
    elements,
    labels,
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
  if (d?.version !== 1 || typeof d.board !== 'string') return null;
  if (!Array.isArray(d.boards) || !Array.isArray(d.elements)) return null;
  if (!d.boards.length || d.boards.some((b) => !b || typeof b.id !== 'string')) return null;
  if (
    d.elements.some(
      (e) =>
        !e ||
        typeof e.id !== 'string' ||
        typeof e.type !== 'string' ||
        !e.content ||
        typeof e.content !== 'object',
    )
  ) {
    return null;
  }
  // Older files may carry a comments array; it is ignored, not stored.
  return {
    version: 1,
    board: d.board,
    boards: d.boards,
    elements: d.elements,
    labels: Array.isArray(d.labels) ? d.labels : [],
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

  // Which source elements actually land: a board missing from the file,
  // an unknown type, malformed content, or a boardRef pointing outside
  // the export drops the clone. parentId, anchorId and line ends may
  // only remap into this set or they produce zombies (pins no card
  // owns, members of nonexistent columns). A link/embed url with an
  // unsafe scheme is cleared in place, not dropped.
  const created = new Set<ID>();
  const byId = new Map(data.elements.map((e) => [e.id, e]));
  for (const e of data.elements) {
    if (!bmap.has(e.boardId)) continue;
    if (!(e.type in CONTENT_KEY)) continue;
    const holder: unknown = 'link' in e.content ? e.content.link : 'embed' in e.content ? e.content.embed : null;
    if (holder && typeof holder === 'object') {
      const h = holder as { url?: unknown };
      if (typeof h.url === 'string' && h.url && !isSafeUrl(h.url)) h.url = '';
    }
    if (!saneContent(e.content, e.type)) continue;
    if ('boardRef' in e.content && !bmap.has(e.content.boardRef)) continue;
    created.add(e.id);
  }

  // syncGroups are doc-global: an imported group id that collides with
  // an existing one would silently join it, so it is cleared instead.
  const docGroups = new Set(
    Object.values(doc.elements)
      .map((e) => e.syncGroup)
      .filter((g): g is ID => g !== undefined),
  );

  const els: Element[] = [];
  for (const e of data.elements) {
    const bid = bmap.get(e.boardId);
    if (!bid || !created.has(e.id)) continue;
    const clone = structuredClone(e);
    // Richtext html renders via innerHTML: scrub it to the whitelist
    // the editor can produce. An empty result is dropped so cards fall
    // back to their plaintext field.
    const scrub = (holder: { html?: string }) => {
      if (holder.html === undefined) return;
      const c = sanitizeHtml(holder.html);
      if (c) holder.html = c;
      else delete holder.html;
    };
    if ('note' in clone.content) scrub(clone.content.note);
    if ('heading' in clone.content) scrub(clone.content.heading);
    if ('document' in clone.content) scrub(clone.content.document);
    if ('table' in clone.content) for (const row of clone.content.table.cells) for (const cell of row) scrub(cell);
    clone.id = emap.get(e.id)!;
    clone.boardId = bid;
    clone.z = nextZ(doc);
    // Scalar fields aren't shape-checked at parse: coerce non-finite
    // positions rather than land a card with NaN geometry.
    if (!Number.isFinite(clone.x)) clone.x = 0;
    if (!Number.isFinite(clone.y)) clone.y = 0;
    // w clamps to the card width limits; a non-finite or non-positive
    // value falls back to the type's default width.
    if (clone.w !== undefined) {
      if (Number.isFinite(clone.w) && clone.w > 0) {
        clone.w = Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, Math.round(clone.w)));
      } else {
        delete clone.w;
      }
    }
    if (clone.syncGroup !== undefined && (typeof clone.syncGroup !== 'string' || docGroups.has(clone.syncGroup))) {
      delete clone.syncGroup;
    }
    if (e.parentId === UNSORTED) {
      clone.parentId = UNSORTED;
    } else {
      // Only a column on the same board may parent an element; a
      // missing, cross-board or non-column target drops to canvas.
      const p = typeof e.parentId === 'string' ? byId.get(e.parentId) : undefined;
      clone.parentId =
        p && p.boardId === e.boardId && p.type === 'column' && created.has(p.id) ? emap.get(p.id)! : null;
    }
    if (e.anchorId !== undefined) {
      const a = typeof e.anchorId === 'string' ? byId.get(e.anchorId) : undefined;
      const m = a && a.boardId === e.boardId && created.has(a.id) ? emap.get(a.id) : undefined;
      if (m) clone.anchorId = m;
      else delete clone.anchorId;
    }
    clone.labels = (Array.isArray(e.labels) ? e.labels : []).map((l) => lmap.get(l)).filter((l): l is ID => !!l);
    if (clone.reactions !== undefined) {
      if (!Array.isArray(clone.reactions)) delete clone.reactions;
      else clone.reactions = clone.reactions.filter((r) => typeof r === 'string');
    }
    if ('boardRef' in clone.content) clone.content.boardRef = bmap.get(clone.content.boardRef)!;
    if ('line' in clone.content) {
      const lc = clone.content.line;
      if (!lc || typeof lc !== 'object' || !lc.from || !lc.to) continue;
      const remap = (end: LineEnd): LineEnd =>
        end.el !== undefined && created.has(end.el) ? { ...end, el: emap.get(end.el)! } : { x: end.x, y: end.y };
      clone.content.line = { ...lc, from: remap(lc.from), to: remap(lc.to) };
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
