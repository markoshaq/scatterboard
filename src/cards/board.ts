import type { Element, ID } from '../state/schema';
import { boardCardCount, boardRefOf } from '../state/schema';
import { cardsCount, t } from '../strings';
import type { CardView } from './note';
import type { CardCtx } from './factory';
import { cardBg, defaultTile } from '../ui/theme';
import { mountBoardIcon } from '../ui/boardicons';

export class BoardCard implements CardView {
  id: ID;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private ref: ID | null;
  private tileEl: HTMLElement;
  private titleEl: HTMLElement;
  private countEl: HTMLElement;
  private lastTitle: string | null = null;
  private lastIcon = '';

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.ref = boardRefOf(el);
    this.node = document.createElement('div');
    this.node.className = 'card board-card';
    this.node.dataset.id = el.id;

    this.tileEl = document.createElement('div');
    this.tileEl.className = 'bc-tile';
    const meta = document.createElement('div');
    meta.className = 'bc-meta';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'bc-title';
    this.countEl = document.createElement('div');
    this.countEl.className = 'bc-count';
    meta.append(this.titleEl, this.countEl);
    this.node.append(this.tileEl, meta);

    this.titleEl.addEventListener('input', () => {
      this.ctx.events.onTextInput(this.id, this.readTitle());
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

  private board() {
    return this.ref ? this.ctx.doc.boards[this.ref] : undefined;
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 210}px`;
    s.background = cardBg(el.color);

    const board = this.board();
    const title = board?.title || t('untitled');
    if (!this.editing && title !== this.lastTitle) {
      this.titleEl.textContent = title;
      this.lastTitle = title;
    }
    this.tileEl.style.background = cardBg(board?.color ?? el.color) || defaultTile();
    const iconKey = `${board?.icon ?? ''}|${title}`;
    if (iconKey !== this.lastIcon) {
      this.lastIcon = iconKey;
      mountBoardIcon(this.tileEl, board?.icon, title);
    }
    this.countEl.textContent = this.ref ? cardsCount(boardCardCount(this.ctx.doc, this.ref)) : '';
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
    if (!this.board()?.title) this.titleEl.textContent = '';
    this.titleEl.contentEditable = 'true';
    this.titleEl.focus();
    getSelection()!.selectAllChildren(this.titleEl);
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
    this.titleEl.blur();
    getSelection()?.removeAllRanges();
    return this.readTitle();
  }

  destroy() {
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}
