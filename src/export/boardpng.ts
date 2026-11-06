import { GRID, lineDoc, type Element, type LineMarker, type LineWeight, type Stroke } from '../state/schema';
import { canvasColors, cardBg } from '../ui/theme';
import type { Rect } from '../canvas/viewport';
import type { SceneLine } from '../canvas/renderer';
import { midpoint } from '../canvas/lines';

// Board raster export: dot-grid backdrop + canvas line pass + the DOM
// card layer flattened through an svg foreignObject snapshot. When the
// snapshot path fails (Safari taints foreignObject rasters) we degrade
// to a simple canvas card renderer: rounded rect + plain text.


const LINE_W: Record<LineWeight, number> = { thin: 1, medium: 1.8, thick: 4 };
const MAX_EDGE = 16000;

export interface FallbackCard {
  rect: Rect;
  label: string;
  color: string | undefined;
}

export interface ShotSpec {
  bounds: Rect;
  grid: boolean;
  lines: SceneLine[];
  // Prepared foreignObject wrapper (embedded <style> + positioned
  // clones), or null to force the canvas fallback.
  dom: HTMLElement | null;
  cards: FallbackCard[];
  // Annotation elements in board space (fallback path only).
  annotations: Element[];
  // Comment pins to stamp in the fallback path (anchor comments).
  pins: Rect[];
}

// Compiled stylesheet text for embedding in the foreignObject clone.
// Same-origin rules only; no fetching involved.
function collectCss(): string {
  let out = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) out += `${rule.cssText}\n`;
    } catch {
      /* cross-origin sheet: skip */
    }
  }
  // The shot root is a div, not body, so re-anchor the body-scoped
  // selectors (all theme vars live on body / body.dark) to .board-shot.
  // Only selector-start positions match: after { } , or at text start,
  // and only with a rule body ahead, so a 'body' inside a declaration
  // value (font-family lists, content strings) stays literal.
  return out.replace(/(^|[{},])(\s*)body(?=[^{};]*\{)/gm, '$1$2.board-shot');
}

// Wrap the cloned card/overlay layers into a positioned snapshot root
// covering `bounds` in board coordinates.
export function buildShotDom(cards: HTMLElement, overlays: HTMLElement[], bounds: Rect, zOf?: (id: string) => number | undefined): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `board-shot${document.body.classList.contains('dark') ? ' dark' : ''}`;
  wrap.style.cssText =
    'position:relative;overflow:hidden;' +
    `width:${Math.round(bounds.w)}px;height:${Math.round(bounds.h)}px;` +
    "font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
  const ui = getComputedStyle(document.body).getPropertyValue('--ui').trim();
  if (ui) wrap.style.setProperty('--ui', ui);
  const style = document.createElement('style');
  style.textContent = collectCss();
  const inner = document.createElement('div');
  inner.style.cssText = `position:absolute;left:${-Math.round(bounds.x)}px;top:${-Math.round(bounds.y)}px;width:0;height:0`;
  const cardsClone = cards.cloneNode(true) as HTMLElement;
  if (zOf) {
    // Overlay children (pins, anno svgs, pills, chips) honour el.z:
    // merge them into the card stack instead of painting the whole
    // layer above the cards. Unmarked nodes trail in DOM order.
    const kids = [...cardsClone.children] as HTMLElement[];
    const extras = overlays.flatMap((n) => [...(n.cloneNode(true) as HTMLElement).children] as HTMLElement[]);
    const key = (n: HTMLElement) => (n.dataset.id !== undefined ? (zOf(n.dataset.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER);
    cardsClone.textContent = '';
    cardsClone.append(...[...kids, ...extras].sort((a, b) => key(a) - key(b)));
    inner.appendChild(cardsClone);
  } else {
    inner.appendChild(cardsClone);
    for (const n of overlays) inner.appendChild(n.cloneNode(true) as HTMLElement);
  }
  // An iframe inside a foreignObject stops HTML from rasterizing (embed
  // players). Swap each for an empty div so the card chrome survives.
  for (const frame of inner.querySelectorAll('iframe')) {
    const stub = document.createElement('div');
    stub.className = frame.className;
    stub.style.cssText = frame.getAttribute('style') ?? '';
    frame.replaceWith(stub);
  }
  wrap.append(style, inner);
  return wrap;
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  });
}

