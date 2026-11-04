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
import { parseCommandUrl, runCommandUrl } from '../src/agent/cmdurl';
import { AgentError } from '../src/agent/validate';

function harness() {
  const doc = emptyDoc();
  doc.boards.home = createBoard({ id: 'home', title: 'Home' });
  const store = new Store(doc);
  const sel = new Set<ID>();
  const state = { locked: false };
  const blobs: { id: ID; blob: Blob }[] = [];
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
    sel,
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
    exporter: {
      snapshotPng: async () => new Blob(['png'], { type: 'image/png' }),
      boardRaster: async () => null,
      mediaZip: async () => null,
    },
    blobStore: {
      put: async (id, blob) => {
        blobs.push({ id, blob });
      },
    },
    flush: async () => {},
    presenting: false,
    enterPresent: () => {
      host.presenting = true;
    },
    exitPresent: () => {
      host.presenting = false;
    },
    setPresentOpts: (o) => {
      const b = host.boardId ? doc.boards[host.boardId] : undefined;
      if (b) b.presentOpts = { ...b.presentOpts, ...o };
    },
  };
  return { doc, store, sel, state, blobs, host, api: createAgentApi(host) };
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
    expect(boards[0]).toMatchObject({ id: 'home', title: 'Home', parentId: null, grid: true });
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

describe('agent trash, templates and present', () => {
  it('lists, restores and empties the trash', async () => {
    const { doc, api } = harness();
    const a = (await api.run('create', { type: 'note', props: { text: 'a', x: 10, y: 10 } })) as { id: ID };
    await api.run('remove', { id: a.id });
    const list = (await api.run('trash')) as { id: ID; el: Element }[];
    expect(list.map((e) => e.id)).toEqual([a.id]);
    const r = (await api.run('restore', { id: a.id, x: 40, y: 60 })) as { id: ID };
    expect(r.id).toBe(a.id);
    expect(doc.elements[a.id]!.x).toBe(40);
    expect(doc.elements[a.id]!.y).toBe(60);
    expect(doc.trash[a.id]).toBeUndefined();
    expect((await err(api.run('restore', { id: a.id }))).code).toBe('not_found');
    await api.run('remove', { id: a.id });
    const b = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    await api.run('remove', { id: b.id });
    expect(((await api.run('emptyTrash')) as { removed: number }).removed).toBe(2);
    expect(Object.keys(doc.trash)).toHaveLength(0);
    expect(doc.elements[a.id]).toBeUndefined();
  });

  it('restores to the entry board when no board is open', async () => {
    const { doc, host, api } = harness();
    const a = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    await api.run('remove', { id: a.id });
    host.boardId = null;
    await api.run('restore', { id: a.id });
    expect(doc.elements[a.id]!.boardId).toBe('home');
  });

  it('lists, instantiates and saves templates', async () => {
    const { doc, api } = harness();
    const list = (await api.run('templates')) as { id: string; name: string; builtin: boolean }[];
    expect(list.some((t) => t.id === 'builtin:sprint' && t.builtin)).toBe(true);
    const r = (await api.run('instantiate', { id: 'builtin:sprint' })) as { boardId: ID; cardId: ID };
    expect(doc.boards[r.boardId]?.title).toBe('Sprint plan');
    expect(doc.boards[r.boardId]?.parentId).toBe('home');
    expect(doc.elements[r.cardId]?.type).toBe('board');
    const root = (await api.run('instantiate', { id: 'builtin:week', boardId: null })) as { boardId: ID };
    expect(doc.boards[root.boardId]?.parentId).toBeNull();
    const saved = (await api.run('saveTemplate', { name: 'Mine' })) as { id: ID };
    expect(doc.templates[saved.id]?.name).toBe('Mine');
    expect((await api.run('templates') as { id: string }[]).some((t) => t.id === saved.id)).toBe(true);
    expect((await err(api.run('instantiate', { id: 'ghost' }))).code).toBe('not_found');
  });

  it('renames and deletes templates through dispatch', async () => {
    const { doc, api } = harness();
    const saved = (await api.run('saveTemplate', { name: 'Old' })) as { id: ID };
    await api.run('dispatch', { type: 'template.patch', id: saved.id, patch: { name: 'New' } });
    expect(doc.templates[saved.id]?.name).toBe('New');
    expect((await err(api.run('dispatch', { type: 'template.patch', id: saved.id, patch: { bogus: 1 } }))).code).toBe(
      'bad_field',
    );
    await api.run('dispatch', { type: 'template.delete', tpl: { id: saved.id } });
    expect(doc.templates[saved.id]).toBeUndefined();
    expect((await err(api.run('dispatch', { type: 'template.create', tpl: {} }))).code).toBe('forbidden');
    expect((await err(api.run('dispatch', { type: 'trash.remove', id: saved.id }))).code).toBe('forbidden');
  });

  it('toggles presentation mode and opts, even while locked', async () => {
    const { doc, host, state, api } = harness();
    const r = (await api.run('present', { on: true, focus: true, edit: true })) as {
      presenting: boolean;
      presentOpts: { focus?: boolean; edit?: boolean };
    };
    expect(r.presenting).toBe(true);
    expect(r.presentOpts.focus).toBe(true);
    expect(doc.boards.home!.presentOpts).toEqual({ focus: true, edit: true });
    state.locked = true;
    expect((await err(api.run('create', { type: 'note', props: {} }))).code).toBe('locked');
    const off = (await api.run('present', { on: false })) as { presenting: boolean };
    expect(off.presenting).toBe(false);
    expect(host.presenting).toBe(false);
    expect((await err(api.run('present', { bogus: 1 }))).code).toBe('bad_field');
  });
});

