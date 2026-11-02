import type { Element, ID } from '../state/schema';
import { columnMembers, columnTitle } from '../state/schema';
import { memberCount, t } from '../strings';
import type { CardView } from './note';
import { createCard, type CardCtx } from './factory';
import { cardBg } from '../ui/theme';

export class ColumnCard implements CardView {
  id: ID;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private titleEl: HTMLElement;
  private countEl: HTMLElement;
  private body: HTMLElement;
  private members = new Map<ID, CardView>();
  private topOff = -1;
  private lastTitle = '';

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card column';
    this.node.dataset.id = el.id;

    const head = document.createElement('div');
    head.className = 'col-head';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'col-title';
    this.titleEl.dataset.ph = t('addTitle');
    this.countEl = document.createElement('div');
    this.countEl.className = 'col-count';
    head.append(this.titleEl, this.countEl);
    this.body = document.createElement('div');
    this.body.className = 'col-body';
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    this.node.append(head, this.body, handle);

    this.titleEl.addEventListener('input', () => {
      this.lastTitle = this.readTitle();
      this.ctx.events.onTextInput(this.id, this.lastTitle);
    });
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.ctx.events.onEditEnd(this.id);
      }
    });
    this.titleEl.addEventListener('blur', () => {
      if (this.editing) this.ctx.events.onEditEnd(this.id);
    });
    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private readTitle(): string {
    return this.titleEl.innerText.replace(/\n/g, '');
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 280}px`;
    s.background = cardBg(el.color);
    const title = columnTitle(el);
    if (!this.editing && title !== this.lastTitle) {
      this.titleEl.textContent = title;
      this.lastTitle = title;
    }

    const list = columnMembers(this.ctx.doc, el.id).filter((m) => m.type !== 'line' && m.type !== 'annotation');
    const seen = new Set(list.map((m) => m.id));
    for (const [mid, v] of this.members) {
      if (!seen.has(mid)) {
        this.ctx.unregisterView?.(v);
        v.destroy();
        this.members.delete(mid);
      }
    }
    let prev: Node | null = null;
    for (const m of list) {
      let v = this.members.get(m.id);
      if (!v) {
        v = createCard(m, this.ctx);
        this.members.set(m.id, v);
        this.ctx.registerView?.(v);
      }
      if (v.node.parentNode !== this.body || v.node.previousSibling !== prev) {
        this.body.insertBefore(v.node, prev ? prev.nextSibling : this.body.firstChild);
      }
      prev = v.node;
      v.update(m);
    }
    const docs = list.filter((m) => m.type === 'document').length;
    this.countEl.textContent = memberCount(list.length - docs, docs);
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
    this.titleEl.contentEditable = 'true';
    this.titleEl.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(this.titleEl);
    sel.collapseToEnd();
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
    this.titleEl.blur();
    getSelection()?.removeAllRanges();
    return this.readTitle();
  }

  findView(id: ID): CardView | undefined {
    const v = this.members.get(id);
    if (v) return v;
    for (const mv of this.members.values()) {
      const f = mv.findView?.(id);
      if (f) return f;
    }
    return undefined;
  }

  syncInner(sel: Set<ID>, editingId: ID | null) {
    for (const [mid, v] of this.members) {
      v.setSelected(sel.has(mid));
      v.setHandle(false);
      v.syncInner?.(sel, editingId);
    }
  }

  // Member-stack top in column space (.col-body's offsetTop), measured
  // inside the layer's RO callback where the read is free. -1 until
  // the first measurement; CardsLayer falls back to a head estimate.
  noteBodyTop() {
    this.topOff = this.body.offsetTop;
  }

  bodyTop(): number {
    return this.topOff;
  }

  destroy() {
    for (const v of this.members.values()) {
      this.ctx.unregisterView?.(v);
      v.destroy();
    }
    this.members.clear();
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}
