// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createBoard, createLine, createNote, emptyDoc, type Doc, type Element } from '../src/state/schema';
import { hitLines, lineRect, midpoint, resolveLine } from '../src/canvas/lines';
import type { Rect } from '../src/canvas/viewport';

function doc(): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  return d;
}

// Cards are 200x100 stand-ins; the real rectOf measures DOM heights.
const rects = new Map<string, Rect>();
const rectOf = (el: Element): Rect => rects.get(el.id) ?? { x: el.x, y: el.y, w: el.w ?? 200, h: 100 };

function note(d: Doc, x: number, y: number, w = 200, h = 100) {
  const el = createNote(d, 'home', x, y, 'n');
  rects.set(el.id, { x, y, w, h });
  d.elements[el.id] = el;
  return el;
}

describe('resolveLine', () => {
  it('resolves free ends to their stored points', () => {
    const d = doc();
    const line = createLine(d, 'home', { x: 10, y: 20 }, { x: 100, y: 200 });
    const r = resolveLine(line, d, rectOf)!;
    expect([r.x1, r.y1, r.x2, r.y2]).toEqual([10, 20, 100, 200]);
  });

  it('snaps an attached end to the nearest edge midpoint', () => {
    const d = doc();
    const card = note(d, 0, 0, 200, 100); // mids: top(100,0) bottom(100,100) left(0,50) right(200,50)
    const line = createLine(d, 'home', { el: card.id, x: 0, y: 0 }, { x: 200, y: 400 });
    const r = resolveLine(line, d, rectOf)!;
    // nearest midpoint to (200,400) is the bottom edge (100,100)
    expect([r.x1, r.y1]).toEqual([100, 100]);
    expect([r.x2, r.y2]).toEqual([200, 400]);
  });

  it('falls back to the stored point when the target is gone', () => {
    const d = doc();
    const line = createLine(d, 'home', { el: 'ghost', x: 5, y: 6 }, { x: 1, y: 2 });
    const r = resolveLine(line, d, rectOf)!;
    expect([r.x1, r.y1]).toEqual([5, 6]);
  });

  it('does not recurse through lines anchored to lines', () => {
    const d = doc();
    const a = createLine(d, 'home', { x: 0, y: 0 }, { x: 10, y: 10 });
    d.elements[a.id] = a;
    const b = createLine(d, 'home', { el: a.id, x: 50, y: 60 }, { x: 70, y: 80 });
    const r = resolveLine(b, d, rectOf)!;
    // Anchored-to-line end falls back to its stored free point.
    expect([r.x1, r.y1]).toEqual([50, 60]);
  });

  it('returns null for non-line elements', () => {
    const d = doc();
    const n = note(d, 0, 0);
    expect(resolveLine(n, d, rectOf)).toBeNull();
  });
});

describe('lineRect and midpoint', () => {
  it('bounds the segment with padding', () => {
    const d = doc();
    const line = createLine(d, 'home', { x: 100, y: 200 }, { x: 50, y: 20 });
    const r = lineRect(resolveLine(line, d, rectOf)!);
    expect(r).toEqual({ x: 40, y: 10, w: 70, h: 200 });
  });

  it('midpoint is the segment centre', () => {
    const d = doc();
    const line = createLine(d, 'home', { x: 0, y: 0 }, { x: 100, y: 200 });
    expect(midpoint(resolveLine(line, d, rectOf)!)).toEqual({ x: 50, y: 100 });
  });
});

describe('hitLines', () => {
  it('grabs line ends only for selected lines', () => {
    const d = doc();
    const line = createLine(d, 'home', { x: 0, y: 0 }, { x: 100, y: 0 });
    const rl = resolveLine(line, d, rectOf)!;
    // Unselected: an end tap reports the body, not the handle.
    expect(hitLines([rl], new Set(), { x: 2, y: 1 }, 1)?.kind).toBe('body');
    const hit = hitLines([rl], new Set([line.id]), { x: 2, y: 1 }, 1);
    expect(hit).toEqual({ kind: 'end', id: line.id, which: 'from' });
    const hitTo = hitLines([rl], new Set([line.id]), { x: 99, y: 2 }, 1);
    expect(hitTo?.kind).toBe('end');
    expect(hitTo?.which).toBe('to');
  });

  it('end grab radius shrinks in board units as zoom grows', () => {
    const d = doc();
    const line = createLine(d, 'home', { x: 0, y: 0 }, { x: 100, y: 0 });
    const rl = resolveLine(line, d, rectOf)!;
    const sel = new Set([line.id]);
    // At z=4 the end radius is 2 board units: 3 away is a body hit.
    expect(hitLines([rl], sel, { x: 3, y: 0 }, 4)?.kind).toBe('body');
    expect(hitLines([rl], sel, { x: 1.5, y: 0 }, 4)?.kind).toBe('end');
  });

  it('body hit picks the topmost line and honours thick strokes', () => {
    const d = doc();
    const lo = createLine(d, 'home', { x: 0, y: 0 }, { x: 100, y: 0 });
    lo.z = 1;
    const hi = createLine(d, 'home', { x: 50, y: -50 }, { x: 50, y: 50 });
    hi.z = 2;
    const a = resolveLine(lo, d, rectOf)!;
    const b = resolveLine(hi, d, rectOf)!;
    // Crossing at (50,0): both segments reachable, hi wins on z.
    expect(hitLines([a, b], new Set(), { x: 50, y: 0.5 }, 1)?.id).toBe(hi.id);

    const thick = createLine(d, 'home', { x: 0, y: 0 }, { x: 100, y: 0 });
    (thick.content as { line: { weight: 'thin' | 'medium' | 'thick' } }).line.weight = 'thick';
    const rt = resolveLine(thick, d, rectOf)!;
    // At z=4, 6/z=1.5 < half of a 4-wide stroke: the rim still hits.
    expect(hitLines([rt], new Set(), { x: 50, y: 1.9 }, 4)?.id).toBe(thick.id);
  });

  it('returns null away from every line and on a zero-length line', () => {
    const d = doc();
    const line = createLine(d, 'home', { x: 0, y: 0 }, { x: 100, y: 0 });
    const rl = resolveLine(line, d, rectOf)!;
    expect(hitLines([rl], new Set(), { x: 50, y: 50 }, 1)).toBeNull();

    const dot = createLine(d, 'home', { x: 40, y: 40 }, { x: 40, y: 40 });
    const rd = resolveLine(dot, d, rectOf)!;
    expect(hitLines([rd], new Set(), { x: 42, y: 40 }, 1)?.id).toBe(dot.id);
    expect(hitLines([rd], new Set(), { x: 50, y: 40 }, 1)).toBeNull();
  });
});
