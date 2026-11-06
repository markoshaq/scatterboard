import type { Doc, ID } from '../state/schema';
import { UNSORTED } from '../state/schema';
import { relDue, t } from '../strings';
import { ICONS, typeIcon } from './icons';
import { openPanel, panelEmpty, panelRow, type PanelHandle } from './panel';
import { mountBoardIcon } from './boardicons';

// One row per open to-do item with a due date, across every board.
export interface DueItem {
  elId: ID;
  itemId: ID;
  boardId: ID;
  boardTitle: string;
  boardIcon?: string;
  cardTitle: string;
  text: string;
  dueAt: number;
  dueTime: boolean;
  unsorted: boolean;
}

export function collectDue(doc: Doc): DueItem[] {
  const out: DueItem[] = [];
  for (const el of Object.values(doc.elements)) {
    if (!('todo' in el.content)) continue;
    const b = doc.boards[el.boardId];
    for (const it of el.content.todo.items) {
      if (it.dueAt === undefined || it.done) continue;
      out.push({
        elId: el.id,
        itemId: it.id,
        boardId: el.boardId,
        boardTitle: b?.title ?? '',
        ...(b?.icon !== undefined ? { boardIcon: b.icon } : {}),
        cardTitle: el.content.todo.title,
        text: it.text,
        dueAt: it.dueAt,
        dueTime: it.dueTime === true,
        unsorted: el.parentId === UNSORTED,
      });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

type DueGroup = 'overdue' | 'today' | 'week' | 'later';

function groupOf(d: DueItem, now: number): DueGroup {
  // Untimed dues cover their whole day: late only once it has passed.
  const late = d.dueTime ? d.dueAt < now : startOfDay(new Date(d.dueAt)) < startOfDay(new Date(now));
  if (late) return 'overdue';
  const diff = Math.round((startOfDay(new Date(d.dueAt)) - startOfDay(new Date(now))) / 86400000);
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

// Items the topbar chip counts: overdue plus anything due today.
export function dueSoonCount(doc: Doc): number {
  const n = new Date();
  // Date arithmetic, not +86400000: end-of-today survives DST shifts.
  const endToday = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime();
  return collectDue(doc).filter((d) => (d.dueTime ? d.dueAt : startOfDay(new Date(d.dueAt))) < endToday).length;
}

export interface DuePanel extends PanelHandle {
  render(): void;
}

export function openDuePanel(opts: {
  items(): DueItem[];
  onJump(d: DueItem): void;
  onDone(d: DueItem): void;
}): DuePanel {
  const handle = openPanel({ title: t('dueTitle') }) as DuePanel;
  const body = handle.body;

  handle.render = () => {
    const items = opts.items();
    body.textContent = '';
    if (!items.length) {
      body.appendChild(panelEmpty(t('dueEmpty')));
      return;
    }
    const now = Date.now();
    let group: DueGroup | null = null;
    for (const d of items) {
      const g = groupOf(d, now);
      if (g !== group) {
        group = g;
        const head = document.createElement('div');
        head.className = 'sp-group';
        head.textContent = t(
          g === 'overdue' ? 'dueOverdue' : g === 'today' ? 'dueToday' : g === 'week' ? 'dueWeek' : 'dueLater',
        );
        body.appendChild(head);
      }
      const where = d.unsorted ? t('unsortedTitle') : d.boardTitle || t('untitled');
      const row = panelRow(typeIcon('todo'), d.text || t('todoItemPlaceholder'), where);
      row.classList.add('sp-hit');
      if (g === 'overdue') row.classList.add('due-late');
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'due-check';
      check.innerHTML = ICONS.check;
      check.title = t('dueMarkDone');
      check.setAttribute('aria-label', t('dueMarkDone'));
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onDone(d);
      });
      row.insertBefore(check, row.firstChild);
      const ic = row.querySelector('.sp-ricon') as HTMLElement | null;
      if (ic && d.boardIcon) {
        ic.textContent = '';
        mountBoardIcon(ic, d.boardIcon, d.boardTitle);
      }
      const due = document.createElement('span');
      due.className = 'due-when';
      due.textContent = relDue(d.dueAt, d.dueTime);
      row.appendChild(due);
      row.addEventListener('click', () => opts.onJump(d));
      body.appendChild(row);
    }
  };

  handle.render();
  return handle;
}
