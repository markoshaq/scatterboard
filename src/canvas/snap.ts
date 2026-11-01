import { GRID } from '../state/schema';
import type { Guide } from './renderer';
import type { Rect } from './viewport';

const SNAP_TO_GRID = true;
const SNAP_TO_CARDS = true;
const THRESHOLD = 8;

interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export function snapDelta(moving: Rect, statics: Rect[], z: number): SnapResult {
  const t = THRESHOLD / z;
  let dx = 0;
  let dy = 0;
  const guides: Guide[] = [];

  if (SNAP_TO_CARDS) {
    const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
    const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
    let bestX: { d: number; at: number; r: Rect } | null = null;
    let bestY: { d: number; at: number; r: Rect } | null = null;
    for (const s of statics) {
      for (const c of [s.x, s.x + s.w / 2, s.x + s.w]) {
        for (const m of mx) {
          const d = c - m;
          if (Math.abs(d) <= t && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: c, r: s };
        }
      }
      for (const c of [s.y, s.y + s.h / 2, s.y + s.h]) {
        for (const m of my) {
          const d = c - m;
          if (Math.abs(d) <= t && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: c, r: s };
        }
      }
    }
    if (bestX) {
      dx = bestX.d;
      guides.push({ axis: 'v', at: bestX.at, from: Math.min(moving.y, bestX.r.y), to: Math.max(moving.y + moving.h, bestX.r.y + bestX.r.h) });
    }
    if (bestY) {
      dy = bestY.d;
      guides.push({ axis: 'h', at: bestY.at, from: Math.min(moving.x, bestY.r.x), to: Math.max(moving.x + moving.w, bestY.r.x + bestY.r.w) });
    }
  }

  if (SNAP_TO_GRID) {
    if (dx === 0) {
      const gx = Math.round((moving.x + dx) / GRID) * GRID;
      const d = gx - moving.x;
      if (Math.abs(d) <= t) {
        dx = d;
        guides.push({ axis: 'v', at: gx, from: moving.y - 4, to: moving.y + moving.h + 4 });
      }
    }
    if (dy === 0) {
      const gy = Math.round((moving.y + dy) / GRID) * GRID;
      const d = gy - moving.y;
      if (Math.abs(d) <= t) {
        dy = d;
        guides.push({ axis: 'h', at: gy, from: moving.x - 4, to: moving.x + moving.w + 4 });
      }
    }
  }

  return { dx, dy, guides };
}
