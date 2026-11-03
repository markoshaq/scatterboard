import { GRID, lineDoc, type Element, type LineMarker, type LineWeight } from '../state/schema';
import { canvasColors, type CanvasColors } from '../ui/theme';
import type { Rect, Viewport } from './viewport';

export interface Guide {
  axis: 'v' | 'h';
  at: number;
  from: number;
  to: number;
}

export interface SceneLine {
  el: Element;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selected: boolean;
  dim?: boolean;
}

export interface DraftLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Scene {
  grid: boolean;
  marquee: Rect | null;
  guides: Guide[];
  guideAlpha: number;
  outlines: { rect: Rect; radius: number }[];
  lines: SceneLine[];
  draft: DraftLine | null;
}

const EMPTY_SCENE: Scene = { grid: true, marquee: null, guides: [], guideAlpha: 1, outlines: [], lines: [], draft: null };

export const LINE_W: Record<LineWeight, number> = { thin: 1, medium: 1.8, thick: 4 };

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  // Second canvas stacked above .doc: selection/drag chrome must paint
  // over cards, not under them.
  private chrome: CanvasRenderingContext2D;
  private chromeEl: HTMLCanvasElement;
  private vp: Viewport;
  private scene: Scene = EMPTY_SCENE;
  private queued = false;
  private cc: CanvasColors = canvasColors();
  // One-tile dot-grid pattern cache keyed on (tile px, radius, theme);
  // the grid paints as a single pattern fill instead of per-dot rects
  // at deep zoom-out.
  private gridTile: { key: string; canvas: HTMLCanvasElement; scale: number } | null = null;

  constructor(canvas: HTMLCanvasElement, chromeEl: HTMLCanvasElement, vp: Viewport) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.chromeEl = chromeEl;
    this.chrome = chromeEl.getContext('2d')!;
    this.vp = vp;
  }

  setScene(s: Scene) {
    this.scene = s;
    this.invalidate();
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(this.vp.vw * dpr);
    this.canvas.height = Math.round(this.vp.vh * dpr);
    this.chromeEl.width = Math.round(this.vp.vw * dpr);
    this.chromeEl.height = Math.round(this.vp.vh * dpr);
    this.invalidate();
  }

  invalidate() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw() {
    this.cc = canvasColors();
    const { ctx, vp, scene } = this;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vp.vw, vp.vh);
    ctx.setTransform(dpr * vp.z, 0, 0, dpr * vp.z, dpr * vp.x, dpr * vp.y);
    if (scene.grid) this.drawGrid();
    // Skip lines whose bounding box misses the view: hundreds of
    // off-canvas lines should cost a compare, not a stroke.
    const vr = vp.viewRect(0);
    const lp = 12 + 8 / vp.z;
    for (const l of scene.lines) {
      const lx = Math.min(l.x1, l.x2) - lp;
      const ly = Math.min(l.y1, l.y2) - lp;
      const lw = Math.abs(l.x2 - l.x1) + lp * 2;
      const lh = Math.abs(l.y2 - l.y1) + lp * 2;
      if (lx > vr.x + vr.w || lx + lw < vr.x || ly > vr.y + vr.h || ly + lh < vr.y) continue;
      this.drawLine(l);
    }
    // Outlines paint under .doc so pins and chips sit above the ring.
    for (const o of scene.outlines) this.drawOutline(o.rect, o.radius);

    const chrome = this.chrome;
    chrome.setTransform(dpr, 0, 0, dpr, 0, 0);
    chrome.clearRect(0, 0, vp.vw, vp.vh);
    chrome.setTransform(dpr * vp.z, 0, 0, dpr * vp.z, dpr * vp.x, dpr * vp.y);
    this.ctx = chrome;
    for (const l of scene.lines) {
      if (l.selected) {
        this.drawGrab(l.x1, l.y1);
        this.drawGrab(l.x2, l.y2);
      }
    }
    if (scene.draft) this.drawDraft(scene.draft);
    for (const g of scene.guides) this.drawGuide(g);
    if (scene.marquee) this.drawMarquee(scene.marquee);
    this.ctx = ctx;
  }

  // Runs in board space: the pattern anchors at board (0,0) so dots
  // land on step multiples with no phase term. Quarter-dots at the
  // tile's corners let neighbours complete each dot.
  private drawGrid() {
    const { ctx, vp } = this;
    let step = GRID;
    while (step * vp.z < 16) step *= 2;
    const r = Math.max(0.8, Math.min(1.6, 1.6 * vp.z));
    const dpr = devicePixelRatio || 1;
    const w = Math.max(8, Math.round(step * vp.z * dpr));
    const key = `${w}|${r.toFixed(2)}|${this.cc.grid}`;
    if (this.gridTile?.key !== key) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = w;
      const tc = canvas.getContext('2d');
      if (!tc) return;
      const rr = r * dpr;
      tc.fillStyle = this.cc.grid;
      for (const [cx, cy] of [
        [0, 0],
        [w, 0],
        [0, w],
        [w, w],
      ] as const) {
        tc.beginPath();
        tc.arc(cx, cy, rr, 0, Math.PI * 2);
        tc.fill();
      }
      this.gridTile = { key, canvas, scale: w / step };
    }
    const pat = ctx.createPattern(this.gridTile.canvas, 'repeat');
    if (!pat) return;
    // Tile px -> board units, so the period is exactly `step` even at
    // fractional zooms.
    pat.setTransform(new DOMMatrix().scale(1 / this.gridTile.scale));
    ctx.fillStyle = pat;
    const vr = vp.viewRect(0);
    ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
  }

  private drawLine(l: SceneLine) {
    const { ctx, vp } = this;
    const c = lineDoc(l.el);
    if (!c) return;
    ctx.globalAlpha = l.dim ? 0.15 : 1;
    const w = LINE_W[c.weight];
    const ink = l.el.color ?? this.cc.ink;
    if (l.selected) {
      ctx.strokeStyle = this.cc.selHalo;
      ctx.lineWidth = w + 6 / vp.z;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = w;
    ctx.setLineDash(c.dashed ? [5, 5] : []);
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ink;
    this.drawMarker(l.x1, l.y1, Math.atan2(l.y1 - l.y2, l.x1 - l.x2), c.fromMarker, w);
    this.drawMarker(l.x2, l.y2, Math.atan2(l.y2 - l.y1, l.x2 - l.x1), c.toMarker, w);
    ctx.globalAlpha = 1;
  }

  private drawMarker(x: number, y: number, ang: number, m: LineMarker, w: number) {
    const { ctx } = this;
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

  private drawGrab(x: number, y: number) {
    const { ctx, vp } = this;
    const s = 7 / vp.z;
    ctx.fillStyle = this.cc.grab;
    ctx.strokeStyle = this.cc.accent;
    ctx.lineWidth = 1.5 / vp.z;
    ctx.beginPath();
    ctx.rect(x - s / 2, y - s / 2, s, s);
    ctx.fill();
    ctx.stroke();
  }

  private drawDraft(d: DraftLine) {
    const { ctx } = this;
    ctx.strokeStyle = this.cc.accent;
    ctx.fillStyle = this.cc.accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(d.x1, d.y1);
    ctx.lineTo(d.x2, d.y2);
    ctx.stroke();
    this.drawMarker(d.x2, d.y2, Math.atan2(d.y2 - d.y1, d.x2 - d.x1), 'arrow', 1.8);
  }

  private drawGuide(g: Guide) {
    const { ctx, vp } = this;
    ctx.globalAlpha = this.scene.guideAlpha;
    ctx.strokeStyle = this.cc.guide;
    ctx.lineWidth = 1 / vp.z;
    ctx.beginPath();
    if (g.axis === 'v') {
      ctx.moveTo(g.at, g.from);
      ctx.lineTo(g.at, g.to);
    } else {
      ctx.moveTo(g.from, g.at);
      ctx.lineTo(g.to, g.at);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawOutline(r: Rect, radius: number) {
    const { ctx, vp } = this;
    const pad = 3 / vp.z;
    ctx.strokeStyle = this.cc.accent;
    ctx.lineWidth = 1.5 / vp.z;
    ctx.beginPath();
    // Concentric with the card's own corner: radius + pad, in board units.
    ctx.roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, radius + pad);
    ctx.stroke();
  }

  private drawMarquee(r: Rect) {
    const { ctx, vp } = this;
    ctx.fillStyle = this.cc.marqF;
    ctx.strokeStyle = this.cc.marqS;
    ctx.lineWidth = 1 / vp.z;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
}
