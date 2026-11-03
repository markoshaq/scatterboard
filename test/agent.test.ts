// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Action } from '../src/state/actions';
import { Store } from '../src/state/store';
import {
  createBoard,
  createNote,
  emptyDoc,
  lineDoc,
  noteText,
  UNSORTED,
  type Element,
  type ID,
} from '../src/state/schema';
import { Viewport } from '../src/canvas/viewport';
import { createAgentApi, parseCommand, type AgentHost } from '../src/agent/api';
import { parseCommandUrl } from '../src/agent/cmdurl';
import { AgentError } from '../src/agent/validate';

function harness() {
  const doc = emptyDoc();
  doc.boards.home = createBoard({ id: 'home', title: 'Home' });
  const store = new Store(doc);
  const sel = new Set<ID>();
  const state = { locked: false };
  const host: AgentHost = {
    store,
    prefs: {},
    vp: new Viewport(),
    boardId: 'home',
    agentConnected: false,
    doc,
    lockedView: () => state.locked,
    openBoard: (id) => {
      host.boardId = id;
    },
    setSelection: (ids) => {
      sel.clear();
      for (const i of ids) sel.add(i);
    },
    deleteSelection: () => {
      const now = Date.now();
      const actions: Action[] = [];
      for (const id of sel) {
        const el = doc.elements[id];
        if (!el) continue;
        actions.push({ type: 'element.delete', el });
        actions.push({ type: 'trash.add', id, entry: { el, deletedAt: now } });
      }
      if (actions.length) store.dispatch({ type: 'batch', actions });
      sel.clear();
    },
    stampBoardColor: () => {},
    scheduleSave: () => {},
    editing: { endEdit: () => {} },
    layer: { rectOf: (el: Element) => ({ x: el.x, y: el.y, w: el.w ?? 240, h: 80 }) },
    exporter: { snapshotPng: async () => new Blob(['png'], { type: 'image/png' }) },
    flush: async () => {},
  };
  return { doc, store, sel, state, host, api: createAgentApi(host) };
}

function b64(json: unknown): string {
  return btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const err = async (p: Promise<unknown>): Promise<AgentError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AgentError);
    return e as AgentError;
  }
  throw new Error('expected an AgentError');
};

