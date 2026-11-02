import type { Element } from '../state/schema';
import { documentDoc, wordCount } from '../state/schema';
import { t, wordsText } from '../strings';
import { ICONS } from '../ui/icons';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Document card, two display modes: ICON_VIEW (icon + title + word
// count) and DETAIL_VIEW (title + read-only rendered preview + caption).
// Double-click opens the dedicated editor; Rename/Caption ride the
// field-edit path like the link card.
export class DocumentCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private glyphEl: HTMLElement;
  private titleEl: HTMLElement;
  private wordsEl: HTMLElement;
  private prevEl: HTMLElement;
  private capEl: HTMLElement;
  private handle: HTMLElement;
  private selected = false;
  private downSelected = false;
  private downAt = { x: 0, y: 0 };
  private lastTitle: string | null = null;
  private lastCap: string | null = null;
  private lastHtml: string | null = null;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card document';
    this.node.dataset.id = el.id;

    this.glyphEl = document.createElement('div');
    this.glyphEl.className = 'dc-glyph';
    this.glyphEl.innerHTML = ICONS.document;
    const meta = document.createElement('div');
    meta.className = 'dc-meta';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'dc-title';
    this.titleEl.dataset.ph = t('docTitlePh');
    this.wordsEl = document.createElement('div');
    this.wordsEl.className = 'dc-words';
    meta.append(this.titleEl, this.wordsEl);
    this.glyphEl.appendChild(meta);

    this.prevEl = document.createElement('div');
    this.prevEl.className = 'note-text dc-prev';
    this.capEl = document.createElement('div');
    this.capEl.className = 'dc-cap';
    this.capEl.dataset.ph = t('captionPlaceholder');

    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    this.node.append(this.glyphEl, this.prevEl, this.capEl, this.handle);

    this.node.addEventListener('pointerdown', (e) => {
      this.downSelected = this.selected;
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    const fieldClick = (field: 'title' | 'caption') => (e: MouseEvent) => {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
      if (this.downSelected && !this.editing && !moved) this.ctx.events.onEditField(this.id, field);
    };
    this.titleEl.addEventListener('click', fieldClick('title'));
    this.capEl.addEventListener('click', fieldClick('caption'));

    this.titleEl.addEventListener('input', () => {
      const c = documentDoc(this.ctx.doc.elements[this.id]!);
      if (!c) return;
      this.dispatch({ ...c, title: this.titleEl.innerText.replace(/\n/g, '') });
    });
    this.capEl.addEventListener('input', () => {
      const c = documentDoc(this.ctx.doc.elements[this.id]!);
      if (!c) return;
      this.dispatch({ ...c, caption: this.capEl.innerText.replace(/\n/g, '') });
    });
    for (const f of [this.titleEl, this.capEl]) {
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.ctx.events.onEditEnd(this.id);
        }
      });
      f.addEventListener('blur', () => {
        if (this.editing) this.ctx.events.onEditEnd(this.id);
      });
    }

    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private dispatch(doc: ReturnType<typeof documentDoc> & object) {
    this.ctx.events.onContent(this.id, { document: doc });
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 280}px`;
    s.background = cardBg(el.color);
    const c = documentDoc(el);
    if (!c) return;
    this.node.classList.toggle('detail', c.displayMode === 'detail');
    this.node.classList.toggle('has-cap', !!c.caption);
    this.wordsEl.textContent = wordsText(wordCount(c.text));
    if (!this.editing && c.title !== this.lastTitle) {
      this.titleEl.textContent = c.title;
      this.lastTitle = c.title;
    }
    if (c.displayMode === 'detail') {
      const html = c.html ?? c.text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
      if (html !== this.lastHtml) {
        this.prevEl.innerHTML = html;
        this.lastHtml = html;
      }
    }
    if (!this.editing && c.caption !== this.lastCap) {
      this.capEl.textContent = c.caption;
      this.lastCap = c.caption;
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
    const c = documentDoc(this.ctx.doc.elements[this.id]!);
    const target = field === 'caption' && c?.displayMode === 'detail' ? this.capEl : this.titleEl;
    target.contentEditable = 'true';
    target.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(target);
    sel.collapseToEnd();
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
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
