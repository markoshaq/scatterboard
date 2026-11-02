import type { Stroke } from '../state/schema';
import { t } from '../strings';
import { ICONS } from '../ui/icons';
import { openToolPopup } from '../ui/popup';
import { cloneStrokes, hitStroke, strokeD, strokeOutlineD, strokePathEl, translateStroke } from './strokes';

const DRAW_COLORS = [
  '#323b4a',
  '#d6504a',
  '#e8734a',
  '#d9a62e',
  '#5f9e5f',
  '#3d84e0',
  '#8a5fd6',
  '#d6508f',
  '#8d8d7a',
];
const DRAW_SIZES = [2, 4, 8, 14];
const SVG_NS = 'http://www.w3.org/2000/svg';

type Tool = 'pen' | 'select' | 'eraser';

// Per-point widths for the ink effect. Real pen pressure wins; when it
// stays flat (mouse reports 0.5) fall back to speed: fast = thin.
function inkWidths(s: Stroke, pressures: number[], times: number[]): number[] {
  const n = s.pts.length;
  const varied = pressures.some((p) => Math.abs(p - pressures[0]!) > 0.03);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let f: number;
    if (varied) {
      const p = Math.min(1, Math.max(0.05, pressures[i] ?? 0.5));
      f = 0.3 + p * 1.5;
    } else {
      const i0 = Math.max(0, i - 1);
      const dist = Math.hypot(s.pts[i]?.[0] - s.pts[i0]?.[0], s.pts[i]?.[1] - s.pts[i0]?.[1]);
      const dt = Math.max(4, (times[i] ?? 0) - (times[i0] ?? 0));
      const v = dist / dt; // px per ms
      f = Math.min(1.6, Math.max(0.3, 1.45 - v * 1.1));
    }
    out.push(Math.max(0.5, s.size * f));
  }
  return out;
}

interface PadMount {
  // Element that receives pointer input (the capture surface).
  surface: HTMLElement;
  // Element the live svg is appended to (screen- or board-space parent).
  svgParent: HTMLElement;
  // Pointer event -> stroke-space coords.
  project(e: PointerEvent): { x: number; y: number };
  // Erase/select hit tolerance in stroke-space units.
  tol: number;
  // Set when stroke space differs from css pixels (image draw-on uses
  // the image's natural pixel space).
  viewBox?: string;
}

interface DrawPadOpts {
  initial?: Stroke[];
  // Ink effect (pref): capture per-point widths from pointer pressure,
  // falling back to stroke speed when pressure stays flat.
  ink?: boolean | undefined;
  onSave(strokes: Stroke[]): void;
  onCancel(): void;
}

// Shared pen/select/eraser session: floating toolbar, stroke-level
// undo/redo (independent of the app store), V/E/C/X/1-4 shortcuts.
// Used by the sketch card editor and board draw mode.
export class DrawPad {
  readonly tools: HTMLElement;
  private strokes: Stroke[];
  private past: Stroke[][] = [];
  private future: Stroke[][] = [];
  private tool: Tool = 'pen';
  private color = DRAW_COLORS[0]!;
  private prevColor = DRAW_COLORS[1]!;
  private sizeIdx = 1;
  private sel = -1;
  private opts: DrawPadOpts;
  private svg: SVGSVGElement | null = null;
  private surface: HTMLElement | null = null;
  private project: ((e: PointerEvent) => { x: number; y: number }) | null = null;
  private tol = 6;
  private live: SVGPathElement | null = null;
  private gesturePid: number | null = null;
  // The in-flight pointer gesture's listeners: destroy() must detach
  // them too or a torn-down pad keeps mutating on pointer events.
  private gesture: { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null = null;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private sizeBtns: HTMLButtonElement[] = [];
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private swatchEl!: HTMLElement;

  constructor(opts: DrawPadOpts) {
    this.opts = opts;
    this.strokes = cloneStrokes(opts.initial ?? []);
    this.tools = document.createElement('div');
    this.tools.className = 'draw-tools';
    this.buildTools();
    window.addEventListener('keydown', this.onKey, true);
  }

  mount(m: PadMount) {
    this.surface = m.surface;
    this.project = m.project;
    this.tol = m.tol;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('draw-svg');
    if (m.viewBox) this.svg.setAttribute('viewBox', m.viewBox);
    m.svgParent.appendChild(this.svg);
    m.surface.addEventListener('pointerdown', this.onDown);
    this.syncToolState();
    this.renderAll();
    this.syncFoot();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey, true);
    if (this.surface) {
      this.surface.removeEventListener('pointerdown', this.onDown);
      if (this.gesture) {
        this.surface.removeEventListener('pointermove', this.gesture.move);
        this.surface.removeEventListener('pointerup', this.gesture.up);
        this.surface.removeEventListener('pointercancel', this.gesture.up);
      }
    }
    this.gesture = null;
    this.gesturePid = null;
    this.svg?.remove();
    this.tools.remove();
  }

