// @vitest-environment happy-dom
// Audit repros: each test exercises a defect found in the deep pass.
// They now assert the fixed behaviour.
import { describe, expect, it } from 'vitest';
import type { Action } from '../src/state/actions';
import { Store } from '../src/state/store';
import {
  createBoard,
  createColumn,
  createComment,
  createNote,
  emptyDoc,
  type Element,
  type ID,
} from '../src/state/schema';
import { Viewport } from '../src/canvas/viewport';
import { createAgentApi, type AgentHost } from '../src/agent/api';
import { AgentError } from '../src/agent/validate';
import { RailTools } from '../src/app/tools';
import type { App } from '../src/app';

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
    panels: { deleteBoardCascade: () => {} },
    applyPrefs: () => {},
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
  return { doc, store, sel, state, host, api: createAgentApi(host) };
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

describe('runPlanned abort', () => {
  it('a leaf-free group abort leaves the user\'s previous action alone', async () => {
    const { doc, store, api } = harness();
    // User's real prior action.
    const note = createNote(doc, 'home', 0, 0, 'keep me');
    store.dispatch({ type: 'element.create', el: note });
    expect(doc.elements[note.id]).toBeTruthy();

    // Batch: an empty-batch dispatch (counts as a dispatch, produces no
    // history leaves), then a command that fails at RUN time.
    await expect(
      api.runCommands([
        { method: 'dispatch', params: { type: 'batch', actions: [] } },
        { method: 'unfurl', params: { id: note.id } },
      ]),
    ).rejects.toBeInstanceOf(AgentError);

    // The abort must not undo the user's unrelated note-create.
    expect(doc.elements[note.id]).toBeTruthy();
    expect(store.canUndo).toBe(true);
  });

  it('a landed batch abort still rolls back its own dispatches', async () => {
    const { doc, store, api } = harness();
    const keep = createNote(doc, 'home', 0, 0, 'x');
    store.dispatch({ type: 'element.create', el: keep });
    // unfurl fails at RUN time (a note is not a link card), after the
    // batch's first dispatch already landed.
    await expect(
      api.runCommands([
        { method: 'create', params: { type: 'note', props: { text: 'a' } } },
        { method: 'unfurl', params: { id: keep.id } },
      ]),
    ).rejects.toBeInstanceOf(AgentError);
    expect(Object.keys(doc.elements)).toEqual([keep.id]);
    expect(store.canUndo).toBe(true); // only the user's create remains
    expect(store.canRedo).toBe(false); // the partial batch must not replay
  });

  it('refuses to join a store group it did not open', async () => {
    const { doc, store, api } = harness();
    store.beginGroup(); // stands in for a user gesture group
    expect((await err(api.run('create', { type: 'note', props: {} }))).code).toBe('busy');
    expect((await err(api.runCommands([{ method: 'create', params: { type: 'note', props: {} } }]))).code).toBe(
      'busy',
    );
    expect(Object.keys(doc.elements)).toHaveLength(0);
    store.endGroup();
    await api.run('create', { type: 'note', props: {} });
    expect(Object.keys(doc.elements)).toHaveLength(1);
  });

  it('a nested batch still joins the outer undo entry', async () => {
    const { doc, store, api } = harness();
    await api.run('batch', {
      commands: [
        { method: 'create', params: { type: 'note', props: { text: 'a' } } },
        {
          method: 'batch',
          params: { commands: [{ method: 'create', params: { type: 'note', props: { text: 'b' } } }] },
        },
      ],
    });
    expect(Object.keys(doc.elements)).toHaveLength(2);
    store.undo();
    expect(Object.keys(doc.elements)).toHaveLength(0);
  });
});

