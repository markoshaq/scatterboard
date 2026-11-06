import { describe, expect, it, vi } from 'vitest';
import { Viewport } from '../src/canvas/viewport';

// Reduced-motion makes every tween land synchronously through
// snapTo, which keeps these assertions free of rAF timing.
vi.stubGlobal('matchMedia', (q: string) => ({
  media: q,
  matches: true,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
}));

function vp(w = 1000, h = 800) {
  const v = new Viewport();
  v.setSize(w, h);
  return v;
}

describe('Viewport transforms', () => {
  it('toBoard/toScreen round-trip', () => {
    const v = vp();
    v.x = 50;
    v.y = -30;
    v.z = 2;
    const b = v.toBoard(250, 170);
    const s = v.toScreen(b.x, b.y);
    expect(s.x).toBeCloseTo(250);
    expect(s.y).toBeCloseTo(170);
  });

  it('panBy moves the origin', () => {
    const v = vp();
    v.panBy(10, -20);
    expect(v.x).toBe(10);
    expect(v.y).toBe(-20);
  });
});

describe('Viewport zoom', () => {
  it('zoomAt keeps the cursor-anchored board point fixed', () => {
    const v = vp();
    const sx = 400;
    const sy = 300;
    const before = v.toBoard(sx, sy);
    v.zoomAt(2, sx, sy);
    expect(v.z).toBe(2);
    const after = v.toScreen(before.x, before.y);
    expect(after.x).toBeCloseTo(sx);
    expect(after.y).toBeCloseTo(sy);
  });

  it('clamps to min and max zoom', () => {
    const v = vp();
    v.zoomAt(100, 0, 0);
    expect(v.z).toBe(4);
    v.zoomAt(0.0001, 0, 0);
    expect(v.z).toBe(0.1);
  });

  it('a no-op zoom fires no change', () => {
    const v = vp();
    v.z = 4;
    let n = 0;
    v.onchange = () => n++;
    v.zoomAt(10, 0, 0); // already at max
    expect(n).toBe(0);
  });

  it('zoomStep lands centred through the tween path', () => {
    const v = vp();
    const before = v.toBoard(500, 400);
    v.zoomStep(1);
    expect(v.z).toBeCloseTo(1.25);
    // The centre board point stays under the centre pixel.
    const after = v.toScreen(before.x, before.y);
    expect(after.x).toBeCloseTo(500);
    expect(after.y).toBeCloseTo(400);
    v.zoomStep(-1);
    expect(v.z).toBeCloseTo(1);
  });
});

describe('Viewport fit and view rect', () => {
  it('fitTarget centres horizontally and top-anchors in the usable box', () => {
    const v = vp(1000, 800);
    const ins = { l: 80, t: 80, r: 80, b: 80 };
    const t = v.fitTarget({ x: 0, y: 0, w: 400, h: 200 }, ins)!;
    // usable 840x640; scale = min(840/400, 640/200) = 2.1
    expect(t.z).toBeCloseTo(2.1);
    // content 400*2.1=840 fills usable width; x = ins.l
    expect(t.x).toBeCloseTo(80);
    // top-anchored: board y=0 lands at ins.t
    expect(t.y).toBeCloseTo(80);
  });

  it('returns null for a missing or degenerate rect', () => {
    const v = vp();
    expect(v.fitTarget(null)).toBeNull();
    expect(v.fitTarget({ x: 0, y: 0, w: 0, h: 10 })).toBeNull();
  });

  it('fit applies the target and falls back to reset', () => {
    const v = vp();
    v.fit({ x: 0, y: 0, w: 100, h: 100 });
    expect(v.z).toBeCloseTo(Math.min(4, Math.min(840 / 100, 640 / 100)));
    v.fit(null);
    expect(v.z).toBe(1);
  });

  it('viewRect covers the viewport in board units with margin', () => {
    const v = vp(1000, 800);
    v.z = 2;
    v.x = 100;
    v.y = 200;
    const r = v.viewRect(50);
    expect(r.x).toBeCloseTo((-50 - 100) / 2);
    expect(r.y).toBeCloseTo((-50 - 200) / 2);
    expect(r.w).toBeCloseTo(1100 / 2);
    expect(r.h).toBeCloseTo(900 / 2);
  });

  it('restore clamps zoom and centres without a saved position', () => {
    const v = vp();
    v.restore({ x: 1, y: 2, z: 99 });
    expect(v.z).toBe(4);
    v.restore(undefined);
    expect(v.x).toBe(500);
    expect(v.y).toBe(400);
    expect(v.z).toBe(1);
  });
});
