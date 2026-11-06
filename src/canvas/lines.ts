import type { Doc, Element, ID, LineEnd, LineRoute } from '../state/schema';
import { lineDoc } from '../state/schema';
import { LINE_W } from './renderer';
import type { Rect } from './viewport';

export interface Pt {
  x: number;
  y: number;
}

export type LineSide = 'top' | 'bottom' | 'left' | 'right';

interface ResolvedLine {
  el: Element;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  side1?: LineSide | undefined;
  side2?: LineSide | undefined;
  pts: Pt[];
}

type RectOf = (el: Element) => Rect;

// Attached ends snap to the card edge midpoint nearest the other endpoint.
// Falls back to the stored free point when the element is gone or unusable.
function resolveEnd(end: LineEnd, other: Pt, doc: Doc, rectOf: RectOf): { pt: Pt; side?: LineSide } {
  if (end.el !== undefined) {
    const target = doc.elements[end.el];
    if (target && target.type !== 'line') {
      const r = rectOf(target);
      const mids: { pt: Pt; side: LineSide }[] = [
        { pt: { x: r.x + r.w / 2, y: r.y }, side: 'top' },
        { pt: { x: r.x + r.w / 2, y: r.y + r.h }, side: 'bottom' },
        { pt: { x: r.x, y: r.y + r.h / 2 }, side: 'left' },
        { pt: { x: r.x + r.w, y: r.y + r.h / 2 }, side: 'right' },
      ];
      let best = mids[0]!;
      let bestD = Infinity;
      for (const m of mids) {
        const d = (m.pt.x - other.x) * (m.pt.x - other.x) + (m.pt.y - other.y) * (m.pt.y - other.y);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      return best;
    }
  }
  return { pt: { x: end.x, y: end.y } };
}

export function resolveLine(el: Element, doc: Doc, rectOf: RectOf): ResolvedLine | null {
  const c = lineDoc(el);
  if (!c) return null;
  // Resolve the free end first so each attached end sees a concrete point.
  const from = resolveEnd(c.from, rawPt(c.to, doc, rectOf), doc, rectOf);
  const to = resolveEnd(c.to, rawPt(c.from, doc, rectOf), doc, rectOf);
  const { x: x1, y: y1 } = from.pt;
  const { x: x2, y: y2 } = to.pt;
  return {
    el,
    x1,
    y1,
    x2,
    y2,
    side1: from.side,
    side2: to.side,
    pts: linePath(x1, y1, from.side, x2, y2, to.side, c.route),
  };
}

const hSide = (s?: LineSide) => s === 'left' || s === 'right';
const vSide = (s?: LineSide) => s === 'top' || s === 'bottom';

// The polyline a line strokes: straight is the two endpoints; elbow adds
// right-angle bends derived from the exit sides of the attached ends
// (free ends get an axis picked from the dominant delta).
export function linePath(
  x1: number,
  y1: number,
  side1: LineSide | undefined,
  x2: number,
  y2: number,
  side2: LineSide | undefined,
  route?: LineRoute,
): Pt[] {
  let pts: Pt[];
  if (route !== 'elbow') {
    pts = [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  } else {
    const a1: 'h' | 'v' | undefined = hSide(side1) ? 'h' : vSide(side1) ? 'v' : undefined;
    const a2: 'h' | 'v' | undefined = hSide(side2) ? 'h' : vSide(side2) ? 'v' : undefined;
    // Exit/entry ray checks: a bend corner is legal only when it sits
    // ahead of the departing ray and behind the arriving one.
    const out1h = side1 === 'right' ? x2 >= x1 : side1 === 'left' ? x2 <= x1 : true;
    const out1v = side1 === 'bottom' ? y2 >= y1 : side1 === 'top' ? y2 <= y1 : true;
    const in2h = side2 === 'left' ? x1 <= x2 : side2 === 'right' ? x1 >= x2 : true;
    const in2v = side2 === 'top' ? y1 <= y2 : side2 === 'bottom' ? y1 >= y2 : true;
    const bend = (first: 'h' | 'v'): Pt[] =>
      first === 'h'
        ? [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
          ]
        : [
            { x: x1, y: y1 },
            { x: x1, y: y2 },
            { x: x2, y: y2 },
          ];
    const dogleg = (first: 'h' | 'v'): Pt[] =>
      first === 'h'
        ? [
            { x: x1, y: y1 },
            { x: (x1 + x2) / 2, y: y1 },
            { x: (x1 + x2) / 2, y: y2 },
            { x: x2, y: y2 },
          ]
        : [
            { x: x1, y: y1 },
            { x: x1, y: (y1 + y2) / 2 },
            { x: x2, y: (y1 + y2) / 2 },
            { x: x2, y: y2 },
          ];
    if (!a1 && !a2) {
      pts = bend(Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'h' : 'v');
    } else if (a1 === 'h' && a2 === 'h') {
      pts = dogleg('h');
    } else if (a1 === 'v' && a2 === 'v') {
      pts = dogleg('v');
    } else if (!a2) {
      pts = a1 === 'h' ? (out1h ? bend('h') : dogleg('h')) : out1v ? bend('v') : dogleg('v');
    } else if (!a1) {
      pts = a2 === 'h' ? (in2h ? bend('v') : dogleg('h')) : in2v ? bend('h') : dogleg('v');
    } else {
      // Mixed exits: single bend where the exit rays meet; when the
      // corner lies behind either ray fall back to the dogleg.
      pts = a1 === 'h' ? (out1h && in2v ? bend('h') : dogleg('h')) : out1v && in2h ? bend('v') : dogleg('v');
    }
  }
  return collapsePts(pts);
}

// Drop consecutive duplicates and collinear middle points so degenerate
// elbows still yield a clean path.
function collapsePts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  if (out.length < 2) out.push({ ...out[0]! });
  return out;
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

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
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
  const pts = l.pts;
  const n = pts.length;
  if (n % 2 === 1) return pts[(n - 1) / 2]!;
  const a = pts[n / 2 - 1]!;
  const b = pts[n / 2]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
  // Topmost-first on both passes: overlapping selected endpoints grab
  // the line the user sees, matching the body pass.
  const sorted = [...lines].sort((a, b) => b.el.z - a.el.z);
  for (const l of sorted) {
    if (!sel.has(l.el.id)) continue;
    if (Math.hypot(pt.x - l.x1, pt.y - l.y1) <= endR) return { kind: 'end', id: l.el.id, which: 'from' };
    if (Math.hypot(pt.x - l.x2, pt.y - l.y2) <= endR) return { kind: 'end', id: l.el.id, which: 'to' };
  }
  // A thick stroke's visible edge beats the pointer tolerance: at high
  // zoom 6/z shrinks below the half-width and the rim becomes a dead zone.
  for (const l of sorted) {
    const w = LINE_W[lineDoc(l.el)?.weight ?? 'thin'];
    const tol = Math.max(6 / zoom, w / 2);
    const pts = l.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (segDist(pt.x, pt.y, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y) <= tol) {
        return { kind: 'body', id: l.el.id };
      }
    }
  }
  return null;
}