describe('agent patch boardId', () => {
  it('moving a column member across boards drops it to the canvas', async () => {
    const { doc, api } = harness();
    doc.boards.b2 = createBoard({ id: 'b2', title: 'B2' });
    const col = createColumn(doc, 'home', 0, 0, 'col');
    const member = createNote(doc, 'home', 0, 0, 'm');
    member.parentId = col.id;
    doc.elements[col.id] = col;
    doc.elements[member.id] = member;

    await api.run('patch', { id: member.id, boardId: 'b2' });

    const el = doc.elements[member.id]!;
    expect(el.boardId).toBe('b2');
    // The column stays on 'home': the member lands on the canvas.
    expect(el.parentId).toBeNull();
  });

  it('a dispatch boardId patch clears labels, syncGroup and stale anchors', async () => {
    const { doc, api } = harness();
    doc.boards.b2 = createBoard({ id: 'b2', title: 'B2' });
    doc.labels.lb1 = { id: 'lb1', boardId: 'home', name: 'L', color: '#f00' };
    const col = createColumn(doc, 'home', 0, 0, 'col');
    const member = createNote(doc, 'home', 0, 0, 'm');
    member.parentId = col.id;
    member.labels = ['lb1'];
    member.syncGroup = 'sg1';
    const host = createNote(doc, 'home', 0, 0, 'host');
    const cmt = createComment(doc, 'home', 0, 0, host.id);
    doc.elements[col.id] = col;
    doc.elements[member.id] = member;
    doc.elements[host.id] = host;
    doc.elements[cmt.id] = cmt;

    await api.run('dispatch', { type: 'element.patch', id: member.id, patch: { boardId: 'b2' } });
    const el = doc.elements[member.id]!;
    expect(el.boardId).toBe('b2');
    expect(el.parentId).toBeNull();
    expect(el.labels).toEqual([]);
    expect(el.syncGroup).toBeUndefined();

    // A comment moving off its anchor's board loses the anchor.
    await api.run('dispatch', { type: 'element.patch', id: cmt.id, patch: { boardId: 'b2' } });
    expect(doc.elements[cmt.id]!.anchorId).toBeUndefined();

    // An explicit same-board parent survives the move.
    const col2 = createColumn(doc, 'b2', 0, 0, 'c2');
    doc.elements[col2.id] = col2;
    const other = createNote(doc, 'home', 0, 0, 'o');
    doc.elements[other.id] = other;
    await api.run('dispatch', {
      type: 'element.patch',
      id: other.id,
      patch: { boardId: 'b2', parentId: col2.id },
    });
    expect(doc.elements[other.id]!.parentId).toBe(col2.id);
  });
});

describe('agent dispatch raw actions', () => {
  it('board.delete is rejected in favour of the cascade path', async () => {
    const { doc, api } = harness();
    const note = createNote(doc, 'home', 0, 0, 'keep');
    doc.elements[note.id] = note;

    expect((await err(api.run('dispatch', { type: 'board.delete', board: { id: 'home' } }))).code).toBe(
      'forbidden',
    );
    expect(doc.boards.home).toBeTruthy();
    expect(doc.elements[note.id]).toBeTruthy();
  });

  it('element.delete is rejected in favour of the trash path', async () => {
    const { doc, api } = harness();
    const card = createNote(doc, 'home', 0, 0, 'anchor');
    const cmt = createComment(doc, 'home', 0, 0, card.id);
    doc.elements[card.id] = card;
    doc.elements[cmt.id] = cmt;

    expect((await err(api.run('dispatch', { type: 'element.delete', el: { id: card.id } }))).code).toBe(
      'forbidden',
    );
    expect(doc.elements[card.id]).toBeTruthy();
    expect(doc.elements[cmt.id]!.anchorId).toBe(card.id);
  });

  it('rejects a batch that creates the same id twice', async () => {
    const { doc, api } = harness();
    const e = await err(
      api.run('dispatch', {
        type: 'batch',
        actions: [
          {
            type: 'element.create',
            el: { id: 'dup', type: 'note', boardId: 'home', content: { note: { text: 'a' } } },
          },
          {
            type: 'element.create',
            el: { id: 'dup', type: 'note', boardId: 'home', content: { note: { text: 'b' } } },
          },
        ],
      }),
    );
    expect(e.code).toBe('bad_field');
    expect(doc.elements.dup).toBeUndefined();
  });
});