  get hasStrokes() {
    return this.strokes.length > 0;
  }

  // Snapshot for callers committing strokes outside Save (image
  // editor mode chips patch before swapping modes).
  peek(): Stroke[] {
    return cloneStrokes(this.strokes);
  }

  private pushUndo(before: Stroke[]) {
    this.past.push(before);
    if (this.past.length > 60) this.past.shift();
    this.future = [];
    this.syncFoot();
  }

  private undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(cloneStrokes(this.strokes));
    this.strokes = prev;
    this.sel = -1;
    this.renderAll();
    this.syncFoot();
  }

  private redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(cloneStrokes(this.strokes));
    this.strokes = next;
    this.sel = -1;
    this.renderAll();
    this.syncFoot();
  }

  // --- toolbar ---

  private mkBtn(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dt-btn';
    b.title = label;
    b.innerHTML = icon;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  }

  private sep(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'dt-sep';
    return s;
  }

  private buildTools() {
    const bar = this.tools;
    for (const [tool, icon, label] of [
      ['pen', ICONS.pen, t('drawPen')],
      ['select', ICONS.selTool, t('drawSelect')],
      ['eraser', ICONS.eraser, t('drawEraser')],
    ] as [Tool, string, string][]) {
      const b = this.mkBtn(icon, label, () => this.setTool(tool));
      this.toolBtns.set(tool, b);
      bar.appendChild(b);
    }
    bar.appendChild(this.sep());

    const color = document.createElement('button');
    color.type = 'button';
    color.className = 'dt-btn dt-color';
    color.title = t('drawColor');
    this.swatchEl = document.createElement('span');
    this.swatchEl.className = 'dt-swatch';
    color.appendChild(this.swatchEl);
    color.addEventListener('click', () => this.openPalette(color));
    bar.appendChild(color);

    const weights = document.createElement('span');
    weights.className = 'dt-weight';
    weights.title = t('drawWeight');
    DRAW_SIZES.forEach((sz, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dt-wbtn';
      b.title = `${t('drawWeight')} ${i + 1}`;
      b.innerHTML = `<svg viewBox="0 0 20 20"><path d="M3 10h14" stroke="currentColor" stroke-width="${Math.min(5, 0.8 + sz * 0.4)}" stroke-linecap="round"/></svg>`;
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.setSize(i));
      this.sizeBtns.push(b);
      weights.appendChild(b);
    });
    bar.appendChild(weights);
    bar.appendChild(this.sep());

    this.undoBtn = this.mkBtn(ICONS.undo, t('drawUndo'), () => this.undo());
    this.redoBtn = this.mkBtn(ICONS.redo, t('drawRedo'), () => this.redo());
    bar.append(this.undoBtn, this.redoBtn, this.sep());

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'dt-act';
    this.cancelBtn.addEventListener('click', () => this.opts.onCancel());
    this.saveBtn = document.createElement('button');
    this.saveBtn.type = 'button';
    this.saveBtn.className = 'dt-act dt-save';
    this.saveBtn.textContent = t('drawSave');
    this.saveBtn.addEventListener('click', () => this.save());
    bar.append(this.cancelBtn, this.saveBtn);
  }

  private openPalette(anchor: HTMLElement) {
    const node = document.createElement('div');
    node.className = 'cp-body';
    const grid = document.createElement('div');
    grid.className = 'cp-grid';
    for (const c of DRAW_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-swatch';
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => this.setColor(c));
      grid.appendChild(b);
    }
    const custom = document.createElement('label');
    custom.className = 'cp-swatch cp-custom';
    custom.title = t('colorCustom');
    const well = document.createElement('input');
    well.type = 'color';
    well.name = 'pen-color';
    well.value = this.color;
    well.addEventListener('input', () => this.setColor(well.value));
    custom.appendChild(well);
    grid.appendChild(custom);
    node.appendChild(grid);
    openToolPopup(anchor, node);
  }

  private setColor(c: string) {
    if (c === this.color) return;
    this.prevColor = this.color;
    this.color = c;
    this.syncToolState();
  }

  private cycleColor() {
    const i = DRAW_COLORS.indexOf(this.color);
    this.setColor(DRAW_COLORS[(i + 1) % DRAW_COLORS.length]!);
  }

  private setTool(tool: Tool) {
    this.tool = tool;
    this.syncToolState();
  }

  private setSize(i: number) {
    this.sizeIdx = i;
    this.syncToolState();
  }

  private syncToolState() {
    for (const [tool, b] of this.toolBtns) b.classList.toggle('on', tool === this.tool);
    this.sizeBtns.forEach((b, i) => {
      b.classList.toggle('on', i === this.sizeIdx);
    });
    if (this.swatchEl) this.swatchEl.style.background = this.color;
    if (this.surface) this.surface.dataset.tool = this.tool;
  }

  private syncFoot() {
    this.undoBtn.disabled = !this.past.length;
    this.redoBtn.disabled = !this.future.length;
    this.saveBtn.disabled = !this.strokes.length;
    this.cancelBtn.textContent = this.strokes.length ? t('drawDiscard') : t('drawCancel');
  }

  // --- rendering ---

  private renderAll() {
    if (!this.svg) return;
    this.svg.textContent = '';
    this.live = null;
    this.strokes.forEach((s, i) => {
      const p = strokePathEl(s);
      p.classList.add('draw-path');
      if (i === this.sel) p.classList.add('draw-sel');
      this.svg!.appendChild(p);
    });
  }

  private selPath(): SVGPathElement | null {
    return this.svg && this.sel >= 0 ? (this.svg.children[this.sel] as SVGPathElement) : null;
  }

  // --- pointer input ---

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.project || !this.surface || this.gesturePid !== null) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.gesturePid = e.pointerId;
    const p = this.project(e);
    if (this.tool === 'pen') this.penDown(p, e.pointerId);
    else if (this.tool === 'eraser') this.eraseDown(p, e.pointerId);
    else this.selDown(p, e.pointerId);
  };

  private penDown(p: { x: number; y: number }, pid: number) {
    const before = cloneStrokes(this.strokes);
    const size = DRAW_SIZES[this.sizeIdx]!;
    const stroke: Stroke = { pts: [[p.x, p.y]], color: this.color, size };
    this.sel = -1;
    this.live = strokePathEl(stroke);
    this.live.classList.add('draw-path');
    this.svg?.appendChild(this.live);
    const ink = this.opts.ink === true;
    const pressures: number[] = ink ? [0.5] : [];
    const times: number[] = ink ? [performance.now()] : [];
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const q = this.project!(ev);
      const last = stroke.pts[stroke.pts.length - 1]!;
      if (Math.hypot(q.x - last[0], q.y - last[1]) < 1.5) return;
      stroke.pts.push([q.x, q.y]);
      if (ink) {
        pressures.push(ev.pressure);
        times.push(ev.timeStamp);
      }
      this.live!.setAttribute('d', strokeD(stroke));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      this.surface!.removeEventListener('pointermove', move);
      this.surface!.removeEventListener('pointerup', up);
      this.surface!.removeEventListener('pointercancel', up);
      this.gesturePid = null;
      this.gesture = null;
      this.live = null;
      if (ink) stroke.widths = inkWidths(stroke, pressures, times);
      this.strokes.push(stroke);
      this.pushUndo(before);
      this.renderAll();
    };
    this.surface!.addEventListener('pointermove', move);
    this.surface!.addEventListener('pointerup', up);
    this.surface!.addEventListener('pointercancel', up);
    this.gesture = { move, up };
  }

  private eraseDown(p: { x: number; y: number }, pid: number) {
    const before = cloneStrokes(this.strokes);
    let hit = false;
    const eraseAt = (q: { x: number; y: number }) => {
      const i = hitStroke(this.strokes, q.x, q.y, this.tol);
      if (i < 0) return;
      hit = true;
      this.strokes.splice(i, 1);
      if (this.sel === i) this.sel = -1;
      else if (this.sel > i) this.sel--;
      this.renderAll();
    };
    eraseAt(p);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pid) eraseAt(this.project!(ev));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      this.surface!.removeEventListener('pointermove', move);
      this.surface!.removeEventListener('pointerup', up);
      this.surface!.removeEventListener('pointercancel', up);
      this.gesturePid = null;
      this.gesture = null;
      if (hit) this.pushUndo(before);
      this.syncFoot();
    };
    this.surface!.addEventListener('pointermove', move);
    this.surface!.addEventListener('pointerup', up);
    this.surface!.addEventListener('pointercancel', up);
    this.gesture = { move, up };
  }

  private selDown(p: { x: number; y: number }, pid: number) {
    const i = hitStroke(this.strokes, p.x, p.y, this.tol);
    this.sel = i;
    this.renderAll();
    if (i < 0) {
      this.gesturePid = null;
      return;
    }
    const before = cloneStrokes(this.strokes);
    const stroke = this.strokes[i]!;
    let lx = p.x;
    let ly = p.y;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const q = this.project!(ev);
      const dx = q.x - lx;
      const dy = q.y - ly;
      if (!dx && !dy) return;
      moved = true;
      lx = q.x;
      ly = q.y;
      translateStroke(stroke, dx, dy);
      this.selPath()?.setAttribute('d', stroke.widths?.length ? strokeOutlineD(stroke) : strokeD(stroke));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      this.surface!.removeEventListener('pointermove', move);
      this.surface!.removeEventListener('pointerup', up);
      this.surface!.removeEventListener('pointercancel', up);
      this.gesturePid = null;
      this.gesture = null;
      if (moved) this.pushUndo(before);
    };
    this.surface!.addEventListener('pointermove', move);
    this.surface!.addEventListener('pointerup', up);
    this.surface!.addEventListener('pointercancel', up);
    this.gesture = { move, up };
  }

  private save() {
    if (!this.strokes.length) {
      this.opts.onCancel();
      return;
    }
    this.opts.onSave(cloneStrokes(this.strokes));
  }

  private deleteSel() {
    if (this.sel < 0) return;
    this.pushUndo(cloneStrokes(this.strokes));
    this.strokes.splice(this.sel, 1);
    this.sel = -1;
    this.renderAll();
  }

  private onKey = (e: KeyboardEvent) => {
    const tEl = e.target as HTMLElement;
    if (tEl.isContentEditable || tEl.tagName === 'INPUT' || tEl.tagName === 'TEXTAREA') return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta) {
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        e.stopPropagation();
        this.save();
      } else if (k === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.redo();
        else this.undo();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (document.querySelector('.tool-pop')) return;
      e.preventDefault();
      e.stopPropagation();
      this.save();
      return;
    }
    switch (e.key) {
      case 'v':
      case 'V':
        this.setTool('select');
        break;
      case 'e':
      case 'E':
        this.setTool('eraser');
        break;
      case 'c':
      case 'C':
        this.cycleColor();
        break;
      case 'x':
      case 'X': {
        const tmp = this.color;
        this.color = this.prevColor;
        this.prevColor = tmp;
        this.syncToolState();
        break;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSel();
        break;
      default:
        if (e.key >= '1' && e.key <= '4') this.setSize(Number(e.key) - 1);
        else return;
    }
    e.stopPropagation();
  };
}
