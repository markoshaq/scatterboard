import { describe, expect, it } from 'vitest';
import { applyAction, emptyChange, type Action } from '../src/state/actions';
import {
  createBoard, createColumn, createComment, createLabel, createNote,
  emptyDoc, migrateDoc, UNSORTED, type Doc, type Element,
} from '../src/state/schema';
import { remapElements } from '../src/state/clone';
import { Store } from '../src/state/store';
import { getClipboard, setClipboard } from '../src/state/clipboard';
import { instantiateActions, snapshotTemplate } from '../src/state/templates';
import { searchBoard } from '../src/ui/search';
import { evalFormula, isFormula, remapCells } from '../src/cards/formula';
import { exportBoard, importActions, parseBoardExport } from '../src/export/jsonio';
import type { TableCell } from '../src/state/schema';

function doc(): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  return d;
}

function apply(d: Doc, a: Action): Action {
  return applyAction(d, a, emptyChange());
}

describe('applyAction inverses', () => {
  it('element.create inverse deletes', () => {
    const d = doc();
    const el = createNote(d, 'home', 0, 0, 'hi');
    const inv = apply(d, { type: 'element.create', el });
    expect(d.elements[el.id]).toBe(el);
    apply(d, inv);
    expect(d.elements[el.id]).toBeUndefined();
  });

  it('element.patch restores previous field values', () => {
    const d = doc();
    const el = createNote(d, 'home', 0, 0, 'hi');
    apply(d, { type: 'element.create', el });
    const inv = apply(d, { type: 'element.patch', id: el.id, patch: { x: 500, color: '#fff' } });
    expect(el.x).toBe(500);
    expect(el.color).toBe('#fff');
    apply(d, inv);
    expect(el.x).toBe(0);
    expect(el.color).toBeUndefined();
  });

  it('batch inverse applies children in reverse order', () => {
    const d = doc();
    const a = createNote(d, 'home', 0, 0, 'a');
    const b = createNote(d, 'home', 10, 10, 'b');
    const inv = apply(d, {
      type: 'batch',
      actions: [{ type: 'element.create', el: a }, { type: 'element.create', el: b }],
    });
    expect(d.elements[a.id]).toBeTruthy();
    expect(d.elements[b.id]).toBeTruthy();
    apply(d, inv);
    expect(d.elements[a.id]).toBeUndefined();
    expect(d.elements[b.id]).toBeUndefined();
  });

  it('element.delete inverse re-creates the element', () => {
    const d = doc();
    const el = createNote(d, 'home', 0, 0, 'bye');
    apply(d, { type: 'element.create', el });
    const inv = apply(d, { type: 'element.delete', el });
    expect(d.elements[el.id]).toBeUndefined();
    apply(d, inv);
    expect(d.elements[el.id]?.content).toEqual(el.content);
  });
});

describe('evalFormula', () => {
  const cells: TableCell[][] = [
    [{ text: '2' }, { text: '3' }],
    [{ text: '4' }, { text: 'x' }],
    [{ text: '6' }, { text: '' }],
  ];
  it('evaluates SUM over a range', () => {
    expect(evalFormula('=SUM(A1:A3)', cells)).toBe('12');
  });
  it('evaluates single refs and arithmetic', () => {
    expect(evalFormula('=SUM(A1,B1,A2)', cells)).toBe('9');
  });
  it('evaluates AVERAGE/MIN/MAX/COUNT', () => {
    expect(evalFormula('=AVERAGE(A1:A3)', cells)).toBe('4');
    expect(evalFormula('=MIN(A1:A3)', cells)).toBe('2');
    expect(evalFormula('=MAX(A1:A3)', cells)).toBe('6');
    expect(evalFormula('=COUNT(A1:B3)', cells)).toBe('4');
  });
  it('evaluates IF', () => {
    expect(evalFormula('=IF(A1>1,10,20)', cells)).toBe('10');
    expect(evalFormula('=IF(A1>5,10,20)', cells)).toBe('20');
  });
  it('detects formulas and rejects bad ones', () => {
    expect(isFormula('=SUM(A1)')).toBe(true);
    expect(isFormula('hello')).toBe(false);
    expect(evalFormula('=NOPE(A1)', cells)).toBeNull();
    expect(evalFormula('=SUM(Z9)', cells)).toBe('0'); // empty cells sum to 0
  });
});

describe('migrateDoc', () => {
  it('fills missing collections and recomputes seq', () => {
    const d = doc();
    // Simulate a v1 doc missing additive fields.
    const raw = { boards: d.boards, elements: {}, seq: 0 } as unknown as Doc;
    const el = createNote(d, 'home', 0, 0, 'x');
    el.z = 42;
    delete (el as Partial<Element>).labels;
    raw.elements[el.id] = el;
    const m = migrateDoc(raw);
    expect(m.comments).toEqual({});
    expect(m.labels).toEqual({});
    expect(m.trash).toEqual({});
    expect(m.templates).toEqual({});
    expect(m.elements[el.id]!.labels).toEqual([]);
    expect(m.seq).toBe(42);
  });
});

