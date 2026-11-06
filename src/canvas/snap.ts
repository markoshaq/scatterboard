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

  // Guides describe the snapped rect: spans are emitted after dx/dy are
  // settled, so a drag snapped on both axes draws aligned guides.
  let vGuide: { at: number; r: Rect | null } | null = null;
  let hGuide: { at: number; r: Rect | null } | null = null;

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
      vGuide = { at: bestX.at, r: bestX.r };
    }
    if (bestY) {
      dy = bestY.d;
      hGuide = { at: bestY.at, r: bestY.r };
    }
  }

  if (SNAP_TO_GRID) {
    if (dx === 0) {
      const gx = Math.round((moving.x + dx) / GRID) * GRID;
      const d = gx - moving.x;
      if (Math.abs(d) <= t) {
        dx = d;
        vGuide = { at: gx, r: null };
      }
    }
    if (dy === 0) {
      const gy = Math.round((moving.y + dy) / GRID) * GRID;
      const d = gy - moving.y;
      if (Math.abs(d) <= t) {
        dy = d;
        hGuide = { at: gy, r: null };
      }
    }
  }

  const sx = moving.x + dx;
  const sy = moving.y + dy;
  if (vGuide) {
    guides.push({
      axis: 'v',
      at: vGuide.at,
      from: vGuide.r ? Math.min(sy, vGuide.r.y) : sy - 4,
      to: vGuide.r ? Math.max(sy + moving.h, vGuide.r.y + vGuide.r.h) : sy + moving.h + 4,
    });
  }
  if (hGuide) {
    guides.push({
      axis: 'h',
      at: hGuide.at,
      from: hGuide.r ? Math.min(sx, hGuide.r.x) : sx - 4,
      to: hGuide.r ? Math.max(sx + moving.w, hGuide.r.x + hGuide.r.w) : sx + moving.w + 4,
    });
  }

  return { dx, dy, guides };
}
