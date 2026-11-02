import type { Element } from '../state/schema';
import { headingDoc } from '../state/schema';
import { t } from '../strings';
import { isBlankSurface, richKeydown } from '../ui/richtext';
import type { CardEvents, CardView } from './note';

export class HeadingCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private textEl: HTMLElement;
  private handle: HTMLElement;
  private events: CardEvents;
  private lastText = '';
  private lastHtml: string | undefined;
  private lastLevel = 0;

  constructor(el: Element, events: CardEvents) {
    this.id = el.id;
    this.events = events;
    this.node = document.createElement('div');
    this.node.className = 'card heading';
    this.node.dataset.id = el.id;
    this.textEl = document.createElement('div');
    this.textEl.className = 'head-text';
    this.textEl.dataset.ph = t('headingPlaceholder');
    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.events.onResizeHandle(this.id, e);
    });
    this.node.append(this.textEl, this.handle);

    this.textEl.addEventListener('input', () => {
      if (isBlankSurface(this.textEl)) this.textEl.innerHTML = '';
      this.lastText = this.readText();
      this.lastHtml = this.textEl.innerHTML;
      this.events.onTextInput(this.id, this.lastText, this.lastHtml);
    });
    this.textEl.addEventListener('keydown', (e) => {
      if (richKeydown(this.textEl, e, { openLink: () => this.events.onLinkPopup(this.id) })) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.events.onEditEnd(this.id);
      }
    });
    this.textEl.addEventListener('blur', () => {
      if (this.editing) this.events.onEditEnd(this.id);
    });
    this.events.observeNode?.(this);
    this.update(el);
  }

  private readText(): string {
    return this.textEl.innerText.replace(/\n/g, '');
  }

  readHtml(): string {
    return this.textEl.innerHTML;
  }

  editSurface(): HTMLElement | null {
    return this.editing ? this.textEl : null;
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 240}px`;
    const c = headingDoc(el);
    if (c && c.level !== this.lastLevel) {
      this.node.dataset.level = String(c.level);
      this.lastLevel = c.level;
    }
    if (this.editing || !c) return;
    if (c.html !== undefined) {
      if (c.html !== this.lastHtml) {
        this.textEl.innerHTML = c.html;
        this.lastHtml = c.html;
        this.lastText = c.text;
      }
    } else {
      this.lastHtml = undefined;
      if (c.text !== this.lastText) {
        this.textEl.textContent = c.text;
        this.lastText = c.text;
      }
    }
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
    if (this.lastHtml !== undefined && this.textEl.innerHTML !== this.lastHtml) {
      this.textEl.innerHTML = this.lastHtml;
    }
    this.textEl.contentEditable = 'true';
    this.textEl.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(this.textEl);
    sel.collapseToEnd();
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.textEl.contentEditable = 'false';
    this.textEl.blur();
    getSelection()?.removeAllRanges();
    return this.readText();
  }

  destroy() {
    this.events.unobserveNode?.(this);
    this.node.remove();
  }
}