describe('remapElements', () => {
  it('clones with fresh ids, offsets, and z order preserved', () => {
    const d = doc();
    const a = createNote(d, 'home', 0, 0, 'a');
    const b = createNote(d, 'home', 10, 0, 'b');
    a.z = 1;
    b.z = 5;
    const { clones, idMap } = remapElements(d, [a, b], () => 'home', 100, 50);
    expect(idMap.get(a.id)).not.toBe(a.id);
    expect(clones[0]!.x).toBe(100);
    expect(clones[0]!.y).toBe(50);
    expect(clones[1]!.z).toBeGreaterThan(clones[0]!.z);
    expect(clones[0]!.content).toEqual(a.content);
  });

  it('rebinds parentId, anchorId and board-local labels', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'c');
    const member = createNote(d, 'home', 0, 0, 'm');
    member.parentId = col.id;
    const label = createLabel('home', 'Ship', '#f00');
    d.labels[label.id] = label;
    member.labels = [label.id];
    const cmt = createComment(d, 'home', 0, 0, member.id);
    const { clones, idMap } = remapElements(d, [col, member, cmt], () => 'home', 0, 0);
    expect(clones[1]!.parentId).toBe(idMap.get(col.id));
    expect(clones[1]!.labels).toEqual([label.id]);
    expect(clones[2]!.anchorId).toBe(idMap.get(member.id));
  });
});

describe('jsonio round trip', () => {
  it('exports and re-imports a subtree with fresh ids', () => {
    const d = doc();
    const sub = createBoard({ id: 'sub', title: 'Sub', parentId: 'home' });
    d.boards.sub = sub;
    d.elements.bc1 = { ...createNote(d, 'home', 0, 0), id: 'bc1', type: 'board', content: { boardRef: 'sub' } };
    const n = createNote(d, 'sub', 5, 5, 'inside');
    const label = createLabel('sub', 'L1', '#00f');
    d.labels[label.id] = label;
    n.labels = [label.id];
    d.elements[n.id] = n;

    const text = exportBoard(d, 'sub');
    expect(text).toBeTruthy();
    const data = parseBoardExport(text!);
    expect(data).toBeTruthy();

    const res = importActions(d, data!, 'home');
    expect(res).toBeTruthy();
    const change = emptyChange();
    for (const a of res!.actions) applyAction(d, a, change);

    expect(res!.boardId).not.toBe('sub');
    const newBoard = d.boards[res!.boardId];
    expect(newBoard.title).toBe('Sub');
    expect(newBoard.parentId).toBe('home');
    const imported = Object.values(d.elements).filter((e) => e.boardId === res!.boardId);
    expect(imported.length).toBe(1);
    expect(imported[0]!.id).not.toBe(n.id);
    const newLabel = d.labels[imported[0]!.labels[0]!];
    expect(newLabel.name).toBe('L1');
    expect(newLabel.boardId).toBe(res!.boardId);
  });
});

describe('Store groups', () => {
  it('coalesces same-element patches inside a group into one entry', () => {
    const store = new Store(doc());
    const el = createNote(store.doc, 'home', 0, 0, 'x');
    store.dispatch({ type: 'element.create', el });
    store.beginGroup();
    store.dispatch({ type: 'element.patch', id: el.id, patch: { x: 100 } });
    store.dispatch({ type: 'element.patch', id: el.id, patch: { x: 200, color: '#fff' } });
    store.endGroup('edit');
    expect(el.x).toBe(200);
    store.undo();
    expect(el.x).toBe(0);
    expect(el.color).toBeUndefined();
    expect(store.canUndo).toBe(true); // the create entry remains
    store.redo();
    expect(el.x).toBe(200);
    expect(el.color).toBe('#fff');
  });

  it('nested begins join the outer group', () => {
    const store = new Store(doc());
    const el = createNote(store.doc, 'home', 0, 0, 'x');
    store.dispatch({ type: 'element.create', el });
    store.beginGroup();
    store.beginGroup();
    store.dispatch({ type: 'element.patch', id: el.id, patch: { y: 50 } });
    store.endGroup();
    expect(store.inGroup).toBe(true);
    store.endGroup();
    store.undo();
    expect(el.y).toBe(0);
  });

  it('undo during an open group pops the previous entry', () => {
    const store = new Store(doc());
    const a = createNote(store.doc, 'home', 0, 0, 'a');
    const b = createNote(store.doc, 'home', 10, 0, 'b');
    store.dispatch({ type: 'element.create', el: a });
    store.dispatch({ type: 'element.create', el: b });
    store.beginGroup();
    store.dispatch({ type: 'element.patch', id: a.id, patch: { x: 99 } });
    store.undo();
    expect(store.doc.elements[b.id]).toBeUndefined();
    expect(a.x).toBe(99); // unflushed group edit survives
    store.endGroup();
    expect(store.doc.elements[b.id]).toBeUndefined();
  });
});