describe('agent create', () => {
  it('creates a note as a single undoable dispatch', async () => {
    const { doc, store, api } = harness();
    const r = (await api.run('create', { type: 'note', props: { x: 10, y: 20, text: 'hi' } })) as { id: ID };
    const el = doc.elements[r.id];
    expect(el).toBeTruthy();
    expect(noteText(el!)).toBe('hi');
    expect(el!.boardId).toBe('home');
    expect(el!.x).toBe(10);
    store.undo();
    expect(doc.elements[r.id]).toBeUndefined();
  });

  it('rejects unknown types and fields', async () => {
    const { api } = harness();
    expect((await err(api.run('create', { type: 'nope', props: {} }))).code).toBe('bad_type');
    expect((await err(api.run('create', { type: 'note', props: { bogus: 1 } }))).code).toBe('bad_field');
    expect((await err(api.run('create', { type: 'image', props: {} }))).code).toBe('unsupported');
  });

  it('caps oversized strings and clamps w', async () => {
    const { doc, api } = harness();
    const big = (await err(api.run('create', { type: 'note', props: { text: 'x'.repeat(200 * 1024) } }))).code;
    expect(big).toBe('too_large');
    const lo = (await api.run('create', { type: 'note', props: { w: 4 } })) as { id: ID };
    const hi = (await api.run('create', { type: 'note', props: { w: 9000 } })) as { id: ID };
    expect(doc.elements[lo.id]!.w).toBe(140);
    expect(doc.elements[hi.id]!.w).toBe(800);
  });

  it('validates parentId: unsorted, column members, bad refs', async () => {
    const { doc, api } = harness();
    const col = (await api.run('create', { type: 'column', props: {} })) as { id: ID };
    const member = (await api.run('create', { type: 'note', props: { parentId: col.id } })) as { id: ID };
    expect(doc.elements[member.id]!.parentId).toBe(col.id);
    const filed = (await api.run('create', { type: 'note', props: { parentId: 'unsorted' } })) as { id: ID };
    expect(doc.elements[filed.id]!.parentId).toBe(UNSORTED);
    expect((await err(api.run('create', { type: 'note', props: { parentId: 'ghost' } }))).code).toBe('not_found');
    expect((await err(api.run('create', { type: 'note', props: { parentId: member.id } }))).code).toBe('bad_field');
  });

  it('scrubs html props through the import whitelist', async () => {
    const { doc, api } = harness();
    const r = (await api.run('create', {
      type: 'note',
      props: { text: 'x', html: '<b>ok</b><script>alert(1)</script><img src=x onerror=y>' },
    })) as { id: ID };
    const nc = doc.elements[r.id]!.content;
    const html = 'note' in nc ? nc.note.html : '';
    expect(html).toContain('<b>ok</b>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('img');
  });

  it('builds todos, tables, comments and a sub-board card', async () => {
    const { doc, api } = harness();
    const todo = (await api.run('create', {
      type: 'todo',
      props: { title: 'Plan', items: [{ text: 'a', done: true }, { text: 'b', dueAt: 123, dueTime: true, assignee: 'self' }] },
    })) as { id: ID };
    const td = doc.elements[todo.id]!.content;
    expect('todo' in td && td.todo.showTitle).toBe(true);
    expect('todo' in td && td.todo.items[1]!.dueAt).toBe(123);
    const table = (await api.run('create', { type: 'table', props: { cells: { B2: { text: 'hi' } } } })) as { id: ID };
    const tc = doc.elements[table.id]!.content;
    const cells = 'table' in tc ? tc.table.cells : [];
    expect(cells[1]![1]!.text).toBe('hi');
    const board = (await api.run('create', { type: 'board', props: { title: 'Sub' } })) as { id: ID };
    const bc = doc.elements[board.id]!.content;
    const ref = 'boardRef' in bc ? bc.boardRef : '';
    expect(doc.boards[ref]?.title).toBe('Sub');
    expect(doc.boards[ref]?.parentId).toBe('home');
  });
});

describe('agent patch/remove/connect', () => {
  it('patches top fields and content props, rejecting unknown fields', async () => {
    const { doc, store, api } = harness();
    const r = (await api.run('create', { type: 'note', props: { text: 'a' } })) as { id: ID };
    await api.run('patch', { id: r.id, patch: { x: 50, text: 'b', color: '#fff' } });
    const el = doc.elements[r.id]!;
    expect(el.x).toBe(50);
    expect(el.color).toBe('#fff');
    expect(noteText(el)).toBe('b');
    store.undo();
    expect(noteText(doc.elements[r.id]!)).toBe('a');
    expect((await err(api.run('patch', { id: r.id, patch: { nope: 1 } }))).code).toBe('bad_field');
    expect((await err(api.run('patch', { id: 'ghost', patch: { x: 1 } }))).code).toBe('not_found');
  });

  it('removes via the trash path', async () => {
    const { doc, api } = harness();
    const r = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    await api.run('remove', { id: r.id });
    expect(doc.elements[r.id]).toBeUndefined();
    expect(doc.trash[r.id]).toBeTruthy();
  });

  it('connects two cards with an anchored line', async () => {
    const { doc, api } = harness();
    const a = (await api.run('create', { type: 'note', props: { x: 0, y: 0 } })) as { id: ID };
    const b = (await api.run('create', { type: 'note', props: { x: 400, y: 0 } })) as { id: ID };
    const r = (await api.run('connect', { from: a.id, to: b.id, label: 'L', dashed: true, toMarker: 'dot' })) as { id: ID };
    const c = lineDoc(doc.elements[r.id]!);
    expect(c?.from.el).toBe(a.id);
    expect(c?.to.el).toBe(b.id);
    expect(c?.label).toBe('L');
    expect(c?.dashed).toBe(true);
    expect(c?.toMarker).toBe('dot');
    expect((await err(api.run('connect', { from: a.id, to: 'ghost' }))).code).toBe('not_found');
  });
});

describe('agent batch + command urls', () => {
  it('runs a batch as one undo entry', async () => {
    const { doc, store, api } = harness();
    const results = (await api.run('batch', {
      commands: [
        { method: 'create', params: { type: 'note', props: { text: 'a' } } },
        { method: 'create', params: { type: 'todo', props: {} } },
      ],
    })) as { id: ID }[];
    expect(results).toHaveLength(2);
    expect(Object.keys(doc.elements)).toHaveLength(2);
    store.undo();
    expect(Object.keys(doc.elements)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('aborts the whole batch on any bad command', async () => {
    const { doc, store, api } = harness();
    await err(
      api.run('batch', {
        commands: [
          { method: 'create', params: { type: 'note', props: { text: 'a' } } },
          { method: 'patch', params: { id: 'ghost', patch: { x: 1 } } },
        ],
      }),
    );
    expect(Object.keys(doc.elements)).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });

  it('rolls back a batch when a command fails mid-run', async () => {
    const { doc, api } = harness();
    const cmds = [
      { method: 'create', params: { type: 'note', props: { text: 'a' } } },
      { method: 'remove', params: { id: 'ghost' } },
    ];
    await err(api.runCommands(cmds));
    expect(Object.keys(doc.elements)).toHaveLength(0);
  });

  it('parses ?do= payloads in both shapes', () => {
    const cmds = parseCommandUrl(b64({ commands: [{ method: 'create', params: { type: 'note' } }] }));
    expect(cmds[0]!.method).toBe('create');
    const arr = parseCommandUrl(b64([['select', { ids: ['x'] }]]));
    expect(arr[0]!.method).toBe('select');
    expect(() => parseCommandUrl('!!!not-base64!!!')).toThrow(AgentError);
    expect(() => parseCommandUrl(b64({ nope: 1 }))).toThrow(AgentError);
  });

  it('executes a ?do= list end to end', async () => {
    const { doc, api } = harness();
    const raw = b64({
      commands: [
        { method: 'create', params: { type: 'note', props: { text: 'from url', x: 5, y: 5 } } },
        { method: 'create', params: { type: 'swatch', props: { value: '#123456' } } },
      ],
    });
    const out = await api.runCommands(parseCommandUrl(raw));
    expect(out).toHaveLength(2);
    const els = Object.values(doc.elements);
    expect(els.some((e) => noteText(e) === 'from url')).toBe(true);
  });
});

describe('agent reads, selection, view and dispatch', () => {
  it('reads boards and elements and selects', async () => {
    const { sel, api } = harness();
    const boards = (await api.run('boards')) as { id: ID }[];
    expect(boards).toEqual([{ id: 'home', title: 'Home', parentId: null }]);
    const r = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    const els = (await api.run('elements')) as Element[];
    expect(els.map((e) => e.id)).toEqual([r.id]);
    expect(((await api.run('get', { id: r.id })) as Element).id).toBe(r.id);
    expect(await api.run('get', { id: 'ghost' })).toBeNull();
    await api.run('select', { ids: [r.id] });
    expect(sel.has(r.id)).toBe(true);
  });

  it('moves the viewport in board coordinates', async () => {
    const { host, api } = harness();
    host.vp.setSize(1000, 800);
    const v = (await api.run('view', { x: 100, y: 200, z: 2 })) as { x: number; y: number; z: number };
    expect(v.z).toBe(2);
    expect(v.x).toBeCloseTo(100);
    expect(v.y).toBeCloseTo(200);
    const keep = (await api.run('view', { z: 1 })) as { z: number };
    expect(keep.z).toBe(1);
  });

  it('dispatches whitelisted actions and rejects the rest', async () => {
    const { doc, api } = harness();
    const el = createNote(doc, 'home', 0, 0, 'x');
    await api.run('dispatch', { type: 'element.create', el: { type: 'note', boardId: 'home', x: 3, y: 4, content: { note: { text: 'raw' } } } });
    expect(Object.values(doc.elements).some((e) => noteText(e) === 'raw')).toBe(true);
    doc.elements[el.id] = el;
    await api.run('dispatch', { type: 'element.patch', id: el.id, patch: { x: 99 } });
    expect(doc.elements[el.id]!.x).toBe(99);
    expect((await err(api.run('dispatch', { type: 'trash.add', id: 'a', entry: {} }))).code).toBe('forbidden');
    expect((await err(api.run('dispatch', { type: 'template.create', tpl: {} }))).code).toBe('forbidden');
    expect((await err(api.run('dispatch', { type: 'element.patch', id: el.id, patch: { bogus: 1 } }))).code).toBe('bad_field');
  });
});

describe('agent locked view', () => {
  it('rejects mutations but allows reads while locked', async () => {
    const { state, api } = harness();
    state.locked = true;
    expect((await err(api.run('create', { type: 'note', props: {} }))).code).toBe('locked');
    expect((await err(api.run('patch', { id: 'x', patch: {} }))).code).toBe('locked');
    expect((await err(api.run('undo'))).code).toBe('locked');
    expect((await api.run('boards'))).toBeTruthy();
    expect((await api.run('view', { x: 0 }))).toBeTruthy();
  });
});

describe('parseCommand', () => {
  it('normalizes object, name/args and tuple shapes', () => {
    expect(parseCommand({ method: 'boards' }).method).toBe('boards');
    expect(parseCommand({ name: 'get', args: { id: 'a' } }).params).toEqual({ id: 'a' });
    expect(parseCommand(['undo', {}]).method).toBe('undo');
    expect(() => parseCommand(42)).toThrow(AgentError);
    expect(() => parseCommand({ params: {} })).toThrow(AgentError);
  });
});
