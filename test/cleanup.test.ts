// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import {
  createBoard, createBoardCard, createColumn, createComment, createLabel, createLine, createNote,
  emptyDoc, migrateDoc, nextZ, survivingBoard,
  type Doc, type Element, type ID,
} from '../src/state/schema';
import { Store } from '../src/state/store';
import { Deletion } from '../src/app/deletion';
import { Gestures } from '../src/app/gestures';
import { Editing } from '../src/app/editing';
import { Panels } from '../src/app/panels';
import { createAgentApi, type AgentHost } from '../src/agent/api';
import type { Rect } from '../src/canvas/viewport';
import type { App } from '../src/app';
import de from '../src/lang/de';
import es from '../src/lang/es';
import fr from '../src/lang/fr';
import pt from '../src/lang/pt';

// Key-parity: every en string must exist in every locale table.
const enSrc = fs.readFileSync('src/strings.ts', 'utf8');
const enKeys = [...enSrc.slice(0, enSrc.indexOf('\n};')).matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!);
describe('i18n parity', () => {
  for (const [lang, table] of Object.entries({ de, es, fr, pt })) {
    it(`${lang} covers every en key`, () => {
      expect(enKeys.filter((k) => !(k in table))).toEqual([]);
    });
  }
});

describe('migrateDoc', () => {
  it('strips the removed comments record and defaults missing fields', () => {
    const raw = emptyDoc() as Doc & { comments?: Record<string, unknown> };
    raw.comments = { c1: { text: 'ghost' } };
    const m = migrateDoc(raw);
    expect('comments' in m).toBe(false);
    expect(m.labels).toEqual({});
    expect(m.trash).toEqual({});
    expect(m.templates).toEqual({});
  });
});

describe('nextZ + survivingBoard', () => {
  it('nextZ bumps doc.seq and never repeats', () => {
    const d = emptyDoc();
    const a = nextZ(d);
    const b = nextZ(d);
    expect(b).toBe(a + 1);
    expect(d.seq).toBe(2);
  });
  it('prefers home, then first surviving root, then fallback, then anything', () => {
    const d = emptyDoc();
    const home = createBoard({ id: 'home', title: 'H' });
    const root = createBoard({ id: 'r1', title: 'R' });
    const sub = createBoard({ id: 's1', title: 'S', parentId: 'r1' });
    d.boards = { home, r1: root, s1: sub };
    expect(survivingBoard(d)).toBe('home');
    expect(survivingBoard(d, new Set(['home']))).toBe('r1');
    expect(survivingBoard(d, new Set(['home', 'r1']))).toBe('s1');
    expect(survivingBoard(d, new Set(['home', 'r1', 's1']))).toBeNull();
    const d2 = emptyDoc();
    const only = createBoard({ id: 'x', title: 'X' });
    d2.boards = { x: only };
    expect(survivingBoard(d2, new Set(['x']), 'x')).toBeNull();
  });
});

function appFor(store: Store, sel: Set<ID>): App {
  return {
    doc: store.doc,
    store,
    sel,
    filterIds: new Set<ID>(),
    lockedView: () => false,
    editing: { endEdit: () => {} },
    layer: {
      rectOf: (e: Element) => ({ x: e.x, y: e.y, w: e.w ?? 240, h: 200 }),
      members: () => [],
    },
  } as unknown as App;
}

