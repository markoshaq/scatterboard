import type { Element } from '../state/schema';
import { swatchDoc } from '../state/schema';
import { t } from '../strings';
import type { CardCtx } from './factory';
import type { CardView } from './note';

interface NameEntry {
  n: string;
  h: number;
  s: number;
  l: number;
}

const NAMES: NameEntry[] = [
  { n: 'Ink', h: 0, s: 0, l: 0.08 },
  { n: 'Graphite', h: 0, s: 0, l: 0.32 },
  { n: 'Fog', h: 0, s: 0, l: 0.66 },
  { n: 'Paper', h: 0, s: 0, l: 0.93 },
  { n: 'Cherry', h: 348, s: 0.72, l: 0.5 },
  { n: 'Brick', h: 8, s: 0.62, l: 0.46 },
  { n: 'Ember', h: 20, s: 0.82, l: 0.55 },
  { n: 'Amber', h: 36, s: 0.85, l: 0.55 },
  { n: 'Honey', h: 45, s: 0.7, l: 0.62 },
  { n: 'Moss', h: 95, s: 0.38, l: 0.4 },
  { n: 'Fern', h: 130, s: 0.45, l: 0.42 },
  { n: 'Pine', h: 155, s: 0.5, l: 0.3 },
  { n: 'Lagoon', h: 180, s: 0.55, l: 0.45 },
  { n: 'Harbor', h: 200, s: 0.55, l: 0.5 },
  { n: 'Denim', h: 216, s: 0.48, l: 0.52 },
  { n: 'Cobalt', h: 228, s: 0.75, l: 0.55 },
  { n: 'Iris', h: 252, s: 0.5, l: 0.58 },
  { n: 'Plum', h: 285, s: 0.4, l: 0.46 },
  { n: 'Orchid', h: 310, s: 0.48, l: 0.6 },
  { n: 'Rose', h: 340, s: 0.58, l: 0.66 },
  { n: 'Clay', h: 18, s: 0.45, l: 0.52 },
  { n: 'Sand', h: 42, s: 0.35, l: 0.72 },
];

const ACHROMATIC = NAMES.slice(0, 4);
const CHROMATIC = NAMES.slice(4);

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? [...m].map((c) => c + c).join('') : m;
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function colorName(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.16) {
    let best = ACHROMATIC[0]!;
    for (const e of ACHROMATIC) if (Math.abs(e.l - l) < Math.abs(best.l - l)) best = e;
    return best.n;
  }
  let best = CHROMATIC[0]!;
  let bestD = Infinity;
  for (const e of CHROMATIC) {
    const dh = Math.min(Math.abs(h - e.h), 360 - Math.abs(h - e.h)) / 180;
    const d = dh * dh * s * 2 + (e.s - s) * (e.s - s) + (e.l - l) * (e.l - l) * 1.4;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best.n;
}

function normHex(hex: string): string {
  return hex.toLowerCase();
}

export class SwatchCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private block: HTMLElement;
  private valueEl: HTMLElement;
  private captionEl: HTMLElement;
  private picker: HTMLInputElement | null = null;
  private selected = false;
  private downSelected = false;
  private lastCaption: string | null = null;
  private lastColor = '';
  private lastShowValue = true;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card swatch';
    this.node.dataset.id = el.id;

    this.block = document.createElement('div');
    this.block.className = 'sw-block';
    const meta = document.createElement('div');
    meta.className = 'sw-meta';
    this.valueEl = document.createElement('div');
    this.valueEl.className = 'sw-value';
    this.captionEl = document.createElement('div');
    this.captionEl.className = 'sw-caption';
    this.captionEl.dataset.ph = t('captionPlaceholder');
    meta.append(this.valueEl, this.captionEl);
    this.node.append(this.block, meta);

    this.block.addEventListener('pointerdown', () => {
      this.downSelected = this.selected;
    });
    this.block.addEventListener('click', (e) => {
      if (!this.downSelected || e.detail > 1) return;
      this.openPicker();
    });

    this.captionEl.addEventListener('input', () => {
      this.ctx.events.onTextInput(this.id, this.readCaption());
    });
    this.captionEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.ctx.events.onEditEnd(this.id);
      }
    });
    this.captionEl.addEventListener('blur', () => {
      if (this.editing) this.ctx.events.onEditEnd(this.id);
    });
    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private readCaption(): string {
    return this.captionEl.innerText.replace(/\n/g, '');
  }

  private openPicker() {
    const el = this.ctx.doc.elements[this.id];
    const c = el ? swatchDoc(el) : null;
    if (!c) return;
    if (!this.picker) {
      const input = document.createElement('input');
      input.type = 'color';
      input.name = 'swatch-color';
      input.className = 'sw-picker';
      input.addEventListener('input', () => {
        this.block.style.background = input.value;
      });
      input.addEventListener('change', () => {
        const curEl = this.ctx.doc.elements[this.id];
        const cur = curEl ? swatchDoc(curEl) : null;
        if (!cur || cur.color === input.value) return;
        this.ctx.events.onContent(this.id, { swatch: { ...cur, color: input.value } });
      });
      this.node.appendChild(input);
      this.picker = input;
    }
    this.picker.value = normHex(c.color);
    this.picker.click();
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 200}px`;
    const c = swatchDoc(el);
    if (!c) return;
    // Always re-apply: the picker's live 'input' preview writes this
    // style without committing, and a cancelled picker fires no event.
    this.block.style.background = c.color;
    if (c.color !== this.lastColor) {
      this.lastColor = c.color;
      this.renderValue();
    }
    if (c.showValue !== this.lastShowValue) {
      this.lastShowValue = c.showValue;
      this.renderValue();
    }
    if (!this.editing && c.caption !== this.lastCaption) {
      this.captionEl.textContent = c.caption;
      this.lastCaption = c.caption;
    }
  }

  private renderValue() {
    const el = this.ctx.doc.elements[this.id];
    const c = el ? swatchDoc(el) : null;
    if (!c) return;
    this.valueEl.textContent = c.showValue ? `${c.color.toUpperCase()} ${colorName(c.color)}` : '';
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
    this.captionEl.contentEditable = 'true';
    this.captionEl.focus();
    getSelection()!.selectAllChildren(this.captionEl);
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.captionEl.contentEditable = 'false';
    this.captionEl.blur();
    getSelection()?.removeAllRanges();
    return this.readCaption();
  }

  destroy() {
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}