describe('convertColumn', () => {
  it('clears board-scoped refs on members moved to the child board', () => {
    const doc = emptyDoc();
    doc.boards.home = createBoard({ id: 'home', title: 'Home' });
    doc.labels.lb1 = { id: 'lb1', boardId: 'home', name: 'L', color: '#f00' };
    const store = new Store(doc);
    const col = createColumn(doc, 'home', 0, 0, 'col');
    const member = createNote(doc, 'home', 0, 0, 'm');
    member.parentId = col.id;
    member.labels = ['lb1'];
    member.syncGroup = 'sg1';
    const host = createNote(doc, 'home', 0, 0, 'host');
    // A comment member anchored to a card that is not moving.
    const orphan = createComment(doc, 'home', 0, 0, host.id);
    orphan.parentId = col.id;
    // A comment pinned to the moving member keeps its anchor.
    const pin = createComment(doc, 'home', 0, 0, member.id);
    doc.elements[col.id] = col;
    doc.elements[member.id] = member;
    doc.elements[host.id] = host;
    doc.elements[orphan.id] = orphan;
    doc.elements[pin.id] = pin;

    const memberMap: Record<ID, Element[]> = { [col.id]: [member, orphan] };
    const app = {
      boardId: 'home',
      doc,
      store,
      sel: new Set<ID>(),
      layer: { members: (id: ID) => memberMap[id] ?? [] },
      retargetAttachActions: () => [],
      detachLineActions: () => [],
      requestRender: () => {},
    };
    new RailTools(app as unknown as App).convertColumn(col);

    const child = Object.values(doc.boards).find((b) => b.id !== 'home')!;
    expect(doc.elements[member.id]!.boardId).toBe(child.id);
    expect(doc.elements[member.id]!.parentId).toBeNull();
    expect(doc.elements[member.id]!.labels).toEqual([]);
    expect(doc.elements[member.id]!.syncGroup).toBeUndefined();
    expect(doc.elements[orphan.id]!.boardId).toBe(child.id);
    expect(doc.elements[orphan.id]!.anchorId).toBeUndefined();
    expect(doc.elements[pin.id]!.boardId).toBe(child.id);
    expect(doc.elements[pin.id]!.anchorId).toBe(member.id);
  });
});

describe('agent anchor and line-end validation', () => {
  it('rejects cross-board and non-card comment anchors', async () => {
    const { api } = harness();
    await api.run('dispatch', { type: 'board.create', board: { id: 'b2', title: 'B' } });
    const other = (await api.run('create', { type: 'note', props: { boardId: 'b2' } })) as { id: ID };
    const line = (await api.run('create', {
      type: 'line',
      props: { from: { x: 0, y: 0 }, to: { x: 50, y: 50 } },
    })) as { id: ID };
    const c = (await api.run('create', { type: 'comment', props: {} })) as { id: ID };
    expect((await err(api.run('patch', { id: c.id, patch: { anchorId: other.id } }))).code).toBe('bad_field');
    expect((await err(api.run('patch', { id: c.id, patch: { anchorId: line.id } }))).code).toBe('bad_field');
    expect((await err(api.run('create', { type: 'comment', props: { anchor: line.id } }))).code).toBe(
      'bad_field',
    );
  });

  it('rejects line ends on other boards, non-cards and self-connect', async () => {
    const { api } = harness();
    await api.run('dispatch', { type: 'board.create', board: { id: 'b2', title: 'B' } });
    const other = (await api.run('create', { type: 'note', props: { boardId: 'b2' } })) as { id: ID };
    const c = (await api.run('create', { type: 'comment', props: {} })) as { id: ID };
    const n = (await api.run('create', { type: 'note', props: {} })) as { id: ID };
    expect(
      (
        await err(
          api.run('create', { type: 'line', props: { from: { x: 0, y: 0, el: other.id }, to: { x: 5, y: 5 } } }),
        )
      ).code,
    ).toBe('bad_field');
    expect(
      (
        await err(
          api.run('create', { type: 'line', props: { from: { x: 0, y: 0, el: c.id }, to: { x: 5, y: 5 } } }),
        )
      ).code,
    ).toBe('bad_field');
    expect((await err(api.run('connect', { from: n.id, to: n.id }))).code).toBe('bad_field');
  });
});
