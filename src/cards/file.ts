import type { Element } from '../state/schema';
import { fileDoc } from '../state/schema';
import { downloadBlobRef } from '../persist/blobs';
import { fmtSize } from '../ui/files';
import { ICONS } from '../ui/icons';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

// Generic file card: paper icon + name + size. Click when selected
// downloads via the blob URL.
export class FileCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private nameEl: HTMLElement;
  private sizeEl: HTMLElement;
  private ro: ResizeObserver;
  private selected = false;
  private downSelected = false;
  private downAt = { x: 0, y: 0 };
  private lastName = '';
  private lastSize = -1;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card file';
    this.node.dataset.id = el.id;

    const body = document.createElement('div');
    body.className = 'fc-body';
    const icon = document.createElement('div');
    icon.className = 'fc-icon';
    icon.innerHTML = ICONS.file;
    const meta = document.createElement('div');
    meta.className = 'fc-meta';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'fc-name';
    this.sizeEl = document.createElement('div');
    this.sizeEl.className = 'fc-size';
    meta.append(this.nameEl, this.sizeEl);
    body.append(icon, meta);
    this.node.appendChild(body);

    this.node.addEventListener('pointerdown', (e) => {
      this.downSelected = this.selected;
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    this.node.addEventListener('click', (e) => {
      if (!this.downSelected) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
      const c = fileDoc(this.ctx.doc.elements[this.id]!);
      if (c) void downloadBlobRef(c.blobRef, c.name);
    });

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
    s.width = `${el.w ?? 190}px`;
    s.background = cardBg(el.color);
    const c = fileDoc(el);
    if (!c) return;
    if (c.name !== this.lastName) {
      this.nameEl.textContent = c.name;
      this.nameEl.title = c.name;
      this.lastName = c.name;
    }
    if (c.size !== this.lastSize) {
      this.sizeEl.textContent = fmtSize(c.size);
      this.lastSize = c.size;
    }
  }

  setSelected(on: boolean) {
    this.selected = on;
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
