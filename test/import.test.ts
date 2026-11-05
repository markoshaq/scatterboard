// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { importActions, parseBoardExport } from '../src/export/boardio';
import { createBoard, createNote, emptyDoc, migrateDoc, type Doc } from '../src/state/schema';

function doc(): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  return d;
}

describe('parseBoardExport validation', () => {
  it('rejects garbage and wrong shapes', () => {
    expect(parseBoardExport('')).toBeNull();
    expect(parseBoardExport('not json')).toBeNull();
    expect(parseBoardExport('{}')).toBeNull();
    expect(parseBoardExport('{"version":2,"board":"x","boards":[],"elements":[]}')).toBeNull();
    expect(parseBoardExport('{"version":1,"board":"x","boards":[],"elements":[]}')).toBeNull();
    expect(parseBoardExport('{"version":1,"board":"x","boards":[{}],"elements":[]}')).toBeNull();
    expect(parseBoardExport('{"version":1,"board":"x","boards":[{"id":"b"}],"elements":[{"id":"e"}]}')).toBeNull();
  });
});

describe('importActions on hostile input', () => {
  const base = () => ({
    version: 1 as const,
    board: 'b1',
    boards: [{ id: 'b1', title: 'T', parentId: null, createdAt: 0, modifiedAt: 0, position: { x: 0, y: 0, z: 1 } }],
    elements: [] as unknown[],
    labels: [],
    comments: [],
  });

  it('scrubs scriptable html out of imported notes', () => {
    const d = doc();
    const data = base();
    data.elements = [
      {
        id: 'e1', type: 'note', boardId: 'b1', parentId: null, anchorId: undefined,
        x: 0, y: 0, z: 1, labels: [], reactions: [], locked: false, createdAt: 0, modifiedAt: 0,
        content: { note: { text: 'safe', html: '<p onclick="x()">safe</p><script>alert(1)</script>' } },
      },
    ];
    const res = importActions(d, data as never, 'home');
    expect(res).toBeTruthy();
    const el = res!.actions.find((a) => a.type === 'element.create' && 'note' in a.el.content);
    expect(el).toBeTruthy();
    const html = el!.type === 'element.create' && 'note' in el!.el.content ? el!.el.content.note.html : '';
    expect(html).toBe('<p>safe</p>');
    expect(html).not.toContain('script');
  });

  it('drops board cards that point outside the export', () => {
    const d = doc();
    const data = base();
    data.elements = [
      {
        id: 'e1', type: 'board', boardId: 'b1', parentId: null,
        x: 0, y: 0, z: 1, labels: [], reactions: [], locked: false, createdAt: 0, modifiedAt: 0,
        content: { boardRef: 'nowhere' },
      },
    ];
    const res = importActions(d, data as never, 'home');
    const refCards = res!.actions.filter((a) => a.type === 'element.create' && 'boardRef' in a.el.content);
    expect(refCards).toHaveLength(1);
    expect(refCards[0]!.type === 'element.create' && 'boardRef' in refCards[0]!.el.content && refCards[0]!.el.content.boardRef).toBe(res!.boardId);
  });

  it('remaps colliding ids so imports never clobber existing cards', () => {
    const d = doc();
    const existing = createNote(d, 'home', 0, 0, 'mine');
    d.elements[existing.id] = existing;
    const data = base();
    data.elements = [
      {
        id: existing.id, type: 'note', boardId: 'b1', parentId: null,
        x: 0, y: 0, z: 1, labels: [], reactions: [], locked: false, createdAt: 0, modifiedAt: 0,
        content: { note: { text: 'foreign' } },
      },
    ];
    const res = importActions(d, data as never, 'home');
    const created = res!.actions.find((a) => a.type === 'element.create' && 'note' in a.el.content);
    expect(created).toBeTruthy();
    expect(created!.type === 'element.create' && created!.el.id).not.toBe(existing.id);
  });
});

describe('migrateDoc edge cases', () => {
  it('survives a doc with missing collections and no boards', () => {
    const m = migrateDoc({} as Doc);
    expect(m.elements).toEqual({});
    expect(m.boards).toEqual({});
    expect(m.seq).toBe(0);
  });

  it('defaults fields added after v1 without dropping content', () => {
    const d = doc();
    const el = createNote(d, 'home', 1, 2, 'x');
    // Simulate a pre-reactions/pre-locked record.
    const raw = { ...el, labels: undefined, reactions: undefined } as unknown as typeof el;
    delete (raw as { labels?: string[] }).labels;
    delete (raw as { reactions?: string[] }).reactions;
    const m = migrateDoc({ ...emptyDoc(), boards: d.boards, elements: { [el.id]: raw } } as Doc);
    expect(m.elements[el.id]?.labels).toEqual([]);
    expect(m.seq).toBeGreaterThanOrEqual(el.z);
  });
});