describe('agent upload, export, import and unfurl', () => {
  it('uploads a file card from base64', async () => {
    const { doc, blobs, sel, api } = harness();
    const r = (await api.run('upload', {
      data: 'aGVsbG8=',
      name: 'hi.txt',
      mime: 'text/plain',
      x: 5,
      y: 6,
    })) as { id: ID; type: string };
    expect(r.type).toBe('file');
    const el = doc.elements[r.id]!;
    expect(el.x).toBe(5);
    expect(blobs).toHaveLength(1);
    expect(await blobs[0]!.blob.text()).toBe('hello');
    const c = el.content;
    expect('file' in c && c.file.name).toBe('hi.txt');
    expect('file' in c && c.file.size).toBe(5);
    expect(sel.has(r.id)).toBe(true);
  });

  it('rejects non-base64 upload data', async () => {
    const { api } = harness();
    expect((await err(api.run('upload', { data: 'not!!b64', mime: 'text/plain' }))).code).toBe('bad_field');
  });

  it('exports board meta plus md and json text', async () => {
    const { api } = harness();
    await api.run('create', { type: 'note', props: { text: 'hello world', x: 0, y: 0 } });
    const md = (await api.run('export', { format: 'md' })) as { name: string; mime: string; text: string };
    expect(md.mime).toBe('text/markdown');
    expect(md.name).toBe('home.md');
    expect(md.text).toContain('hello world');
    const json = (await api.run('export', { format: 'json' })) as { text: string };
    const parsed = JSON.parse(json.text);
    expect(parsed.version).toBe(1);
    expect(parsed.board).toBe('home');
    expect((await err(api.run('export', { format: 'zip' }))).code).toBe('export');
    expect((await err(api.run('export', { format: 'gif' }))).code).toBe('bad_field');
  });

  it('imports a board export under the home board', async () => {
    const { doc, host, api } = harness();
    const payload = JSON.stringify({
      version: 1,
      board: 'b1',
      boards: [{ id: 'b1', title: 'Imported', parentId: null, grid: true, createdAt: 0, modifiedAt: 0 }],
      elements: [
        {
          id: 'e1',
          boardId: 'b1',
          type: 'note',
          parentId: null,
          x: 0,
          y: 0,
          z: 1,
          locked: false,
          content: { note: { text: 'imp' } },
          labels: [],
          createdAt: 0,
          modifiedAt: 0,
        },
      ],
      labels: [],
      comments: [],
    });
    const r = (await api.run('import', { data: payload })) as { boardId: ID };
    expect(doc.boards[r.boardId]?.title).toBe('Imported');
    expect(doc.boards[r.boardId]?.parentId).toBe('home');
    expect(host.boardId).toBe(r.boardId);
    expect(Object.values(doc.elements).some((e) => e.boardId === r.boardId && noteText(e) === 'imp')).toBe(true);
    expect((await err(api.run('import', { data: '{}' }))).code).toBe('bad_payload');
  });

  it('unfurl honours the pref and rejects non-link cards', async () => {
    const { api, host } = harness();
    host.prefs.unfurl = false;
    const note = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    expect((await err(api.run('unfurl', { id: note.id }))).code).toBe('bad_field');
    const link = (await api.run('create', { type: 'link', props: { url: 'https://example.com' } })) as { id: ID };
    const res = (await api.run('unfurl', { id: link.id })) as { ok: boolean; reason: string };
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('disabled');
  });
});

