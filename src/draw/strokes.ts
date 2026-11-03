import type { Stroke } from '../state/schema';
import { strokesBBox } from '../state/schema';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    pts: s.pts.map((p): [number, number] => [p[0], p[1]]),
    ...(s.widths ? { widths: s.widths.slice() } : {}),
  }));
}

export function strokeD(s: Stroke): string {
  if (!s.pts.length) return '';
  if (s.pts.length === 1) {
    const [x, y] = s.pts[0]!;
    return `M ${x} ${y} L ${x + 0.01} ${y + 0.01}`;
  }
  let d = `M ${s.pts[0]?.[0]} ${s.pts[0]?.[1]}`;
  for (let i = 1; i < s.pts.length; i++) d += ` L ${s.pts[i]?.[0]} ${s.pts[i]?.[1]}`;
  return d;
}

// Variable-width strokes (ink effect) render as a filled outline built
// from per-point perpendicular offsets instead of a stroked path.
export function strokeOutlineD(s: Stroke): string {
  const w = s.widths;
  if (!w || !s.pts.length) return strokeD(s);
  if (s.pts.length === 1) {
    const [x, y] = s.pts[0]!;
    const r = Math.max(0.4, w[0]! / 2);
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }
  const n = s.pts.length;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = s.pts[i]!;
    const [px, py] = s.pts[Math.max(0, i - 1)]!;
    const [nx, ny] = s.pts[Math.min(n - 1, i + 1)]!;
    let dx = nx - px;
    let dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const hw = Math.max(0.3, (w[i] ?? s.size) / 2);
    left.push([x - dy * hw, y + dx * hw]);
    right.push([x + dy * hw, y - dx * hw]);
  }
  let d = `M ${left[0]?.[0]} ${left[0]?.[1]}`;
  for (let i = 1; i < n; i++) d += ` L ${left[i]?.[0]} ${left[i]?.[1]}`;
  for (let i = n - 1; i >= 0; i--) d += ` L ${right[i]?.[0]} ${right[i]?.[1]}`;
  return `${d} Z`;
}

export function strokePathEl(s: Stroke): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path');
  if (s.widths?.length) {
    p.setAttribute('d', strokeOutlineD(s));
    p.setAttribute('fill', s.color);
    p.setAttribute('stroke', 'none');
    return p;
  }
  p.setAttribute('d', strokeD(s));
  p.setAttribute('stroke', s.color);
  p.setAttribute('stroke-width', String(s.size));
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  return p;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Distance from a point to the stroke polyline; Infinity for empty strokes.
function strokeDist(s: Stroke, x: number, y: number): number {
  if (!s.pts.length) return Infinity;
  if (s.pts.length === 1) return Math.hypot(x - s.pts[0]?.[0], y - s.pts[0]?.[1]);
  let best = Infinity;
  for (let i = 0; i + 1 < s.pts.length; i++) {
    best = Math.min(best, segDist(x, y, s.pts[i]?.[0], s.pts[i]?.[1], s.pts[i + 1]?.[0], s.pts[i + 1]?.[1]));
  }
  return best;
}

// Topmost stroke whose line passes within tol of (x, y).
export function hitStroke(strokes: Stroke[], x: number, y: number, tol: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    const w = s.widths?.length ? Math.max(...s.widths) : s.size;
    if (strokeDist(s, x, y) <= w / 2 + tol) return i;
  }
  return -1;
}

export function translateStroke(s: Stroke, dx: number, dy: number) {
  for (const p of s.pts) {
    p[0] += dx;
    p[1] += dy;
  }
}

// Stroke colours come from the palette, but an imported doc could carry
// anything: keep attribute interpolation to real colour values.
const SVG_SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

// Standalone .svg file for the annotation Download SVG action.
export function strokesToSvgFile(strokes: Stroke[], offsetX = 0, offsetY = 0): string {
  const box = strokesBBox(strokes);
  const w = Math.max(1, Math.ceil(box.w));
  const h = Math.max(1, Math.ceil(box.h));
  const paths = strokes
    .map((s) => {
      const color = SVG_SAFE_COLOR.test(s.color) ? s.color : '#000';
      const moved = {
        ...s,
        pts: s.pts.map(([x, y]): [number, number] => [x + offsetX - box.x, y + offsetY - box.y]),
      };
      return s.widths?.length
        ? `<path d="${strokeOutlineD(moved)}" fill="${color}"/>`
        : `<path d="${strokeD(moved)}" stroke="${color}" stroke-width="${s.size}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('\n  ');
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n  ${paths}\n</svg>\n`;
}

export function downloadTextFile(name: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