// blob: object URLs cannot load inside an svg-image document; swap every
// cloned <img> src for a data: URL.
export async function inlineBlobImages(root: HTMLElement) {
  const imgs = [...root.querySelectorAll('img')];
  const srcs = [...new Set(imgs.map((i) => i.src).filter((s) => s.startsWith('blob:')))];
  const map = new Map<string, string>();
  await Promise.all(
    srcs.map(async (s) => {
      try {
        const b = await fetch(s).then((r) => r.blob());
        map.set(s, await blobToDataUrl(b));
      } catch {
        /* leave the blob src; it renders empty */
      }
    }),
  );
  for (const im of imgs) {
    const d = map.get(im.src);
    if (d) im.src = d;
  }
}

// Wait for mounted card views to finish their async image loads.
export async function settleImages(root: HTMLElement, budgetMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 60));
    const pending = [...root.querySelectorAll('img')].some(
      (i) =>
        (i.src && !i.complete) ||
        // Card images get src only after blobUrl resolves, so an im-img
        // with no src is still loading (hidden = load failed, done).
        (!i.getAttribute('src') && i.style.display !== 'none' && i.classList.contains('im-img')),
    );
    if (!pending || Date.now() - t0 > budgetMs) return;
  }
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    // A hung svg decode never fires onload/onerror; bound the wait so
    // export degrades to the canvas fallback instead of wedging.
    const timer = setTimeout(() => rej(new Error('svg image timed out')), 5000);
    img.onload = () => {
      clearTimeout(timer);
      res(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      rej(new Error('svg image failed'));
    };
    img.src = url;
  });
}

