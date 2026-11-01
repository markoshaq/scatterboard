import type { Element, TodoDoc, TodoItem } from '../state/schema';
import { todoDoc, uid } from '../state/schema';
import { relDue, t } from '../strings';
import { openDuePopup, type DuePopupHandle, type DueValue } from '../ui/duepopup';
import { openReactionsPopup } from '../ui/toolpopups';
import { ICONS } from '../ui/icons';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

const CAL_ICON = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1.2" y="2" width="9.6" height="8.8" rx="1.6"/><path d="M1.2 4.6h9.6M3.8 1v2M8.2 1v2"/></svg>`;

interface Row {
  row: HTMLElement;
  check: HTMLElement;
  text: HTMLElement;
  you: HTMLElement;
  reacts: HTMLElement;
  reactBtn: HTMLButtonElement;
  due: HTMLButtonElement;
}

export class TodoCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private titleEl: HTMLElement;
  private itemsEl: HTMLElement;
  private rows = new Map<string, Row>();
  private ro: ResizeObserver;
  private popup: DuePopupHandle | null = null;
  private pendingFocus: string | null = null;
  private downAt = { x: 0, y: 0 };
  private lastTitle: string | null = null;
  private lastShowTitle = false;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card todo';
    this.node.dataset.id = el.id;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'todo-title';
    this.titleEl.dataset.ph = t('addTitle');
    this.itemsEl = document.createElement('div');
    this.itemsEl.className = 'todo-items';
    this.node.append(this.titleEl, this.itemsEl);

    this.titleEl.addEventListener('input', () => this.pushTitle());
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        this.toggleTitle();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const c = this.content();
        const first = c?.items[0];
        if (first) this.focusItem(first.id);
      }
    });

    this.itemsEl.addEventListener('input', (e) => {
      const rowEl = (e.target as HTMLElement).closest('.todo-item') as HTMLElement | null;
      if (!rowEl || !(e.target as HTMLElement).classList.contains('todo-text')) return;
      this.pushItemText(rowEl.dataset.iid!, this.readItemText(e.target as HTMLElement));
    });
    this.itemsEl.addEventListener('keydown', (e) => this.onItemKeydown(e));
    this.itemsEl.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    this.itemsEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const rowEl = target.closest('.todo-item') as HTMLElement | null;
      if (!rowEl) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
      if (target.closest('.todo-check')) {
        this.toggleDone(rowEl.dataset.iid!);
      } else if (target.closest('.todo-due')) {
        this.openDue(rowEl.dataset.iid!);
      } else if (target.closest('.todo-react-btn')) {
        this.openReacts(rowEl.dataset.iid!);
      }
    });

    this.ro = new ResizeObserver(() => {
      this.ctx.events.onMeasure(this.id, this.node.offsetHeight);
    });
    this.ro.observe(this.node);
    this.update(el);
  }

  private content(): TodoDoc | null {
    const el = this.ctx.doc.elements[this.id];
    return el ? todoDoc(el) : null;
  }

  private dispatch(todo: TodoDoc) {
    this.ctx.events.onContent(this.id, { todo });
  }

  private readItemText(el: HTMLElement): string {
    return el.innerText.replace(/\n$/, '');
  }

  private pushTitle() {
    const c = this.content();
    if (!c) return;
    const title = this.titleEl.innerText.replace(/\n/g, '');
    if (title !== c.title) this.dispatch({ ...c, title });
  }

  private pushItemText(iid: string, text: string) {
    const c = this.content();
    if (!c) return;
    this.dispatch({ ...c, items: c.items.map((i) => (i.id === iid ? { ...i, text } : i)) });
  }

  private toggleDone(iid: string) {
    const c = this.content();
    if (!c) return;
    this.dispatch({ ...c, items: c.items.map((i) => (i.id === iid ? { ...i, done: !i.done } : i)) });
  }

  private toggleTitle() {
    const c = this.content();
    if (!c) return;
    const showTitle = !c.showTitle;
    if (showTitle) this.pendingFocus = 'title';
    this.dispatch({ ...c, showTitle });
  }

  private applyDue(iid: string, v: DueValue) {
    const c = this.content();
    if (!c) return;
    this.dispatch({
      ...c,
      items: c.items.map((i) => {
        if (i.id !== iid) return i;
        const { dueAt: _d, ...rest } = i;
        const next: TodoItem = { ...rest };
        if (v.dueAt !== undefined) next.dueAt = v.dueAt;
        return next;
      }),
    });
  }

  private openDue(iid: string) {
    const c = this.content();
    const row = this.rows.get(iid);
    const item = c?.items.find((i) => i.id === iid);
    if (!row || !item) return;
    this.popup?.close();
    const current: DueValue = {};
    if (item.dueAt !== undefined) current.dueAt = item.dueAt;
    this.popup = openDuePopup({
      anchor: row.due,
      current,
      onCommit: (v) => this.applyDue(iid, v),
    });
  }

  // The row whose text field is focused, else the first item. Used by the
  // edit rail's Due date and Assign tools.
  focusedItemId(): string | null {
    const probe = document.activeElement ?? getSelection()?.anchorNode ?? null;
    const el = probe instanceof HTMLElement ? probe : probe?.parentElement ?? null;
    const rowEl = el && this.node.contains(el) ? (el.closest('.todo-item') as HTMLElement | null) : null;
    return rowEl?.dataset.iid ?? this.content()?.items[0]?.id ?? null;
  }

  openDueFor(iid: string) {
    this.openDue(iid);
  }

  // Per-item reaction picker: same popup as card-level reactions.
  private openReacts(iid: string) {
    const c = this.content();
    const row = this.rows.get(iid);
    const item = c?.items.find((i) => i.id === iid);
    if (!row || !item || !c) return;
    openReactionsPopup(
      row.reactBtn,
      () => new Set(this.content()?.items.find((i) => i.id === iid)?.reactions ?? []),
      (emoji) => {
        const cur = this.content();
        if (!cur) return;
        this.dispatch({
          ...cur,
          items: cur.items.map((i) => {
            if (i.id !== iid) return i;
            const has = (i.reactions ?? []).includes(emoji);
            const next = has ? (i.reactions ?? []).filter((r) => r !== emoji) : [...(i.reactions ?? []), emoji];
            const out: TodoItem = { ...i };
            if (next.length) out.reactions = next;
            else delete out.reactions;
            return out;
          }),
        });
      },
    );
  }

  toggleAssign(iid: string) {
    const c = this.content();
    if (!c) return;
    this.dispatch({
      ...c,
      items: c.items.map((i) => {
        if (i.id !== iid) return i;
        const { assignee: _a, ...rest } = i;
        return i.assignee ? rest : { ...rest, assignee: 'self' as const };
      }),
    });
  }

  private onItemKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('todo-text')) return;
    const rowEl = target.closest('.todo-item') as HTMLElement | null;
    const iid = rowEl?.dataset.iid;
    if (!iid) return;
    const c = this.content();
    if (!c) return;

    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      this.toggleTitle();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = c.items.findIndex((i) => i.id === iid);
      const next = [...c.items];
      const created: TodoItem = { id: uid(), text: '', done: false };
      next.splice(idx + 1, 0, created);
      this.pendingFocus = created.id;
      this.dispatch({ ...c, items: next });
      return;
    }
    if (e.key === 'Backspace' && this.readItemText(target) === '' && c.items.length > 1) {
      e.preventDefault();
      const idx = c.items.findIndex((i) => i.id === iid);
      this.pendingFocus = c.items[idx - 1]?.id ?? 'title';
      this.dispatch({ ...c, items: c.items.filter((i) => i.id !== iid) });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'Digit1') {
      e.preventDefault();
      this.openDue(iid);
    }
  }

  private focusItem(iid: string) {
    const row = this.rows.get(iid);
    if (!row) return;
    row.text.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(row.text);
    sel.collapseToEnd();
  }

  private makeRow(item: TodoItem): Row {
    const row = document.createElement('div');
    row.className = 'todo-item';
    row.dataset.iid = item.id;
    const check = document.createElement('div');
    check.className = 'todo-check';
    check.dataset.noclick = '1';
    const text = document.createElement('div');
    text.className = 'todo-text';
    text.dataset.ph = t('todoItemPlaceholder');
    const you = document.createElement('span');
    you.className = 'todo-you';
    you.textContent = t('assigneeYou');
    const reacts = document.createElement('span');
    reacts.className = 'todo-reacts';
    const reactBtn = document.createElement('button');
    reactBtn.type = 'button';
    reactBtn.className = 'todo-due todo-react-btn';
    reactBtn.dataset.noclick = '1';
    reactBtn.innerHTML = ICONS.reactions;
    const due = document.createElement('button');
    due.type = 'button';
    due.className = 'todo-due';
    due.dataset.noclick = '1';
    row.append(check, text, you, reacts, reactBtn, due);
    return { row, check, text, you, reacts, reactBtn, due };
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 240}px`;
    this.node.style.background = cardBg(el.color);
    const c = todoDoc(el);
    if (!c) return;

    if (c.showTitle !== this.lastShowTitle) {
      this.node.classList.toggle('show-title', c.showTitle);
      this.lastShowTitle = c.showTitle;
    }
    if (!this.editing && c.title !== this.lastTitle) {
      this.titleEl.textContent = c.title;
      this.lastTitle = c.title;
    }

    const seen = new Set(c.items.map((i) => i.id));
    for (const [iid, r] of this.rows) {
      if (!seen.has(iid)) {
        r.row.remove();
        this.rows.delete(iid);
      }
    }
    let prev: Node | null = null;
    const now = Date.now();
    for (const item of c.items) {
      let r = this.rows.get(item.id);
      if (!r) {
        r = this.makeRow(item);
        this.rows.set(item.id, r);
      }
      if (r.row.parentNode !== this.itemsEl || r.row.previousSibling !== prev) {
        this.itemsEl.insertBefore(r.row, prev ? prev.nextSibling : this.itemsEl.firstChild);
      }
      prev = r.row;
      r.check.classList.toggle('done', item.done);
      r.row.classList.toggle('done', item.done);
      r.you.hidden = item.assignee !== 'self';
      if (this.editing && r.text.contentEditable !== 'true') r.text.contentEditable = 'true';
      if (!this.editing && r.text.contentEditable === 'true') r.text.contentEditable = 'false';
      if (document.activeElement !== r.text && r.text.innerText !== item.text) {
        r.text.innerText = item.text;
      }
      const reacts = item.reactions ?? [];
      const rkey = reacts.join(',');
      if (r.reacts.dataset.key !== rkey) {
        r.reacts.dataset.key = rkey;
        r.reacts.textContent = '';
        for (const e of reacts) {
          const s = document.createElement('span');
          s.className = 'todo-react';
          s.textContent = e;
          r.reacts.appendChild(s);
        }
      }
      r.reactBtn.classList.toggle('has-due', reacts.length > 0);
      const hasDue = item.dueAt !== undefined;
      r.due.classList.toggle('has-due', hasDue);
      r.due.classList.toggle('overdue', hasDue && !item.done && item.dueAt! < now);
      const label = hasDue ? relDue(item.dueAt!) : CAL_ICON;
      if (r.due.dataset.lbl !== label) {
        r.due.dataset.lbl = label;
        if (hasDue) r.due.textContent = label;
        else r.due.innerHTML = label;
      }
    }

    if (this.pendingFocus) {
      const pf = this.pendingFocus;
      this.pendingFocus = null;
      if (pf === 'title') {
        this.titleEl.focus();
        const sel = getSelection()!;
        sel.selectAllChildren(this.titleEl);
        sel.collapseToEnd();
      } else {
        this.focusItem(pf);
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
    this.titleEl.contentEditable = 'true';
    for (const r of this.rows.values()) r.text.contentEditable = 'true';
    if (pos) {
      const range =
        document.caretPositionFromPoint?.(pos.x, pos.y) ??
        (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(
          pos.x,
          pos.y,
        );
      if (range) {
        const node = 'offsetNode' in range ? (range as { offsetNode: Node }).offsetNode : range.startContainer;
        const hostEl = node instanceof HTMLElement ? node : node.parentElement;
        if (hostEl && this.node.contains(node) && hostEl.closest('.todo-text, .todo-title')) {
          const sel = getSelection()!;
          sel.removeAllRanges();
          const r = document.createRange();
          const offset = 'offsetNode' in range ? (range as { offset: number }).offset : range.startOffset;
          r.setStart(node, offset);
          r.collapse(true);
          sel.addRange(r);
          return;
        }
      }
    }
    const c = this.content();
    const last = c?.items[c.items.length - 1];
    if (last) this.focusItem(last.id);
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
    for (const r of this.rows.values()) r.text.contentEditable = 'false';
    this.popup?.close();
    this.popup = null;
    if (this.node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    getSelection()?.removeAllRanges();
    return '';
  }

  destroy() {
    this.popup?.close();
    this.ro.disconnect();
    this.node.remove();
  }
}
