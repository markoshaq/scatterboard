import type { Element, TypeContent } from '../state/schema';
import { noteText } from '../state/schema';
import { t } from '../strings';
import { ensureBlockChildren, isBlankSurface, richKeydown } from '../ui/richtext';
import { cardBg } from '../ui/theme';

export interface CardEvents {
  onTextInput: (id: string, text: string, html?: string) => void;
  onContent: (id: string, content: TypeContent) => void;
  onMeasure: (id: string, h: number) => void;
  onResizeHandle: (id: string, e: PointerEvent) => void;
  onEditEnd: (id: string) => void;
  onLinkPopup: (id: string) => void;
  // A single-line field (title/caption/url) wants an edit session.
  onEditField: (id: string, field?: string) => void;
  // Card-internal focus moved (table cell vs field): rail re-syncs.
  onCellFocus?: (id: string) => void;
}

export interface CardView {
  id: string;
  node: HTMLElement;
  update(el: Element): void;
  setSelected(on: boolean): void;
  setHandle(on: boolean): void;
  // field picks which in-card surface gets focus ('title', 'caption',
  // 'url'); cards with one surface ignore it.
  beginEdit(pos?: { x: number; y: number }, field?: string): void;
  endEdit(): string;
  readonly editing: boolean;
  readHtml?(): string;
  editSurface?(): HTMLElement | null;
  findView?(id: string): CardView | undefined;
  syncInner?(sel: Set<string>, editingId: string | null): void;
  destroy(): void;
}

export function noteHtml(el: Element): string | undefined {
  return 'note' in el.content ? el.content.note.html : undefined;
}

export class NoteCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private textEl: HTMLElement;
  private handle: HTMLElement;
  private ro: ResizeObserver;
  private events: CardEvents;
  private lastText = '';
  private lastHtml: string | undefined;

  constructor(el: Element, events: CardEvents) {
    this.id = el.id;
    this.events = events;
    this.node = document.createElement('div');
    this.node.className = 'card note';
    this.node.dataset.id = el.id;
    this.textEl = document.createElement('div');
    this.textEl.className = 'note-text';
    this.textEl.dataset.ph = t('notePlaceholder');
    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.events.onResizeHandle(this.id, e);
    });
    this.node.append(this.textEl, this.handle);

    this.textEl.addEventListener('input', () => {
      if (isBlankSurface(this.textEl)) this.textEl.innerHTML = '';
      this.pushSurface();
    });
    this.textEl.addEventListener('keydown', (e) => {
      richKeydown(this.textEl, e, { openLink: () => this.events.onLinkPopup(this.id) });
    });
    this.ro = new ResizeObserver(() => {
      this.events.onMeasure(this.id, this.node.offsetHeight);
    });
    this.ro.observe(this.node);
    this.update(el);
  }

  private pushSurface() {
    this.lastText = this.readText();
    this.lastHtml = this.textEl.innerHTML;
    this.events.onTextInput(this.id, this.lastText, this.lastHtml);
  }

  private readText(): string {
    return this.textEl.innerText.replace(/\n$/, '');
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
    this.node.style.background = cardBg(el.color);
    if (this.editing) return;
    const html = noteHtml(el);
    if (html !== undefined) {
      if (html !== this.lastHtml) {
        this.textEl.innerHTML = html;
        this.lastHtml = html;
        this.lastText = noteText(el);
      }
    } else {
      this.lastHtml = undefined;
      const text = noteText(el);
      if (text !== this.lastText) {
        this.textEl.textContent = text;
        this.lastText = text;
      }
    }
  }

  setSelected(on: boolean) {
    this.node.classList.toggle('selected', on);
  }

  setHandle(on: boolean) {
    this.node.classList.toggle('handle', on);
  }

  beginEdit(pos?: { x: number; y: number }) {
    this.editing = true;
    this.node.classList.add('editing');
    if (this.lastHtml !== undefined && this.textEl.innerHTML !== this.lastHtml) {
      this.textEl.innerHTML = this.lastHtml;
    }
    ensureBlockChildren(this.textEl);
    this.textEl.contentEditable = 'true';
    this.textEl.focus();
    if (pos) {
      const range =
        document.caretPositionFromPoint?.(pos.x, pos.y) ??
        (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(pos.x, pos.y);
      if (range) {
        const sel = getSelection()!;
        sel.removeAllRanges();
        const r = document.createRange();
        const p = 'offsetNode' in range ? (range as { offsetNode: Node; offset: number }) : { offsetNode: range.startContainer, offset: range.startOffset };
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
        sel.addRange(r);
        return;
      }
    }
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
    this.ro.disconnect();
    this.node.remove();
  }
}
