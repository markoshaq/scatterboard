import type { Element } from '../state/schema';
import { sketchDoc, SKETCH_PAD_H, SKETCH_PAD_W } from '../state/schema';
import { t } from '../strings';
import { ICONS } from '../ui/icons';
import { strokePathEl } from '../draw/strokes';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Sketch card: strokes (stored in a fixed 600x450 editor space) scaled
// into the card via an svg viewBox. Resizable by the width handle;
// double-click opens the draw editor.
export class SketchCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private svg: SVGSVGElement;
  private emptyEl: HTMLElement;
  private handle: HTMLElement;
  private ro: ResizeObserver;
  private lastSig = -1;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card sketch';
    this.node.dataset.id = el.id;

    const stage = document.createElement('div');
    stage.className = 'sk-stage';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${SKETCH_PAD_W} ${SKETCH_PAD_H}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'sk-empty';
    this.emptyEl.innerHTML = `${ICONS.pen}<span>${t('sketchEmptyPh')}</span>`;
    stage.append(this.svg, this.emptyEl);

    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    this.node.append(stage, this.handle);

    this.ro = new ResizeObserver(() => {
      this.ctx.events.onMeasure(this.id, this.node.offsetHeight);
    });
    this.ro.observe(this.node);
    this.update(el);
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 280}px`;
    s.background = cardBg(el.color);
    const c = sketchDoc(el);
    if (!c) return;
    this.node.classList.toggle('empty', !c.strokes.length);
    if (el.modifiedAt === this.lastSig) return;
    this.lastSig = el.modifiedAt;
    this.svg.textContent = '';
    for (const st of c.strokes) this.svg.appendChild(strokePathEl(st));
  }

  setSelected(on: boolean) {
    this.node.classList.toggle('selected', on);
  }

  setHandle(on: boolean) {
    this.node.classList.toggle('handle', on);
  }

  beginEdit() {
    this.editing = true;
    this.node.classList.add('editing');
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    return '';
  }

  destroy() {
    this.ro.disconnect();
    this.node.remove();
  }
}