describe('Deletion.deleteSelection cascade', () => {
  it('removes the board subtree, sweeps dead board cards, detaches lines and comments', () => {
    const d = emptyDoc();
    const home = createBoard({ id: 'home', title: 'H' });
    const sub = createBoard({ id: 'sub', title: 'S', parentId: 'home' });
    d.boards = { home, sub };
    const inner = createNote(d, 'sub', 0, 0, 'inside');
    const card = createBoardCard(d, 'home', 'sub', 0, 0);
    const foreign = createBoardCard(d, 'home', 'sub', 300, 0);
    const anchor = createNote(d, 'home', 500, 0, 'anchor');
    const line = createLine(d, 'home', { el: inner.id, x: 0, y: 0 }, { x: 900, y: 900 });
    const pin = createComment(d, 'home', 0, 0, inner.id);
    const lbl = createLabel('sub', 'l', '#fff');
    d.labels[lbl.id] = lbl;
    for (const e of [inner, card, foreign, anchor, line, pin]) d.elements[e.id] = e;
    const store = new Store(d);
    const app = appFor(store, new Set([card.id]));
    new Deletion(app).deleteSelection();
    expect(d.boards.sub).toBeUndefined();
    expect(d.elements[inner.id]).toBeUndefined();
    expect(d.elements[foreign.id]).toBeUndefined();
    expect(d.labels[lbl.id]).toBeUndefined();
    const lineContent = d.elements[line.id]!.content;
    expect('line' in lineContent && lineContent.line.from.el).toBeUndefined();
    expect(d.elements[pin.id]!.anchorId).toBeUndefined();
    expect(d.elements[anchor.id]).toBeDefined();
    expect(d.trash[card.id]).toBeUndefined();
    store.undo();
    expect(d.boards.sub).toBeDefined();
    expect(d.elements[inner.id]).toBeDefined();
    const lineContent2 = d.elements[line.id]!.content;
    expect('line' in lineContent2 && lineContent2.line.from.el).toBe(inner.id);
    expect(d.elements[pin.id]!.anchorId).toBe(inner.id);
  });

  it('unfiles column members beside the column instead of deleting them', () => {
    const d = emptyDoc();
    const home = createBoard({ id: 'home', title: 'H' });
    d.boards = { home };
    const col = createColumn(d, 'home', 100, 100, 'C');
    const m = createNote(d, 'home', 0, 0, 'member');
    m.parentId = col.id;
    d.elements = { [col.id]: col, [m.id]: m };
    const store = new Store(d);
    const app = appFor(store, new Set([col.id]));
    (app.layer.members as unknown as (id: ID) => Element[]) = () => [m];
    new Deletion(app).deleteSelection();
    expect(d.elements[col.id]).toBeUndefined();
    expect(d.elements[m.id]!.parentId).toBeNull();
    expect(d.elements[m.id]!.x).toBeGreaterThan(100);
    expect(d.trash[col.id]).toBeDefined();
  });
});

function gestureHarness() {
  const d = emptyDoc();
  const home = createBoard({ id: 'home', title: 'H' });
  d.boards = { home };
  const store = new Store(d);
  const rects = new Map<ID, Rect>();
  const memberMap = new Map<ID, Element[]>();
  const app = {
    doc: d,
    store,
    sel: new Set<ID>(),
    prefs: {},
    boardId: 'home',
    guides: [] as unknown[],
    lockedView: () => false,
    boardPoint: (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY }),
    vp: { z: 1, toScreen: (x: number, y: number) => ({ x, y }) },
    layer: {
      rectOf: (e: Element) => rects.get(e.id) ?? { x: e.x, y: e.y, w: e.w ?? 200, h: 80 },
      view: () => undefined,
      members: (id: ID) => memberMap.get(id) ?? [],
      elements: () => Object.values(d.elements),
      heightOf: (e: Element) => rects.get(e.id)?.h ?? 80,
    },
    hasAncestor: () => false,
    deleteSelection: () => {},
    selectedEls: () => [...app.sel].map((id) => d.elements[id]!).filter(Boolean),
    setSelection: (ids: Iterable<ID>) => {
      app.sel = new Set(ids);
    },
    requestRender: () => {},
  };
  return { d, store, app: app as unknown as App, rects, memberMap };
}

