import { describe, expect, it } from 'vitest';
import {
  createBoard, createBoardCard, createColumn, createDocument, createHeading, createLink,
  createNote, createTable, createTodo, emptyDoc, type Doc, type TableCell,
} from '../src/state/schema';
import { boardItems, toMarkdown, toPlain, toWordHtml } from '../src/export/linear';

function doc(): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  return d;
}

function put(d: Doc, el: ReturnType<typeof createNote>) {
  d.elements[el.id] = el;
  return el;
}

describe('boardItems reading order', () => {
  it('sorts cards into rows by y then x within the row tolerance', () => {
    const d = doc();
    put(d, createNote(d, 'home', 300, 0, 'right'));
    put(d, createNote(d, 'home', 0, 40, 'left')); // same row (within 120)
    put(d, createNote(d, 'home', 0, 300, 'below'));
    const items = boardItems(d, 'home', false);
    const order = items.map((i) => (i.k === 'p' ? i.text : ''));
    expect(order).toEqual(['left', 'right', 'below']);
  });

  it('flattens column members under the column title', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'Pile');
    put(d, col);
    const m = createNote(d, 'home', 0, 0, 'member');
    m.parentId = col.id;
    put(d, m);
    const items = boardItems(d, 'home', false);
    expect(items[0]).toEqual({ k: 'h', level: 3, text: 'Pile' });
    expect(items[1]).toEqual({ k: 'p', text: 'member' });
  });

  it('expands sub-boards when subs is on, once per board', () => {
    const d = doc();
    d.boards.sub = createBoard({ id: 'sub', title: 'Sub', parentId: 'home' });
    put(d, createBoardCard(d, 'home', 'sub', 0, 0));
    put(d, createBoardCard(d, 'home', 'sub', 0, 300));
    const inner = createNote(d, 'sub', 0, 0, 'inside');
    d.elements[inner.id] = inner;
    const off = boardItems(d, 'home', false);
    expect(off).toHaveLength(2);
    const on = boardItems(d, 'home', true);
    // Two board cards: each emits a heading, only the first expands.
    expect(on.filter((i) => i.k === 'h')).toHaveLength(2);
    expect(on.filter((i) => i.k === 'p' && i.text === 'inside')).toHaveLength(1);
  });
});

describe('cell display values', () => {
  it('resolves checkboxes, formulas, percent and typed cells', () => {
    const d = doc();
    const t = createTable(d, 'home', 0, 0);
    const cells: TableCell[][] = [
      [{ text: '1', type: 'checkbox' }, { text: '0', type: 'checkbox' }],
      [{ text: '0.25', type: 'percent' }, { text: '=SUM(A1:A2)' }],
      [{ text: 'raw', type: 'number' }, { text: 'oops', type: 'datetime' }],
    ];
    (t.content as { table: { cells: TableCell[][] } }).table.cells = cells;
    put(d, t);
    const item = boardItems(d, 'home', false).find((i) => i.k === 'table')!;
    expect(item.k === 'table' && item.rows[0]).toEqual(['[x]', '[ ]']);
    expect(item.k === 'table' && item.rows[1]).toEqual(['25%', '1.25']);
    // Non-numeric text in a typed cell falls back to the raw text.
    expect(item.k === 'table' && item.rows[2]).toEqual(['raw', 'oops']);
  });
});

describe('serializers', () => {
  function sample() {
    const d = doc();
    put(d, createHeading(d, 'home', 0, 0, 1));
    const h = put(d, createHeading(d, 'home', 0, 40, 2));
    (h.content as { heading: { text: string } }).heading.text = 'Plan';
    put(d, createNote(d, 'home', 0, 80, 'do the thing'));
    const todo = put(d, createTodo(d, 'home', 0, 120));
    (todo.content as { todo: { items: { text: string; done: boolean }[] } }).todo.items = [
      { text: 'a', done: true },
      { text: 'b', done: false },
    ];
    const link = put(d, createLink(d, 'home', 0, 160, 'https://example.com'));
    (link.content as { link: { title: string } }).link.title = 'Site';
    const docEl = put(d, createDocument(d, 'home', 0, 200));
    (docEl.content as { document: { title: string; text: string } }).document = {
      title: 'Doc',
      text: 'line one\nline two',
    };
    return d;
  }

  it('markdown covers headings, todos, links and tables', () => {
    const d = sample();
    const t = createTable(d, 'home', 0, 240);
    (t.content as { table: { cells: TableCell[][]; title: string; caption: string } }).table = {
      title: 'T',
      cells: [[{ text: 'a|b' }, { text: 'c' }], [{ text: 'x\ny' }, { text: 'z' }]],
      caption: '',
    };
    put(d, t);
    const md = toMarkdown('Home', boardItems(d, 'home', false));
    expect(md).toContain('# Home');
    expect(md).toContain('## Plan');
    expect(md).toContain('do the thing');
    expect(md).toContain('- [x] a');
    expect(md).toContain('- [ ] b');
    expect(md).toContain('[Site](<https://example.com>)');
    expect(md).toContain('### Doc');
    expect(md).toContain('a\\|b'); // pipes escape
    expect(md).toContain('x y'); // newlines collapse in cells
    expect(md.endsWith('\n')).toBe(true);
  });

  it('plain text flattens structure readably', () => {
    const d = sample();
    const txt = toPlain('Home', boardItems(d, 'home', false));
    expect(txt.startsWith('HOME')).toBe(true);
    expect(txt).toContain('Plan');
    expect(txt).toContain('[x] a');
    expect(txt).toContain('Site https://example.com');
  });

  it('word html escapes markup in card text', () => {
    const d = doc();
    put(d, createNote(d, 'home', 0, 0, '<b>x</b> & "y"'));
    const html = toWordHtml('H<o>me', boardItems(d, 'home', false));
    expect(html).toContain('<title>H&lt;o&gt;me</title>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(html).not.toContain('<b>x</b>');
  });
});
