// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/state/schema';
import { strokesBBox } from '../src/state/schema';
import {
  cloneStrokes,
  hitStroke,
  strokeD,
  strokeOutlineD,
  strokePathEl,
  strokesToSvgFile,
  translateStroke,
} from '../src/draw/strokes';

const pen = (pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
  color: '#123456',
  size: 3,
  pts,
  ...extra,
});

describe('strokeD', () => {
  it('is empty for no points and degenerate-segment for one', () => {
    expect(strokeD(pen([]))).toBe('');
    // A dot still draws: the single point gets a hairline segment.
    expect(strokeD(pen([[5, 6]]))).toBe('M 5 6 L 5.01 6.01');
  });

  it('builds an open polyline', () => {
    expect(strokeD(pen([[0, 0], [10, 0], [10, 10]]))).toBe('M 0 0 L 10 0 L 10 10');
  });
});

describe('strokeOutlineD', () => {
  it('draws a single variable-width point as a circle', () => {
    const d = strokeOutlineD(pen([[10, 20]], { widths: [8] }));
    expect(d).toContain('a 4 4');
    expect(d.startsWith('M 6 20')).toBe(true);
  });

  it('builds a closed outline around the polyline', () => {
    const d = strokeOutlineD(pen([[0, 0], [10, 0]], { widths: [4, 4] }));
    expect(d.endsWith(' Z')).toBe(true);
    // horizontal line: left side is offset up by half the width
    expect(d).toContain('L 10 -2');
  });

  it('falls back to strokeD without widths', () => {
    expect(strokeOutlineD(pen([[0, 0], [1, 1]]))).toBe('M 0 0 L 1 1');
  });
});

describe('strokePathEl', () => {
  it('strokes plain paths and fills variable-width ones', () => {
    const p = strokePathEl(pen([[0, 0], [5, 5]]));
    expect(p.getAttribute('stroke')).toBe('#123456');
    expect(p.getAttribute('fill')).toBe('none');
    expect(p.getAttribute('stroke-width')).toBe('3');

    const w = strokePathEl(pen([[0, 0], [5, 5]], { widths: [2, 2] }));
    expect(w.getAttribute('fill')).toBe('#123456');
    expect(w.getAttribute('stroke')).toBe('none');
  });
});

describe('hitStroke', () => {
  it('hits the topmost stroke within tolerance', () => {
    const strokes = [
      pen([[0, 0], [100, 0]]),
      pen([[50, -50], [50, 50]], { color: '#fff' }),
    ];
    // (50,3) is 3 from both; the later stroke wins.
    expect(hitStroke(strokes, 50, 3, 2)).toBe(1);
    expect(hitStroke(strokes, 10, 3, 2)).toBe(0);
    expect(hitStroke(strokes, 10, 20, 2)).toBe(-1);
  });

  it('accounts for stroke width and single-point strokes', () => {
    const wide = pen([[0, 0], [100, 0]], { size: 20 });
    expect(hitStroke([wide], 50, 9, 0)).toBe(0);
    const dot = pen([[30, 30]]);
    expect(hitStroke([dot], 31, 31, 1)).toBe(0);
    expect(hitStroke([], 0, 0, 10)).toBe(-1);
  });
});

describe('translateStroke and cloneStrokes', () => {
  it('moves points and clones deep', () => {
    const s = pen([[0, 0], [10, 10]], { widths: [1, 2] });
    const copy = cloneStrokes([s]);
    translateStroke(s, 5, -5);
    expect(s.pts).toEqual([[5, -5], [15, 5]]);
    // The clone is independent of the moved original.
    expect(copy[0]!.pts).toEqual([[0, 0], [10, 10]]);
    copy[0]!.widths![0] = 99;
    expect(s.widths).toEqual([1, 2]);
  });
});

describe('strokesToSvgFile', () => {
  it('sizes the viewBox to the stroke bbox and recentres paths', () => {
    const strokes = [pen([[10, 20], [30, 60]])];
    const svg = strokesToSvgFile(strokes);
    const box = strokesBBox(strokes);
    expect(svg).toContain(`viewBox="0 0 ${Math.ceil(box.w)} ${Math.ceil(box.h)}"`);
    // Points are re-anchored to the bbox origin (which includes a
    // half-stroke-width pad, so the first point is not at 0,0).
    expect(svg).toContain(`d="M ${10 - box.x} ${20 - box.y} L ${30 - box.x} ${60 - box.y}"`);
    expect(svg).toContain('stroke="#123456"');
  });

  it('drops unsafe colour values', () => {
    const svg = strokesToSvgFile([pen([[0, 0], [1, 1]], { color: 'expression(x)' })]);
    expect(svg).toContain('stroke="#000"');
    expect(svg).not.toContain('expression');
  });
});
