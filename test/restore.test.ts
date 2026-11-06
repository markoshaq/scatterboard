import { describe, expect, it } from 'vitest';
import { Store } from '../src/state/store';
import {
  createBoard,
  createColumn,
  createLabel,
  createLink,
  createNote,
  emptyDoc,
  linkDoc,
  noteText,
} from '../src/state/schema';
import { restoreSnapshotBoardActions, restoreSnapshotCardActions } from '../src/ui/snapbrowse';

describe('granular restore from snapshots', () => {
  it('restores a board subtree from a snapshot into the live doc with remapped ids and scrubbed urls', () => {
    const live = emptyDoc();
    const home = createBoard({ id: 'home', title: 'Home' });
    live.boards[home.id] = home;
    const store = new Store(live);

    const snap = emptyDoc();
    const sb = createBoard({ id: 'sb1', title: 'Old Project' });
    snap.boards[sb.id] = sb;
    const lbl = createLabel(sb.id, 'Urgent', '#d6508f');
    snap.labels[lbl.id] = lbl;

    const note = createNote(snap, sb.id, 100, 120, 'Recovered note');
    note.labels = [lbl.id];
    snap.elements[note.id] = note;

    const badLink = createLink(snap, sb.id, 200, 120, 'javascript:alert(1)');
    snap.elements[badLink.id] = badLink;

    const res = restoreSnapshotBoardActions(store.doc, snap, sb.id, home.id);
    expect(res).not.toBeNull();
    store.dispatch({ type: 'batch', actions: res!.actions });

    expect(res!.boardId).not.toBe(sb.id);
    const restoredBoard = store.doc.boards[res!.boardId];
    expect(restoredBoard?.title).toBe('Old Project');
    expect(restoredBoard?.parentId).toBe(home.id);

    const hostCards = Object.values(store.doc.elements).filter(
      (e) => e.boardId === home.id && 'boardRef' in e.content && e.content.boardRef === res!.boardId,
    );
    expect(hostCards).toHaveLength(1);

    const boardEls = Object.values(store.doc.elements).filter((e) => e.boardId === res!.boardId);
    expect(boardEls).toHaveLength(2);
    const rNote = boardEls.find((e) => e.type === 'note')!;
    expect(rNote.id).not.toBe(note.id);
    expect(noteText(rNote)).toBe('Recovered note');
    expect(rNote.labels).toHaveLength(1);
    expect(rNote.labels[0]).not.toBe(lbl.id);
    expect(store.doc.labels[rNote.labels[0]!]?.name).toBe('Urgent');

    const rLink = boardEls.find((e) => e.type === 'link')!;
    expect(linkDoc(rLink)?.url).toBe('');

    // Single undo reverts the entire board restore.
    store.undo();
    expect(store.doc.boards[res!.boardId]).toBeUndefined();
  });

  it('restores a single card from a snapshot onto the current board with fresh id and no stale refs', () => {
    const live = emptyDoc();
    const home = createBoard({ id: 'home', title: 'Home' });
    live.boards[home.id] = home;
    const existing = createNote(live, home.id, 100, 150, 'Existing');
    live.elements[existing.id] = existing;
    const store = new Store(live);

    const snap = emptyDoc();
    const col = createColumn(snap, 'other', 40, 40, 'Col');
    const card = createNote(snap, 'other', 40, 80, 'From snapshot');
    card.parentId = col.id;
    card.anchorId = 'dead-anchor';
    card.syncGroup = 'old-sync';
    card.labels = ['foreign-label'];

    const res = restoreSnapshotCardActions(store.doc, card, home.id);
    expect(res).not.toBeNull();
    store.dispatch({ type: 'batch', actions: res!.actions });

    const restored = store.doc.elements[res!.id]!;
    expect(restored).toBeDefined();
    expect(restored.id).not.toBe(card.id);
    expect(restored.boardId).toBe(home.id);
    expect(restored.parentId).toBeNull();
    expect(restored.anchorId).toBeUndefined();
    expect(restored.syncGroup).toBeUndefined();
    expect(restored.labels).toEqual([]);
    expect(noteText(restored)).toBe('From snapshot');
    expect(restored.y).toBeGreaterThan(existing.y);
  });
});
