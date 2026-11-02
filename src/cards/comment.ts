import type { CommentItem, Element } from '../state/schema';
import { commentDoc, uid } from '../state/schema';
import { relTime, t } from '../strings';
import { openToolPopup, type ToolPopup } from '../ui/popup';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

interface ThreadEvents {
  onAdd(text: string): void;
  onEdit(itemId: string, text: string): void;
  onDelete(itemId: string): void;
}

// Shared thread body: item rows (text + relative time + Edit) and a send box.
// Used by both the free comment card and the anchored pin popup.
class CommentThread {
  node: HTMLElement;
  private list: HTMLElement;
  private input: HTMLTextAreaElement;
  private send: HTMLButtonElement;
  private events: ThreadEvents;
  private editingItem: string | null = null;
  private cancelItem: string | null = null;

  constructor(events: ThreadEvents) {
    this.events = events;
    this.node = document.createElement('div');
    this.node.className = 'cthread';
    this.node.dataset.noclick = '1';
    this.list = document.createElement('div');
    this.list.className = 'ct-list';
    const foot = document.createElement('div');
    foot.className = 'ct-foot';
    this.input = document.createElement('textarea');
    this.input.name = 'comment-text';
    this.input.className = 'ct-input';
    this.input.rows = 1;
    this.input.placeholder = t('commentPh');
    this.send = document.createElement('button');
    this.send.type = 'button';
    this.send.className = 'ct-send';
    this.send.textContent = t('send');
    this.send.disabled = true;
    foot.append(this.input, this.send);
    this.node.append(this.list, foot);

    this.input.addEventListener('input', () => {
      this.send.disabled = this.input.value.trim() === '';
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
    this.input.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.send.addEventListener('click', () => this.submit());
  }

  private submit() {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.send.disabled = true;
    this.events.onAdd(text);
  }

  focusInput() {
    this.input.focus();
  }

  update(items: CommentItem[]) {
    // A row mid-edit owns its DOM: rebuilding the list would drop the
    // in-flight edit before blur can commit it.
    if (this.editingItem) return;
    this.list.textContent = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ct-item';
      const text = document.createElement('div');
      text.className = 'ct-text';
      text.textContent = item.text;
      const meta = document.createElement('div');
      meta.className = 'ct-meta';
      const when = document.createElement('span');
      when.textContent = relTime(item.createdAt);
      meta.appendChild(when);
      if (item.editedAt) {
        const ed = document.createElement('span');
        ed.textContent = t('edited');
        meta.appendChild(ed);
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ct-edit';
      edit.textContent = t('editLabel');
      edit.addEventListener('click', () => {
        this.editingItem = item.id;
        text.contentEditable = 'true';
        text.classList.add('editing');
        text.focus();
        const sel = getSelection()!;
        sel.selectAllChildren(text);
        sel.collapseToEnd();
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ct-edit ct-del';
      del.textContent = t('boardDelete');
      del.addEventListener('click', () => this.events.onDelete(item.id));
      meta.append(edit, del);
      row.append(text, meta);
      text.addEventListener('keydown', (e) => {
        if (this.editingItem !== item.id) return;
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          if (e.key === 'Escape') this.cancelItem = item.id;
          text.blur();
        }
      });
      text.addEventListener('blur', () => {
        if (this.editingItem !== item.id) return;
        this.editingItem = null;
        text.contentEditable = 'false';
        text.classList.remove('editing');
        const cancelled = this.cancelItem === item.id;
        this.cancelItem = null;
        const next = text.innerText.replace(/\n$/, '');
        // Blank comments are not allowed: an emptied edit reverts.
        if (cancelled || !next.trim()) text.textContent = item.text;
        else if (next !== item.text) this.events.onEdit(item.id, next);
      });
      this.list.appendChild(row);
    }
  }
}

export class CommentCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private thread: CommentThread;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card comment';
    this.node.dataset.id = el.id;
    this.thread = new CommentThread({
      onAdd: (text) => this.addItem(text),
      onEdit: (iid, text) => this.editItem(iid, text),
      onDelete: (iid) => this.deleteItem(iid),
    });
    this.node.appendChild(this.thread.node);
    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private docItems(): CommentItem[] {
    const el = this.ctx.doc.elements[this.id];
    const c = el ? commentDoc(el) : null;
    return c?.items ?? [];
  }

  private addItem(text: string) {
    const el = this.ctx.doc.elements[this.id];
    const c = el ? commentDoc(el) : null;
    if (!c) return;
    const items = [...c.items, { id: uid(), text, createdAt: Date.now() }];
    this.ctx.events.onContent(this.id, { comment: { items } });
  }

  private editItem(iid: string, text: string) {
    const el = this.ctx.doc.elements[this.id];
    const c = el ? commentDoc(el) : null;
    if (!c) return;
    const items = c.items.map((i) => (i.id === iid ? { ...i, text, editedAt: Date.now() } : i));
    this.ctx.events.onContent(this.id, { comment: { items } });
  }

  private deleteItem(iid: string) {
    const el = this.ctx.doc.elements[this.id];
    const c = el ? commentDoc(el) : null;
    if (!c) return;
    this.ctx.events.onContent(this.id, { comment: { items: c.items.filter((i) => i.id !== iid) } });
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 260}px`;
    s.background = cardBg(el.color);
    this.thread.update(this.docItems());
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
    this.thread.focusInput();
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    if (this.node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    return '';
  }

  destroy() {
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}

// Thread popup anchored to a pin (or any screen-space anchor).
export function openThreadPopup(
  anchor: HTMLElement | DOMRect,
  items: () => CommentItem[],
  events: ThreadEvents,
): ToolPopup {
  const thread = new CommentThread({
    onAdd: (text) => {
      events.onAdd(text);
      thread.update(items());
    },
    onEdit: (iid, text) => {
      events.onEdit(iid, text);
      thread.update(items());
    },
    onDelete: (iid) => {
      events.onDelete(iid);
      thread.update(items());
    },
  });
  thread.update(items());
  const pop = openToolPopup(anchor, thread.node);
  thread.focusInput();
  return pop;
}
