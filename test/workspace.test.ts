import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createNote,
  createTodo,
  emptyDoc,
  UNSORTED,
  type Doc,
} from '../src/state/schema';
import { searchBoard, searchDoc } from '../src/ui/search';
import { collectDue, dueSoonCount } from '../src/ui/duepanel';

function doc(): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  return d;
}

function atStartOfDay(offsetDays: number): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays, 12).getTime();
}

describe('searchDoc', () => {
  it('finds elements on other boards and board titles', () => {
    const d = doc();
    d.boards.sub = createBoard({ id: 'sub', title: 'Kitchen remodel' });
    const el = createNote(d, 'sub', 0, 0, 'buy tiles');
    d.elements[el.id] = el;
    const hits = searchDoc(d, 'tiles');
    expect(hits.some((h) => h.elementId === el.id && h.boardId === 'sub')).toBe(true);
    expect(hits[0]!.boardTitle).toBe('Kitchen remodel');
    const titleHits = searchDoc(d, 'remodel');
    expect(titleHits.some((h) => !h.elementId && h.boardId === 'sub')).toBe(true);
  });

  it('flags unsorted members and skips anchored comments', () => {
    const d = doc();
    const el = createNote(d, 'home', 0, 0, 'loose thought');
    el.parentId = UNSORTED;
    d.elements[el.id] = el;
    const hits = searchDoc(d, 'loose');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.unsorted).toBe(true);
    expect(searchBoard(d, 'home', 'loose')).toHaveLength(0);
  });

  it('board scope still finds board-card title hits on that board', () => {
    const d = doc();
    d.boards.sub = createBoard({ id: 'sub', title: 'Kitchen remodel' });
    const card = createNote(d, 'home', 0, 0, '');
    card.content = { boardRef: 'sub' };
    card.type = 'board';
    d.elements[card.id] = card;
    const hits = searchBoard(d, 'home', 'remodel');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.boardId).toBe('sub');
    expect(hits[0]!.onBoardId).toBe('home');
  });
});

describe('collectDue', () => {
  it('collects open items with due dates, skips done, sorts by due', () => {
    const d = doc();
    const el = createTodo(d, 'home', 0, 0);
    el.content = {
      todo: {
        title: 'Chores',
        showTitle: true,
        items: [
          { id: 'a', text: 'later', done: false, dueAt: atStartOfDay(10) },
          { id: 'b', text: 'soon', done: false, dueAt: atStartOfDay(0) },
          { id: 'c', text: 'finished', done: true, dueAt: atStartOfDay(-3) },
          { id: 'd', text: 'no date', done: false },
        ],
      },
    };
    d.elements[el.id] = el;
    const items = collectDue(d);
    expect(items.map((i) => i.itemId)).toEqual(['b', 'a']);
    expect(items[0]!.cardTitle).toBe('Chores');
  });

  it('dueSoonCount counts overdue plus today only', () => {
    const d = doc();
    const el = createTodo(d, 'home', 0, 0);
    el.content = {
      todo: {
        title: '',
        showTitle: false,
        items: [
          { id: 'a', text: 'yesterday', done: false, dueAt: atStartOfDay(-1) },
          { id: 'b', text: 'today', done: false, dueAt: atStartOfDay(0) },
          { id: 'c', text: 'tomorrow', done: false, dueAt: atStartOfDay(1) },
        ],
      },
    };
    d.elements[el.id] = el;
    expect(dueSoonCount(d)).toBe(2);
  });
});
