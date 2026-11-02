import type { ID } from '../state/schema';
import { boardsCount, cardsCount, t } from '../strings';
import { mountBoardIcon } from './boardicons';
import { ICONS } from './icons';
import { openPanel, panelEmpty, type PanelHandle } from './panel';

export interface BoardRow {
  id: ID;
  depth: number;
  title: string;
  icon?: string;
  cards: number;
  boards: number;
  current: boolean;
  collapsed: boolean;
  editable: boolean;
  deletable: boolean;
}

interface BoardsApi {
  boards(): BoardRow[];
  onOpen(id: ID): void;
  onRename(id: ID, title: string): void;
  onDelete(id: ID): void;
  onNew(anchor: HTMLElement): void;
  onToggleCollapse(id: ID): void;
}

export interface BoardsPanel extends PanelHandle {
  render(): void;
}

function statText(r: BoardRow): string {
  return r.boards ? `${cardsCount(r.cards)}, ${boardsCount(r.boards)}` : cardsCount(r.cards);
}

// Projects panel: the whole board tree (root boards are projects), with
// inline rename, an inline delete confirm, and a New project action.
export function openBoardsPanel(api: BoardsApi): BoardsPanel {
  let actionBtn: HTMLElement | null = null;
  const handle = openPanel({
    title: t('projectsTitle'),
    actionLabel: t('projectNew'),
    onAction: () => {
      if (actionBtn) api.onNew(actionBtn);
    },
  }) as BoardsPanel;
  actionBtn = handle.node.querySelector('.sp-action');

  const filter = document.createElement('input');
  filter.name = 'boards-filter';
  filter.type = 'text';
  filter.className = 'sp-search bpl-filter';
  filter.placeholder = t('projectsFilterPh');
  filter.addEventListener('input', () => render());
  filter.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') handle.close();
  });

  const rows = document.createElement('div');
  rows.className = 'bpl-rows';
  handle.body.appendChild(rows);

  // A rename input or delete confirm owns the list until it resolves;
  // refreshes from the app are skipped so the transient UI survives.
  let busy = false;

  function rename(row: HTMLElement, r: BoardRow) {
    busy = true;
    row.classList.add('bpl-editing');
    const titleEl = row.querySelector('.bpl-title');
    const input = document.createElement('input');
    input.name = 'board-rename';
    input.className = 'bpl-rename';
    input.value = r.title;
    titleEl?.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      busy = false;
      const v = input.value.trim();
      if (commit && v && v !== r.title) api.onRename(r.id, v);
      else render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  function confirmDelete(row: HTMLElement, r: BoardRow) {
    busy = true;
    row.classList.add('bpl-confirm');
    row.textContent = '';
    const q = document.createElement('span');
    q.className = 'bpl-q';
    q.textContent = `${t('boardDeleteQ').replace('{name}', r.title)} ${statText(r)}`;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'bpl-btn bpl-yes';
    yes.textContent = t('boardDelete');
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'bpl-btn';
    no.textContent = t('drawCancel');
    yes.addEventListener('click', (e) => {
      e.stopPropagation();
      busy = false;
      api.onDelete(r.id);
    });
    no.addEventListener('click', (e) => {
      e.stopPropagation();
      busy = false;
      render();
    });
    row.append(q, yes, no);
  }

  function boardRow(r: BoardRow): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sp-row sp-hit bpl-row';
    if (r.current) row.classList.add('bpl-cur');
    const indent = document.createElement('span');
    indent.className = 'bpl-indent';
    indent.style.width = `${r.depth * 14}px`;
    const caret = document.createElement(r.boards ? 'button' : 'span');
    caret.className = 'bpl-caret';
    if (r.boards) {
      (caret as HTMLButtonElement).type = 'button';
      if (!r.collapsed) caret.classList.add('bpl-open');
      caret.title = r.collapsed ? t('expandRow') : t('collapseRow');      caret.setAttribute('aria-label', r.collapsed ? t('expandRow') : t('collapseRow'));
      caret.innerHTML =
        '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2.5 6.5 5 3.5 7.5"/></svg>';
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        api.onToggleCollapse(r.id);
        render();
      });
    }
    const ic = document.createElement('span');
    ic.className = 'sp-ricon';
    if (r.icon !== undefined) mountBoardIcon(ic, r.icon, r.title);
    else ic.innerHTML = ICONS.board;
    const title = document.createElement('span');
    title.className = 'sp-rtext bpl-title';
    title.textContent = r.title;
    const stats = document.createElement('span');
    stats.className = 'sp-rextra bpl-stats';
    stats.textContent = statText(r);
    const acts = document.createElement('span');
    acts.className = 'bpl-actions';
    if (r.editable) {
      const ed = document.createElement('button');
      ed.type = 'button';
      ed.className = 'bpl-mini';
      ed.innerHTML = ICONS.draw;
      ed.title = t('boardRename');      ed.setAttribute('aria-label', t('boardRename'));
      ed.addEventListener('click', (e) => {
        e.stopPropagation();
        rename(row, r);
      });
      acts.appendChild(ed);
    }
    if (r.deletable) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bpl-mini';
      del.innerHTML = ICONS.trash;
      del.title = t('boardDelete');      del.setAttribute('aria-label', t('boardDelete'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDelete(row, r);
      });
      acts.appendChild(del);
    }
    row.append(indent, caret, ic, title, stats, acts);
    row.addEventListener('click', () => {
      if (row.classList.contains('bpl-editing') || row.classList.contains('bpl-confirm')) return;
      api.onOpen(r.id);
    });
    return row;
  }

  function render() {
    if (busy) return;
    const list = api.boards();
    if (list.length > 10) {
      if (!filter.isConnected) handle.body.prepend(filter);
    } else if (filter.isConnected) {
      filter.value = '';
      filter.remove();
    }
    const q = filter.isConnected ? filter.value.trim().toLowerCase() : '';
    // Collapsed rows hide their whole subtree; an active filter searches
    // the full tree regardless of collapse state.
    const shown: BoardRow[] = [];
    let cutoff = -1;
    for (const r of list) {
      if (cutoff >= 0) {
        if (r.depth > cutoff) continue;
        cutoff = -1;
      }
      if (q && !r.title.toLowerCase().includes(q)) continue;
      shown.push(r);
      if (!q && r.collapsed) cutoff = r.depth;
    }
    rows.textContent = '';
    if (!shown.length) {
      rows.appendChild(panelEmpty(t('searchEmpty')));
      return;
    }
    for (const r of shown) rows.appendChild(boardRow(r));
  }

  handle.render = render;
  render();
  return handle;
}