describe('Gestures member reorder + column drops', () => {
  it('a same-column reorder commits a fractional z between its new neighbours', () => {
    const { d, app, rects, memberMap } = gestureHarness();
    const col = createColumn(d, 'home', 0, 0, 'C');
    const m1 = createNote(d, 'home', 0, 0, 'a');
    const m2 = createNote(d, 'home', 0, 0, 'b');
    const m3 = createNote(d, 'home', 0, 0, 'c');
    m1.z = 1;
    m2.z = 2;
    m3.z = 3;
    for (const m of [m1, m2, m3]) m.parentId = col.id;
    d.elements = { [col.id]: col, [m1.id]: m1, [m2.id]: m2, [m3.id]: m3 };
    rects.set(col.id, { x: 0, y: 0, w: 240, h: 400 });
    rects.set(m1.id, { x: 10, y: 20, w: 200, h: 80 });
    rects.set(m2.id, { x: 10, y: 120, w: 200, h: 80 });
    rects.set(m3.id, { x: 10, y: 220, w: 200, h: 80 });
    memberMap.set(col.id, [m1, m2, m3]);
    const g = new Gestures(app);
    // Drag m3 to the slot between m1 (mid 60) and m2 (mid 160).
    const ev = { clientX: 20, clientY: 100, pointerId: 1 } as PointerEvent;
    g.dragMove([m3.id], new Map([[m3.id, { x: 10, y: 220 }]]), { x: 20, y: 260 }, ev);
    g.endDrag();
    expect(d.elements[m3.id]!.z).toBe(1.5);
  });

  it('a drop mid-stack spreads z evenly between the slot neighbours', () => {
    const { d, app, rects, memberMap } = gestureHarness();
    const col = createColumn(d, 'home', 0, 0, 'C');
    col.z = 100;
    const m1 = createNote(d, 'home', 0, 0, 'a');
    const m2 = createNote(d, 'home', 0, 0, 'b');
    m1.z = 10;
    m2.z = 20;
    for (const m of [m1, m2]) m.parentId = col.id;
    const a = createNote(d, 'home', 500, 0, 'x');
    const b = createNote(d, 'home', 500, 100, 'y');
    d.elements = { [col.id]: col, [m1.id]: m1, [m2.id]: m2, [a.id]: a, [b.id]: b };
    rects.set(col.id, { x: 0, y: 0, w: 240, h: 400 });
    rects.set(m1.id, { x: 10, y: 20, w: 200, h: 80 });
    rects.set(m2.id, { x: 10, y: 120, w: 200, h: 80 });
    memberMap.set(col.id, [m1, m2]);
    app.sel = new Set([a.id, b.id]);
    const g = new Gestures(app);
    // Pointer sits between the two member midpoints (60 and 160).
    g.updateDropTarget({ x: 20, y: 110 }, [a.id, b.id]);
    const seq0 = d.seq;
    g.endDrag();
    expect(d.elements[a.id]!.parentId).toBe(col.id);
    expect(d.elements[b.id]!.parentId).toBe(col.id);
    const za = d.elements[a.id]!.z;
    const zb = d.elements[b.id]!.z;
    expect(za).toBeGreaterThan(10);
    expect(zb).toBeGreaterThan(za);
    expect(zb).toBeLessThan(20);
    expect(d.seq).toBe(seq0);
  });

  it('a drop with no open slot appends on the doc sequence', () => {
    const { d, app, rects, memberMap } = gestureHarness();
    const col = createColumn(d, 'home', 0, 0, 'C');
    const m1 = createNote(d, 'home', 0, 0, 'a');
    m1.z = 10;
    m1.parentId = col.id;
    const a = createNote(d, 'home', 500, 0, 'x');
    d.elements = { [col.id]: col, [m1.id]: m1, [a.id]: a };
    rects.set(col.id, { x: 0, y: 0, w: 240, h: 400 });
    memberMap.set(col.id, [m1]);
    app.sel = new Set([a.id]);
    const g = new Gestures(app);
    g.dropColId = col.id;
    const seq0 = d.seq;
    g.endDrag();
    expect(d.elements[a.id]!.parentId).toBe(col.id);
    expect(d.elements[a.id]!.z).toBe(seq0 + 1);
  });
});

