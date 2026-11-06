import type { App } from '../app';
import { unionRect } from '../canvas/hit';
import { cardBg, isDark } from './theme';

const MAP_W = 180;
const MAP_H = 120;

// Corner minimap: a shrunken view of the current board's card extents
// with the visible viewport outlined. Click or drag pans the board.
// Drawn from render(), so it stays in lockstep with pans and edits.
export class Minimap {
  node: HTMLElement;

  private cv: HTMLCanvasElement;

  private scale = 1;

  private ox = 0;

  private oy = 0;

  constructor(private a: App) {
    this.node = document.createElement('div');
    this.node.className = 'minimap';
    this.node.style.display = 'none';
    this.cv = document.createElement('canvas');
    this.node.appendChild(this.cv);
    // Pointer events must not reach the board's pan/marquee handlers.
    // Only a gesture that began on the minimap pans the board: board
    // drags track on window, so a card drag crossing the corner must
    // not hijack the view.
    this.node.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.node.setPointerCapture(e.pointerId);
      this.panning = true;
      this.jump(e);
    });
    this.node.addEventListener('pointermove', (e) => {
      if (this.panning) this.jump(e);
    });
    const stop = () => {
      this.panning = false;
    };
    this.node.addEventListener('pointerup', stop);
    this.node.addEventListener('pointercancel', stop);
    this.node.addEventListener('click', (e) => e.stopPropagation());
    this.node.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  private panning = false;

  // Map a minimap point back to board space and centre the view on it.
  private jump(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    const bx = (e.clientX - r.left - this.ox) / this.scale;
    const by = (e.clientY - r.top - this.oy) / this.scale;
    const vp = this.a.vp;
    // snapTo also cancels a running zoom tween; direct x/y writes
    // would be overwritten each frame until it settles.
    vp.snapTo({ x: vp.vw / 2 - bx * vp.z, y: vp.vh / 2 - by * vp.z, z: vp.z });
  }

  draw() {
    const vp = this.a.vp;
    const els = this.a.layer
      .elements()
      .filter((e) => e.type !== 'line' && e.anchorId === undefined && e.parentId === null);
    const ctx = this.cv.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    if (this.cv.width !== MAP_W * dpr || this.cv.height !== MAP_H * dpr) {
      this.cv.width = MAP_W * dpr;
      this.cv.height = MAP_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    if (!els.length) {
      // An empty board still needs a sane transform for jump():
      // board origin at map centre, unit scale.
      this.scale = 1;
      this.ox = MAP_W / 2;
      this.oy = MAP_H / 2;
      return;
    }
    // The view rect joins the bounds so it can never slide off-map.
    const view = { x: -vp.x / vp.z, y: -vp.y / vp.z, w: vp.vw / vp.z, h: vp.vh / vp.z };
    const cards = unionRect(els.map((e) => this.a.layer.rectOf(e)))!;
    const u = unionRect([cards, view])!;
    const pad = 6;
    this.scale = Math.min((MAP_W - pad * 2) / Math.max(u.w, 1), (MAP_H - pad * 2) / Math.max(u.h, 1));
    this.ox = (MAP_W - u.w * this.scale) / 2 - u.x * this.scale;
    this.oy = (MAP_H - u.h * this.scale) / 2 - u.y * this.scale;
    const dark = isDark();
    for (const e of els) {
      const r = this.a.layer.rectOf(e);
      ctx.fillStyle = e.color ? cardBg(e.color) : dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)';
      const x = this.ox + r.x * this.scale;
      const y = this.oy + r.y * this.scale;
      const w = Math.max(1.5, r.w * this.scale);
      const h = Math.max(1.5, r.h * this.scale);
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.ox + view.x * this.scale, this.oy + view.y * this.scale, view.w * this.scale, view.h * this.scale);
  }
}