describe('clipboard', () => {
  it('round-trips snapshots independent of the source elements', () => {
    const d = doc();
    const el = createNote(d, 'home', 0, 0, 'clip');
    setClipboard([el]);
    el.x = 999;
    const out = getClipboard()!;
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBe(0);
    out[0]!.x = 555;
    expect(getClipboard()?.[0]?.x).toBe(0);
  });
});

describe('searchBoard', () => {
  it('finds note text, skips other boards and unsorted, hits board titles', () => {
    const d = doc();
    const sub = createBoard({ id: 'sub', title: 'Garden plans', parentId: 'home' });
    d.boards.sub = sub;
    const hit = createNote(d, 'home', 0, 0, 'water the garden');
    const other = createNote(d, 'sub', 0, 0, 'garden tools');
    const filed = createNote(d, 'home', 0, 0, 'garden shed');
    filed.parentId = UNSORTED;
    const card = { ...createNote(d, 'home', 0, 0), type: 'board' as const, content: { boardRef: 'sub' } };
    d.elements[hit.id] = hit;
    d.elements[other.id] = other;
    d.elements[filed.id] = filed;
    d.elements[card.id] = card;

    const hits = searchBoard(d, 'home', 'garden');
    expect(hits.some((h) => h.elementId === hit.id)).toBe(true);
    expect(hits.some((h) => h.elementId === other.id)).toBe(false);
    expect(hits.some((h) => h.elementId === filed.id)).toBe(false);
    expect(hits.some((h) => h.boardId === 'sub' && h.snippet.includes('Garden'))).toBe(true);
    expect(searchBoard(d, 'home', '  ')).toEqual([]);
  });
});

describe('templates', () => {
  it('instantiates a fresh child board with rebound labels and a card', () => {
    const d = doc();
    const src = createBoard({ id: 'src', title: 'Source', parentId: 'home' });
    d.boards.src = src;
    const label = createLabel('src', 'Tag', '#0f0');
    d.labels[label.id] = label;
    const n = createNote(d, 'src', 10, 10, 'inside');
    n.labels = [label.id];
    d.elements[n.id] = n;
    const tpl = snapshotTemplate(d, 'src', 'My tpl')!;

    const { actions, cardId } = instantiateActions(d, tpl, 'home', { x: 300, y: 200 });
    const change = emptyChange();
    for (const a of actions) applyAction(d, a, change);

    const card = d.elements[cardId]!;
    expect(card.type).toBe('board');
    const newBoardId = (card.content as { boardRef: string }).boardRef;
    const board = d.boards[newBoardId]!;
    expect(board.title).toBe('Source');
    expect(board.parentId).toBe('home');
    const clones = Object.values(d.elements).filter((e) => e.boardId === newBoardId);
    expect(clones).toHaveLength(1);
    expect(clones[0]!.id).not.toBe(n.id);
    const newLabel = d.labels[clones[0]!.labels[0]!]!;
    expect(newLabel.name).toBe('Tag');
    expect(newLabel.boardId).toBe(newBoardId);
    expect(newLabel.id).not.toBe(label.id);
  });
});

describe('remapCells', () => {
  const cells: TableCell[][] = [
    [{ text: 'A' }, { text: '1' }, { text: '2' }],
    [{ text: 'B' }, { text: '3' }, { text: '=SUM(B1:C1)' }],
  ];
  it('shifts refs on column insert', () => {
    const out = remapCells(cells, (r, c) => ({ r, c: c >= 1 ? c + 1 : c }));
    expect(out[1]?.[2]?.text).toBe('=SUM(C1:D1)');
  });
  it('shifts refs on row delete, boundary refs stay', () => {
    const out = remapCells(cells, (r, c) => ({ r: r > 0 ? r - 1 : r, c }));
    expect(out[1]?.[2]?.text).toBe('=SUM(B1:C1)');
    const moved = remapCells([[{ text: '=SUM(B3:C3)' }]], (r, c) => ({ r: r > 0 ? r - 1 : r, c }));
    expect(moved[0]?.[0]?.text).toBe('=SUM(B2:C2)');
  });
  it('leaves quoted literals and non-formulas alone', () => {
    const src: TableCell[][] = [[{ text: '=IF(A1="B2","yes","no")' }, { text: 'plain B2' }]];
    const out = remapCells(src, (r, c) => ({ r, c: c + 1 }));
    expect(out[0]?.[0]?.text).toBe('=IF(B1="B2","yes","no")');
    expect(out[0]?.[1]?.text).toBe('plain B2');
  });
});
