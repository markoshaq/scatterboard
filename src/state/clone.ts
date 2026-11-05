import type { Doc, Element, ID, LineEnd } from './schema';
import { nextZ, uid } from './schema';

interface RemapOpts {
  // Resolved canvas point for a line end whose card was not cloned.
  // Paste resolves through the live layer; templates keep stored coords.
  resolveEnd?: (el: Element, which: 'from' | 'to') => { x: number; y: number } | null;
  // Label id -> id to keep on the clone, or null to drop.
  labelId?: (lid: ID, boardId: ID) => ID | null;
}

// Shared clone path for paste, Opt+drag, duplicate and template
// instantiation: new ids/z, column members re-file to their cloned
// column, line endpoints re-attach only when the card came along,
// comments drop a stale anchor.
export function remapElements(
  doc: Doc,
  els: Element[],
  targetBoard: (e: Element) => ID,
  dx: number,
  dy: number,
  opts: RemapOpts = {},
): { clones: Element[]; idMap: Map<ID, ID> } {
  const idMap = new Map<ID, ID>();
  for (const e of els) idMap.set(e.id, uid());
  // New z values follow the sources' stacking order, not input order
  // (selection order is click order; doc order is insertion order).
  const zs = new Array<number>(els.length);
  for (const i of els.map((_, i) => i).sort((a, b) => els[a]!.z - els[b]!.z)) zs[i] = nextZ(doc);
  const now = Date.now();
  const labelId = opts.labelId ?? ((lid: ID, bid: ID) => (doc.labels[lid]?.boardId === bid ? lid : null));
  const clones = els.map((e, i) => {
    const boardId = targetBoard(e);
    const clone: Element = {
      ...e,
      id: idMap.get(e.id)!,
      boardId,
      x: e.x + dx,
      y: e.y + dy,
      z: zs[i]!,
      labels: e.labels.map((l) => labelId(l, boardId)).filter((l): l is ID => !!l),
      createdAt: now,
      modifiedAt: now,
      content: structuredClone(e.content),
    };
    clone.parentId = e.parentId && idMap.has(e.parentId) ? idMap.get(e.parentId)! : null;
    if (e.anchorId !== undefined) {
      const mapped = idMap.get(e.anchorId);
      if (mapped) clone.anchorId = mapped;
      else delete clone.anchorId;
    }
    if ('line' in clone.content && 'line' in e.content) {
      const l = e.content.line;
      const remapEnd = (end: LineEnd, which: 'from' | 'to'): LineEnd => {
        if (end.el !== undefined && idMap.has(end.el)) return { ...end, el: idMap.get(end.el)! };
        const p = opts.resolveEnd?.(e, which);
        return p
          ? { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }
          : { x: Math.round(end.x + dx), y: Math.round(end.y + dy) };
      };
      clone.content = { line: { ...l, from: remapEnd(l.from, 'from'), to: remapEnd(l.to, 'to') } };
    }
    return clone;
  });
  return { clones, idMap };
}
