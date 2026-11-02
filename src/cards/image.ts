import type { Element, Stroke } from '../state/schema';
import { imageDoc } from '../state/schema';
import { t } from '../strings';
import { blobUrl } from '../persist/blobs';
import { ICONS } from '../ui/icons';
import { strokePathEl } from '../draw/strokes';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Image card: blob-backed picture at natural aspect inside the card
// width, optional single-line caption. Missing blob renders a
// placeholder, never an error.
export class ImageCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private wrap: HTMLElement;
  private img: HTMLImageElement;
  private missing: HTMLElement;
  private capEl: HTMLElement;
  private handle: HTMLElement;
  private selected = false;
  private downSelected = false;
  private downAt = { x: 0, y: 0 };
  private curRef = '';
  private lastCap: string | null = null;
  private ink: SVGSVGElement | null = null;
  private lastStrokes: Stroke[] | null = null;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card image';
    this.node.dataset.id = el.id;

    this.wrap = document.createElement('div');
    this.wrap.className = 'im-wrap';
    this.img = document.createElement('img');
    this.img.className = 'im-img';
    this.img.draggable = false;
    this.img.alt = '';
    this.missing = document.createElement('div');
    this.missing.className = 'im-missing';
    this.missing.innerHTML = `${ICONS.image}<span>${t('imageMissing')}</span>`;
    this.wrap.append(this.img, this.missing);

    this.capEl = document.createElement('div');
    this.capEl.className = 'im-cap';
    this.capEl.dataset.ph = t('captionPlaceholder');

    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    this.node.append(this.wrap, this.capEl, this.handle);

    this.node.addEventListener('pointerdown', (e) => {
      this.downSelected = this.selected;
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    this.capEl.addEventListener('click', (e) => {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
      if (this.downSelected && !this.editing && !moved) this.ctx.events.onEditField(this.id, 'caption');
    });
    this.capEl.addEventListener('input', () => {
      const c = imageDoc(this.ctx.doc.elements[this.id]!);
      if (!c) return;
      const caption = this.capEl.innerText.replace(/\n/g, '');
      if (caption !== c.caption) this.ctx.events.onContent(this.id, { image: { ...c, caption } });
    });
    this.capEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.ctx.events.onEditEnd(this.id);
      }
    });
    this.capEl.addEventListener('blur', () => {
      if (this.editing) this.ctx.events.onEditEnd(this.id);
    });

    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private async load(ref: string) {
    const url = await blobUrl(ref).catch(() => null);
    if (this.curRef !== ref) return;
    if (url) {
      this.img.src = url;
      this.img.style.display = '';
      this.missing.style.display = 'none';
    } else {
      this.img.removeAttribute('src');
      this.img.style.display = 'none';
      this.missing.style.display = '';
    }
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 240}px`;
    s.background = cardBg(el.color);
    const c = imageDoc(el);
    if (!c) return;
    this.wrap.style.aspectRatio = c.aspect > 0 ? `${c.aspect}` : '1';
    this.node.classList.toggle('has-cap', !!c.caption);
    if (c.blobRef !== this.curRef) {
      this.curRef = c.blobRef;
      this.missing.style.display = 'none';
      void this.load(c.blobRef);
    }
    if (!this.editing && c.caption !== this.lastCap) {
      this.capEl.textContent = c.caption;
      this.lastCap = c.caption;
    }
    const strokes = c.strokes ?? null;
    if (strokes !== this.lastStrokes) {
      this.lastStrokes = strokes;
      this.ink?.remove();
      this.ink = null;
      if (strokes?.length) {
        this.ink = document.createElementNS(SVG_NS, 'svg');
        this.ink.classList.add('im-ink');
        const nw = c.natW ?? 1000;
        const nh = c.natH ?? Math.max(1, Math.round(nw / (c.aspect || 1)));
        this.ink.setAttribute('viewBox', `0 0 ${nw} ${nh}`);
        for (const st of strokes) this.ink.appendChild(strokePathEl(st));
        this.wrap.appendChild(this.ink);
      }
    }
  }

  setSelected(on: boolean) {
    this.selected = on;
    this.node.classList.toggle('selected', on);
  }

  setHandle(on: boolean) {
    this.node.classList.toggle('handle', on);
  }

  beginEdit(_pos?: { x: number; y: number }, field?: string) {
    this.editing = true;
    this.node.classList.add('editing');
    if (field !== 'caption') return;
    this.capEl.contentEditable = 'true';
    this.capEl.focus();
    getSelection()!.selectAllChildren(this.capEl);
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.capEl.contentEditable = 'false';
    if (this.node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    getSelection()?.removeAllRanges();
    return '';
  }

  destroy() {
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}