// Rasterize the DOM wrapper through a foreignObject svg. Throws when the
// environment refuses (image decode error or a tainted canvas). The svg
// travels as a data: URL, not blob:: Chrome and Safari taint canvases
// after drawing blob-URL svgs with foreignObject but not data-URL ones.
async function domToRaster(host: HTMLElement, w: number, h: number, scale: number): Promise<HTMLCanvasElement> {
  const xml = new XMLSerializer().serializeToString(host);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" ` +
    `viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = await loadImg(url);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  // Taint check: throws SecurityError on a poisoned canvas.
  void cv.toDataURL();
  return cv;
}

function drawDots(ctx: CanvasRenderingContext2D, b: Rect) {
  const r = 1.6;
  ctx.fillStyle = canvasColors().grid;
  ctx.beginPath();
  for (let x = Math.floor(b.x / GRID) * GRID; x < b.x + b.w + GRID; x += GRID) {
    for (let y = Math.floor(b.y / GRID) * GRID; y < b.y + b.h + GRID; y += GRID) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, m: LineMarker, w: number) {
  if (m === 'arrow') {
    const s = 5 + w * 2.2;
    const bx = x - Math.cos(ang) * s;
    const by = y - Math.sin(ang) * s;
    const px = -Math.sin(ang) * s * 0.42;
    const py = Math.cos(ang) * s * 0.42;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(bx + px, by + py);
    ctx.lineTo(bx - px, by - py);
    ctx.closePath();
    ctx.fill();
  } else if (m === 'dot') {
    ctx.beginPath();
    ctx.arc(x, y, 2.2 + w * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSceneLine(ctx: CanvasRenderingContext2D, l: SceneLine) {
  const c = lineDoc(l.el);
  if (!c) return;
  const w = LINE_W[c.weight ?? 'medium'];
  const ink = l.el.color ?? canvasColors().ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = w;
  ctx.setLineDash(c.dashed ? [5, 5] : []);
  const pts = l.pts;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ink;
  const p2 = pts[1] ?? { x: l.x2, y: l.y2 };
  const pb = pts[pts.length - 2] ?? { x: l.x1, y: l.y1 };
  drawMarker(ctx, l.x1, l.y1, Math.atan2(pts[0]!.y - p2.y, pts[0]!.x - p2.x), c.fromMarker, w);
  drawMarker(ctx, l.x2, l.y2, Math.atan2(pts[pts.length - 1]!.y - pb.y, pts[pts.length - 1]!.x - pb.x), c.toMarker, w);
}

// Default card surface for the canvas fallback: the --card css var the
// DOM cards use, so the degraded pass follows the theme.
function cardSurface(): string {
  return getComputedStyle(document.body).getPropertyValue('--card').trim() || '#fff';
}

// Fallback label pill: small lozenge behind the label text at the
// line midpoint.
function drawLineLabel(ctx: CanvasRenderingContext2D, l: SceneLine) {
  const label = lineDoc(l.el)?.label;
  if (!label) return;
  const m = midpoint(l);
  ctx.font = '12px -apple-system, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = cardSurface();
  ctx.beginPath();
  ctx.roundRect(m.x - tw / 2 - 8, m.y - 11, tw + 16, 22, 11);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,20,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = canvasColors().ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, m.x, m.y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawFallbackCard(ctx: CanvasRenderingContext2D, card: FallbackCard) {
  const { rect: r, label, color } = card;
  ctx.fillStyle = cardBg(color) || cardSurface();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,20,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (!label) return;
  ctx.fillStyle = canvasColors().ink;
  ctx.font = '13px -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  const words = label.split(/\s+/);
  const maxW = r.w - 24;
  const maxLines = Math.max(1, Math.floor((r.h - 20) / 18));
  let line = '';
  let n = 0;
  for (const word of words) {
    const cand = line ? `${line} ${word}` : word;
    if (ctx.measureText(cand).width > maxW && line) {
      if (++n >= maxLines) break;
      ctx.fillText(line, r.x + 12, r.y + 10 + (n - 1) * 18);
      line = word;
    } else {
      line = cand;
    }
  }
  if (line && n < maxLines) ctx.fillText(line, r.x + 12, r.y + 10 + n * 18);
  ctx.textBaseline = 'alphabetic';
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], ox: number, oy: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.pts.length) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(ox + s.pts[0]![0], oy + s.pts[0]![1]);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(ox + s.pts[i]![0], oy + s.pts[i]![1]);
    ctx.stroke();
  }
}

function drawPin(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.fillStyle = cardSurface();
  ctx.beginPath();
  ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,20,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = canvasColors().ink;
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('...', r.x + r.w / 2, r.y + r.h / 2 - 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// Full board raster at `scale` (CSS px per board unit). Background,
// dot grid, lines, then cards via foreignObject or the fallback pass.
export async function renderBoardShot(spec: ShotSpec, scale: number): Promise<HTMLCanvasElement> {
  const { bounds } = spec;
  const s = Math.min(scale, MAX_EDGE / Math.max(bounds.w, bounds.h, 1));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bounds.w * s));
  cv.height = Math.max(1, Math.round(bounds.h * s));
  const ctx = cv.getContext('2d')!;
  ctx.scale(s, s);
  ctx.translate(-bounds.x, -bounds.y);
  ctx.fillStyle = canvasColors().bg;
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  if (spec.grid) drawDots(ctx, bounds);
  for (const l of spec.lines) drawSceneLine(ctx, l);

  let dom: HTMLCanvasElement | null = null;
  if (spec.dom) {
    try {
      dom = await domToRaster(spec.dom, bounds.w, bounds.h, s);
    } catch {
      dom = null;
    }
  }
  if (dom) {
    ctx.drawImage(dom, 0, 0, dom.width, dom.height, bounds.x, bounds.y, bounds.w, bounds.h);
  } else {
    for (const c of spec.cards) drawFallbackCard(ctx, c);
    for (const el of spec.annotations) {
      const a = 'annotation' in el.content ? el.content.annotation.strokes : [];
      drawStrokes(ctx, a, el.x, el.y);
    }
    for (const l of spec.lines) drawLineLabel(ctx, l);
    for (const r of spec.pins) drawPin(ctx, r);
  }
  return cv;
}

export function toBlob(cv: HTMLCanvasElement, type: string, q?: number): Promise<Blob | null> {
  return new Promise((res) => cv.toBlob((b) => res(b), type, q));
}