describe('agent state, labels, search and duplicate', () => {
  it('reports open board, selection, view and lock state', async () => {
    const { state, api } = harness();
    const r = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    await api.run('select', { ids: [r.id] });
    const s = (await api.run('state')) as {
      boardId: ID | null;
      selection: ID[];
      view: { z: number };
      presenting: boolean;
      locked: boolean;
    };
    expect(s.boardId).toBe('home');
    expect(s.selection).toEqual([r.id]);
    expect(s.view.z).toBe(1);
    expect(s.presenting).toBe(false);
    expect(s.locked).toBe(false);
    state.locked = true;
    expect(((await api.run('state')) as { locked: boolean }).locked).toBe(true);
  });

  it('lists labels and scopes them by board', async () => {
    const { api } = harness();
    await api.run('dispatch', {
      type: 'label.create',
      label: { id: 'lb1', boardId: 'home', name: 'P1', color: '#f00' },
    });
    const all = (await api.run('labels')) as { id: ID; name: string }[];
    expect(all).toEqual([{ id: 'lb1', boardId: 'home', name: 'P1', color: '#f00' }]);
    const scoped = (await api.run('labels', { boardId: 'home' })) as { id: ID }[];
    expect(scoped).toHaveLength(1);
    expect((await err(api.run('labels', { boardId: 'ghost' }))).code).toBe('not_found');
  });

  it('searches one board or all of them', async () => {
    const { doc, api } = harness();
    await api.run('create', { type: 'note', props: { text: 'release checklist' } });
    const hits = (await api.run('search', { query: 'checklist' })) as { elementId?: ID }[];
    expect(hits).toHaveLength(1);
    expect(hits[0]!.elementId).toBeTruthy();
    await api.run('dispatch', {
      type: 'board.create',
      board: { id: 'b2', title: 'Other', parentId: null, grid: true, createdAt: 0, modifiedAt: 0 },
    });
    doc.elements.oth = createNote(doc, 'b2', 0, 0, 'checklist too');
    const allHits = (await api.run('search', { query: 'checklist', all: true })) as { boardId: ID }[];
    expect(allHits.map((h) => h.boardId).sort()).toEqual(['b2', 'home']);
    const scoped = (await api.run('search', { query: 'checklist', boardId: 'b2' })) as unknown[];
    expect(scoped).toHaveLength(1);
    expect((await err(api.run('search', { boardId: 'home' }))).code).toBe('bad_field');
  });

  it('duplicates elements with fresh ids and an offset', async () => {
    const { doc, sel, api } = harness();
    const r = (await api.run('create', { type: 'note', props: { text: 'a', x: 10, y: 10 } })) as { id: ID };
    const d = (await api.run('duplicate', { ids: [r.id], dx: 50, dy: 60 })) as { ids: ID[] };
    const clone = doc.elements[d.ids[0]!]!;
    expect(clone.id).not.toBe(r.id);
    expect(clone.x).toBe(60);
    expect(clone.y).toBe(70);
    expect(noteText(clone)).toBe('a');
    expect(sel.has(clone.id)).toBe(true);
    expect((await err(api.run('duplicate', { ids: ['ghost'] }))).code).toBe('not_found');
  });

  it('rejects partial snapshot regions and bad scales', async () => {
    const { api } = harness();
    const r = (await api.run('snapshot', { x: 0, y: 0, w: 400, h: 300, scale: 1 })) as { dataUrl: string };
    expect(r.dataUrl).toContain('data:image/png');
    expect((await err(api.run('snapshot', { x: 0 }))).code).toBe('bad_field');
    expect((await err(api.run('snapshot', { x: 0, y: 0, w: -5, h: 10 }))).code).toBe('bad_field');
    expect((await err(api.run('snapshot', { x: 0, y: 0, w: 30000, h: 30000, scale: 4 }))).code).toBe('too_large');
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

describe('agent hardening', () => {
  it('rejects unsafe link and embed url schemes on every write path', async () => {
    const { doc, api } = harness();
    expect(
      (await err(api.run('create', { type: 'link', props: { url: 'javascript:alert(1)' } }))).code,
    ).toBe('bad_field');
    expect(
      (await err(api.run('create', { type: 'embed', props: { url: 'file:///etc/passwd' } }))).code,
    ).toBe('bad_field');
    const ok = (await api.run('create', { type: 'link', props: { url: 'mailto:a@b.c' } })) as { id: ID };
    expect(doc.elements[ok.id]).toBeTruthy();
    expect((await err(api.run('patch', { id: ok.id, patch: { url: 'javascript:x' } }))).code).toBe(
      'bad_field',
    );
    expect(
      (
        await err(
          api.run('dispatch', {
            type: 'element.create',
            el: { type: 'link', boardId: 'home', content: { link: { url: 'javascript:x', title: 't', caption: '', showPreview: true } } },
          }),
        )
      ).code,
    ).toBe('bad_field');
  });

  it('rejects create ids that collide with existing records', async () => {
    const { doc, api } = harness();
    const r = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    expect(
      (
        await err(
          api.run('dispatch', {
            type: 'element.create',
            el: { id: r.id, type: 'note', boardId: 'home', content: { note: { text: 'clobber' } } },
          }),
        )
      ).code,
    ).toBe('bad_field');
    expect(noteText(doc.elements[r.id]!)).not.toBe('clobber');
    expect((await err(api.run('dispatch', { type: 'board.create', board: { id: 'home' } }))).code).toBe(
      'bad_field',
    );
    await api.run('dispatch', { type: 'label.create', label: { id: 'lb1', boardId: 'home', name: 'a', color: '#fff' } });
    expect(
      (
        await err(
          api.run('dispatch', {
            type: 'label.create',
            label: { id: 'lb1', boardId: 'home', name: 'b', color: '#fff' },
          }),
        )
      ).code,
    ).toBe('bad_field');
  });

  it('rejects malformed and mismatched dispatch content', async () => {
    const { api } = harness();
    const malformed = await err(
      api.run('dispatch', {
        type: 'element.create',
        el: { type: 'note', boardId: 'home', content: { note: { text: 5 } } },
      }),
    );
    expect(malformed.code).toBe('bad_field');
    const mismatched = await err(
      api.run('dispatch', {
        type: 'element.create',
        el: { type: 'note', boardId: 'home', content: { todo: { title: '', showTitle: false, items: [] } } },
      }),
    );
    expect(mismatched.code).toBe('bad_field');
    const twoKeys = await err(
      api.run('dispatch', {
        type: 'element.create',
        el: { type: 'note', boardId: 'home', content: { note: { text: 'a' }, swatch: { color: '#fff', caption: '', showValue: true } } },
      }),
    );
    expect(twoKeys.code).toBe('bad_field');
    const r = (await api.run('create', { type: 'note', props: { text: 'x' } })) as { id: ID };
    expect(
      (await err(api.run('dispatch', { type: 'element.patch', id: r.id, patch: { content: { table: { cells: 'x' } } } })))
        .code,
    ).toBe('bad_field');
  });

  it('rejects cross-board column parents', async () => {
    const { doc, api } = harness();
    await api.run('dispatch', { type: 'board.create', board: { id: 'b2', title: 'B', parentId: null } });
    const col = (await api.run('create', { type: 'column', props: {} })) as { id: ID };
    expect(doc.elements[col.id]!.boardId).toBe('home');
    expect(
      (await err(api.run('create', { type: 'note', props: { boardId: 'b2', parentId: col.id } }))).code,
    ).toBe('bad_field');
    const n = (await api.run('create', { type: 'note', props: { boardId: 'b2' } })) as { id: ID };
    expect((await err(api.run('patch', { id: n.id, patch: { parentId: col.id } }))).code).toBe('bad_field');
  });

  it('limits anchorId patches to comment elements', async () => {
    const { api } = harness();
    const a = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    const n = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    expect((await err(api.run('patch', { id: n.id, patch: { anchorId: a.id } }))).code).toBe('bad_field');
    const c = (await api.run('create', { type: 'comment', props: {} })) as { id: ID };
    await api.run('patch', { id: c.id, patch: { anchorId: a.id } });
  });

  it('gates mutating ?do= links behind a confirmation', async () => {
    const { doc, host, api } = harness();
    const raw = b64({ commands: [{ method: 'create', params: { type: 'note', props: { text: 'gated' } } }] });
    await runCommandUrl(host, api, raw);
    expect(Object.keys(doc.elements)).toHaveLength(0);
    const act = document.querySelector<HTMLButtonElement>('.toast-act');
    expect(act).toBeTruthy();
    act!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.values(doc.elements).some((e) => noteText(e) === 'gated')).toBe(true);
    expect(document.querySelector('.toast-act')).toBeNull();
  });

  it('runs read-only ?do= lists without asking', async () => {
    const { sel, host, api } = harness();
    const r = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    await runCommandUrl(host, api, b64({ commands: [{ method: 'select', params: { ids: [r.id] } }] }));
    expect(sel.has(r.id)).toBe(true);
    expect(document.querySelector('.toast-act')).toBeNull();
  });

  it('drops malformed elements and clears bad urls on import', async () => {
    const { doc, api } = harness();
    const payload = JSON.stringify({
      version: 1,
      board: 'b1',
      boards: [{ id: 'b1', title: 'Imported', parentId: null, grid: true, createdAt: 0, modifiedAt: 0 }],
      elements: [
        {
          id: 'e1',
          boardId: 'b1',
          type: 'note',
          parentId: null,
          x: 0,
          y: 0,
          z: 1,
          locked: false,
          content: { note: { text: 42 } },
          labels: [],
          createdAt: 0,
          modifiedAt: 0,
        },
        {
          id: 'e2',
          boardId: 'b1',
          type: 'link',
          parentId: null,
          x: 0,
          y: 0,
          z: 2,
          locked: false,
          content: { link: { url: 'javascript:alert(1)', title: 'x', caption: '', showPreview: true } },
          labels: [],
          createdAt: 0,
          modifiedAt: 0,
        },
      ],
      labels: [],
      comments: [],
    });
    await api.run('import', { data: payload });
    const els = Object.values(doc.elements);
    expect(els.some((e) => e.content && 'note' in e.content)).toBe(false);
    const link = els.find((e) => 'link' in e.content);
    expect(link).toBeTruthy();
    const lc = link!.content;
    expect('link' in lc && lc.link.url).toBe('');
  });
});
