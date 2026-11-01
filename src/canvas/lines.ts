import type { Doc, Element, ID, LineEnd } from '../state/schema';
import { lineDoc } from '../state/schema';
import type { Rect } from './viewport';

export interface Pt {
  x: number;
  y: number;
}

export interface ResolvedLine {
  el: Element;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type RectOf = (el: Element) => Rect;

// Attached ends snap to the card edge midpoint nearest the other endpoint.
// Falls back to the stored free point when the element is gone or unusable.
export function resolveEnd(end: LineEnd, other: Pt, doc: Doc, rectOf: RectOf): Pt {
  if (end.el !== undefined) {
    const target = doc.elements[end.el];
    if (target && target.type !== 'line') {
      const r = rectOf(target);
      const mids: Pt[] = [
        { x: r.x + r.w / 2, y: r.y },
        { x: r.x + r.w / 2, y: r.y + r.h },
        { x: r.x, y: r.y + r.h / 2 },
        { x: r.x + r.w, y: r.y + r.h / 2 },
      ];
      let best = mids[0]!;
      let bestD = Infinity;
      for (const m of mids) {
        const d = (m.x - other.x) * (m.x - other.x) + (m.y - other.y) * (m.y - other.y);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      return best;
    }
  }
  return { x: end.x, y: end.y };
}

export function resolveLine(el: Element, doc: Doc, rectOf: RectOf): ResolvedLine | null {
  const c = lineDoc(el);
  if (!c) return null;
  // Resolve the free end first so each attached end sees a concrete point.
  const from = resolveEnd(c.from, rawPt(c.to, doc, rectOf), doc, rectOf);
  const to = resolveEnd(c.to, rawPt(c.from, doc, rectOf), doc, rectOf);
  return { el, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
}

function rawPt(end: LineEnd, doc: Doc, rectOf: RectOf): Pt {
  const target = end.el !== undefined ? doc.elements[end.el] : undefined;
  // Lines anchored to lines would recurse through rectOf->resolveLine.
  if (target && target.type !== 'line') {
    const r = rectOf(target);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  return { x: end.x, y: end.y };
}

export function lineRect(l: ResolvedLine): Rect {
  const pad = 10;
  return {
    x: Math.min(l.x1, l.x2) - pad,
    y: Math.min(l.y1, l.y2) - pad,
    w: Math.abs(l.x2 - l.x1) + pad * 2,
    h: Math.abs(l.y2 - l.y1) + pad * 2,
  };
}

export function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function midpoint(l: ResolvedLine): Pt {
  return { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
}

export interface LineHit {
  kind: 'end' | 'body';
  id: ID;
  which?: 'from' | 'to';
}

export function hitLines(
  lines: ResolvedLine[],
  sel: Set<ID>,
  pt: Pt,
  zoom: number,
): LineHit | null {
  const endR = 8 / zoom;
  for (const l of lines) {
    if (!sel.has(l.el.id)) continue;
    if (Math.hypot(pt.x - l.x1, pt.y - l.y1) <= endR) return { kind: 'end', id: l.el.id, which: 'from' };
    if (Math.hypot(pt.x - l.x2, pt.y - l.y2) <= endR) return { kind: 'end', id: l.el.id, which: 'to' };
  }
  const bodyR = 6 / zoom;
  const sorted = [...lines].sort((a, b) => b.el.z - a.el.z);
  for (const l of sorted) {
    if (segDist(pt.x, pt.y, l.x1, l.y1, l.x2, l.y2) <= bodyR) return { kind: 'body', id: l.el.id };
  }
  return null;
}