describe('Editing text commits', () => {
  function editingHarness() {
    const d = emptyDoc();
    const home = createBoard({ id: 'home', title: 'H' });
    const b2 = createBoard({ id: 'b2', title: 'B2' });
    d.boards = { home, b2 };
    const store = new Store(d);
    const app = {
      doc: d,
      store,
      boardId: 'home',
      prefs: {},
      lockedView: () => false,
      scheduleSave: () => {},
    };
    return { d, store, ed: new Editing(app as unknown as App) };
  }

  it('commitEditText sanitizes injected markup before persisting', () => {
    const { d, ed } = editingHarness();
    const n = createNote(d, 'home', 0, 0, 'x');
    d.elements[n.id] = n;
    ed.commitEditText(n, 'hello', '<b>hi</b><script>alert(1)</script><img src=x onerror=alert(1)>');
    const c = d.elements[n.id]!.content;
    const html = 'note' in c ? c.note.html : undefined;
    expect('note' in c && c.note.text).toBe('hello');
    expect(html).toContain('<b>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('onTextInput propagates note content to same-board group members only', () => {
    const { d, ed } = editingHarness();
    const n1 = createNote(d, 'home', 0, 0, 'one');
    const n2 = createNote(d, 'home', 0, 0, 'two');
    const n3 = createNote(d, 'b2', 0, 0, 'three');
    const n4 = createNote(d, 'home', 0, 0, 'four');
    n1.syncGroup = 'sg';
    n2.syncGroup = 'sg';
    n3.syncGroup = 'sg';
    n4.syncGroup = 'other';
    const col = createColumn(d, 'home', 0, 0, 'c');
    col.syncGroup = 'sg';
    d.elements = { [n1.id]: n1, [n2.id]: n2, [n3.id]: n3, [n4.id]: n4, [col.id]: col };
    ed.onTextInput(n1.id, 'hello');
    const text = (e: Element) => ('note' in e.content ? e.content.note.text : null);
    expect(text(d.elements[n1.id]!)).toBe('hello');
    expect(text(d.elements[n2.id]!)).toBe('hello');
    expect(text(d.elements[n3.id]!)).toBe('three');
    expect(text(d.elements[n4.id]!)).toBe('four');
  });
});

function agentHost(d: Doc, boardId: ID): AgentHost {
  const store = new Store(d);
  const sel = new Set<ID>();
  const host: AgentHost = {
    store,
    prefs: {},
    vp: { z: 1, vw: 800, vh: 600, x: 0, y: 0, toBoard: (x: number, y: number) => ({ x, y }) } as AgentHost['vp'],
    boardId,
    agentConnected: false,
    doc: d,
    lockedView: () => false,
    openBoard: () => {},
    sel,
    setSelection: () => {},
    deleteSelection: () => {},
    stampBoardColor: (el: Element) => {
      el.color = '#123';
    },
    scheduleSave: () => {},
    editing: { endEdit: () => {} },
    layer: { rectOf: (e: Element) => ({ x: e.x, y: e.y, w: e.w ?? 240, h: 80 }) },
    exporter: {
      snapshotPng: async () => null,
      boardRaster: async () => null,
      mediaZip: async () => null,
    },
    blobStore: { put: async () => {} },
    flush: async () => {},
    presenting: false,
    enterPresent: () => {},
    exitPresent: () => {},
    setPresentOpts: () => {},
  };
  return host;
}

function trashedFixture() {
  const d = emptyDoc();
  const home = createBoard({ id: 'home', title: 'H' });
  const b2 = createBoard({ id: 'b2', title: 'B2' });
  d.boards = { home, b2 };
  const anchor = createNote(d, 'home', 0, 0, 'anchor');
  const el = createComment(d, 'home', 0, 0, anchor.id);
  el.labels = ['lb-home', 'lb-b2', 'lb-gone'];
  el.syncGroup = 'sg1';
  d.labels = {
    'lb-home': { id: 'lb-home', boardId: 'home', name: 'H', color: '#f00' },
    'lb-b2': { id: 'lb-b2', boardId: 'b2', name: 'B', color: '#0f0' },
  };
  d.elements = { [anchor.id]: anchor };
  d.trash = { [el.id]: { el, deletedAt: 1 } };
  return { d, trashId: el.id };
}

describe('trash restore fixups', () => {
  it('the trash panel and the agent restore command apply identical fixups', async () => {
    const fixups = (el: Element) => ({
      boardId: el.boardId,
      anchorId: el.anchorId ?? null,
      labels: el.labels,
      syncGroup: el.syncGroup ?? null,
    });

    const panelRun = trashedFixture();
    const pstore = new Store(panelRun.d);
    const papp = {
      doc: panelRun.d,
      store: pstore,
      boardId: 'b2',
      lockedView: () => false,
      columnAt: () => null,
      stampBoardColor: () => {},
      setSelection: () => {},
    };
    new Panels(papp as unknown as App).restoreTrash(panelRun.trashId, { x: 10, y: 20 });
    const viaPanel = panelRun.d.elements[panelRun.trashId]!;

    const agentRun = trashedFixture();
    const api = createAgentApi(agentHost(agentRun.d, 'b2'));
    await api.run('restore', { id: agentRun.trashId, boardId: 'b2', x: 10, y: 20 });
    const viaAgent = agentRun.d.elements[agentRun.trashId]!;

    // Dead/foreign-board anchor dropped, labels filtered to the target
    // board, syncGroup cleared on the cross-board restore.
    const want = { boardId: 'b2', anchorId: null, labels: ['lb-b2'], syncGroup: null };
    expect(fixups(viaPanel)).toEqual(want);
    expect(fixups(viaAgent)).toEqual(want);
    expect(panelRun.d.trash[panelRun.trashId]).toBeUndefined();
    expect(agentRun.d.trash[agentRun.trashId]).toBeUndefined();
  });
});

describe('Store emit + undo bookkeeping', () => {
  it('a patch on a missing element does not bump rev or fire listeners', () => {
    const d = emptyDoc();
    const store = new Store(d);
    let fired = 0;
    store.onChange(() => fired++);
    store.dispatch({ type: 'element.patch', id: 'missing', patch: { x: 1 } });
    expect(store.rev).toBe(0);
    expect(fired).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it('element.patch undo restores the pre-patch modifiedAt', () => {
    const d = emptyDoc();
    const home = createBoard({ id: 'home', title: 'H' });
    d.boards = { home };
    const n = createNote(d, 'home', 0, 0, 'x');
    n.modifiedAt = 1000;
    d.elements[n.id] = n;
    const store = new Store(d);
    store.dispatch({ type: 'element.patch', id: n.id, patch: { x: 42 } });
    expect(d.elements[n.id]!.x).toBe(42);
    expect(d.elements[n.id]!.modifiedAt).toBeGreaterThan(1000);
    store.undo();
    expect(d.elements[n.id]!.x).toBe(0);
    expect(d.elements[n.id]!.modifiedAt).toBe(1000);
  });
});
