// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createColumn,
  createComment,
  createNote,
  createSwatch,
  createTable,
  emptyDoc,
  type Doc,
} from '../src/state/schema';
import { CardsLayer } from '../src/cards/layer';
import { ColumnCard } from '../src/cards/column';
import { Viewport } from '../src/canvas/viewport';
import type { CardEvents } from '../src/cards/note';

function doc(): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  return d;
}

const events: CardEvents = {
  onTextInput: () => {},
  onContent: () => {},
  onMeasure: () => {},
  onResizeHandle: () => {},
  onEditEnd: () => {},
  onLinkPopup: () => {},
  onEditField: () => {},
  onCellFocus: () => {},
};

function harness(d: Doc) {
  let rev = 0;
  const vp = new Viewport();
  vp.vw = 800;
  vp.vh = 600;
  const layer = new CardsLayer(d, vp, events, () => rev);
  layer.boardId = 'home';
  document.body.appendChild(layer.node);
  return { layer, vp, bump: () => ++rev };
}

describe('CardsLayer culling', () => {
  it('survives a parentId cycle in a corrupt doc', () => {
    const d = doc();
    const a = createColumn(d, 'home', 0, 0);
    const b = createColumn(d, 'home', 300, 0);
    a.parentId = b.id;
    b.parentId = a.id;
    d.elements[a.id] = a;
    d.elements[b.id] = b;
    const { layer, bump } = harness(d);
    bump();
    // rectOf/heightOf must not recurse forever; sync's editing-ancestor
    // walk terminates on the seen set.
    const ra = layer.rectOf(a);
    expect(Number.isFinite(ra.x + ra.y + ra.w + ra.h)).toBe(true);
    expect(Number.isFinite(layer.heightOf(a))).toBe(true);
    layer.sync(new Set([a.id]), a.id, false);
  });

  it('mounts only cards inside the padded view', () => {
    const d = doc();
    const near = createNote(d, 'home', 100, 100, 'near');
    const far = createNote(d, 'home', 50000, 50000, 'far');
    d.elements[near.id] = near;
    d.elements[far.id] = far;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    expect(layer.view(near.id)).toBeTruthy();
    expect(layer.view(far.id)).toBeUndefined();
    expect(layer.node.querySelectorAll('.card').length).toBe(1);
  });

  it('skips lines, annotations and anchored comments entirely', () => {
    const d = doc();
    const anchor = createNote(d, 'home', 0, 0);
    const pin = createComment(d, 'home', 0, 0, anchor.id);
    const free = createComment(d, 'home', 30, 30);
    free.parentId = null;
    d.elements[anchor.id] = anchor;
    d.elements[pin.id] = pin;
    d.elements[free.id] = free;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    expect(layer.view(pin.id)).toBeUndefined();
    expect(layer.view(free.id)).toBeTruthy();
  });

  it('mounts a culled card once it pans back in', () => {
    const d = doc();
    const far = createNote(d, 'home', 50000, 50000, 'far');
    d.elements[far.id] = far;
    const { layer, vp, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    expect(layer.view(far.id)).toBeUndefined();
    vp.x = -50000;
    vp.y = -50000;
    layer.sync(new Set(), null, false);
    expect(layer.view(far.id)).toBeTruthy();
  });
});

describe('CardsLayer dirty gating', () => {
  it('skips update() for untouched elements and honours the dirty set', () => {
    const d = doc();
    const a = createNote(d, 'home', 0, 0, 'aaa');
    const b = createNote(d, 'home', 300, 0, 'bbb');
    d.elements[a.id] = a;
    d.elements[b.id] = b;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);

    // Mutate the doc without flagging it dirty: the DOM keeps the
    // stale text, proving no update() ran.
    a.content = { note: { text: 'changed' } };
    bump();
    layer.sync(new Set(), null, false, new Set());
    expect(layer.view(a.id)!.node.querySelector('.note-text')!.textContent).toBe('aaa');
    layer.sync(new Set(), null, false, new Set([a.id]));
    expect(layer.view(a.id)!.node.querySelector('.note-text')!.textContent).toBe('changed');
  });

  it('updates a column when only a member element is dirty', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'col');
    const member = createNote(d, 'home', 0, 0, 'inside');
    member.parentId = col.id;
    d.elements[col.id] = col;
    d.elements[member.id] = member;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);

    member.content = { note: { text: 'edited member' } };
    bump();
    layer.sync(new Set(), null, false, new Set([member.id]));
    expect(layer.view(member.id)!.node.querySelector('.note-text')!.textContent).toBe('edited member');
  });

  it('re-mounts members when the member set changes', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'col');
    const member = createNote(d, 'home', 0, 0, 'm');
    member.parentId = col.id;
    d.elements[col.id] = col;
    d.elements[member.id] = member;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    expect(layer.view(member.id)).toBeTruthy();

    // Unfiling: parentId flips to null, the card leaves the column and
    // becomes a top-level view.
    member.parentId = null;
    bump();
    layer.sync(new Set(), null, false, new Set([member.id]));
    expect(layer.view(member.id)).toBeTruthy();
    expect(layer.view(member.id)!.node.parentElement).toBe(layer.node);
  });
});

describe('column members', () => {
  it('clears inline geometry and gives members the column inner width', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'col');
    col.w = 300;
    const member = createNote(d, 'home', 9000, 9000, 'm');
    member.w = 700;
    member.parentId = col.id;
    d.elements[col.id] = col;
    d.elements[member.id] = member;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    const node = layer.view(member.id)!.node;
    expect(node.style.left).toBe('');
    expect(node.style.top).toBe('');
    expect(node.style.width).toBe('');
    // rectOf derives member geometry from the column, ignoring stale
    // pre-filing x/y/w.
    const r = layer.rectOf(member);
    expect(r.x).toBe(10);
    expect(r.w).toBe(280);
  });

  it('scales table column widths to the member width', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'col');
    col.w = 300;
    const tb = createTable(d, 'home', 0, 0);
    tb.parentId = col.id;
    tb.content = {
      table: {
        title: '',
        caption: '',
        cells: [
          [{ text: 'a' }, { text: 'b' }],
          [{ text: 'c' }, { text: 'd' }],
        ],
        widths: [600, 600],
      },
    };
    d.elements[col.id] = col;
    d.elements[tb.id] = tb;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    const grid = layer.view(tb.id)!.node.querySelector('.tb-grid') as HTMLElement;
    // member width = 300 - 20 col pad; grid space = that - 20 table pad.
    expect(grid.style.gridTemplateColumns).toBe('130px 130px');
  });
});

describe('column insert marker', () => {
  it('seats the marker before the target member and hides it', () => {
    const d = doc();
    const col = createColumn(d, 'home', 0, 0, 'col');
    const m1 = createNote(d, 'home', 0, 0, 'one');
    const m2 = createNote(d, 'home', 0, 0, 'two');
    m1.parentId = col.id;
    m2.parentId = col.id;
    m2.z = m1.z + 1;
    d.elements[col.id] = col;
    d.elements[m1.id] = m1;
    d.elements[m2.id] = m2;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    const view = layer.view(col.id)!;
    expect(view).toBeInstanceOf(ColumnCard);
    const colView = view as ColumnCard;
    colView.showInsert(m2.id);
    const body = view.node.querySelector('.col-body')!;
    const marker = body.querySelector('.col-insert')!;
    expect(marker).toBeTruthy();
    expect(marker.nextElementSibling).toBe(layer.view(m2.id)!.node);
    colView.showInsert(null);
    expect(body.querySelector('.col-insert')!.nextElementSibling).toBeNull();
    colView.hideInsert();
    expect(body.querySelector('.col-insert')).toBeNull();
  });
});

describe('CardsLayer ordering', () => {
  it('seats card nodes in el.z order', () => {
    const d = doc();
    const a = createNote(d, 'home', 0, 0, 'a');
    const b = createNote(d, 'home', 300, 0, 'b');
    a.z = 2;
    b.z = 1;
    d.elements[a.id] = a;
    d.elements[b.id] = b;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    const cards = [...layer.node.querySelectorAll('.card')].map((n) => (n as HTMLElement).dataset.id);
    expect(cards).toEqual([b.id, a.id]);
  });
});

describe('card resize handles', () => {
  it('mounts a .resize-handle on resizable card types', () => {
    const d = doc();
    const sw = createSwatch(d, 'home', 0, 0);
    d.elements[sw.id] = sw;
    const { layer, bump } = harness(d);
    bump();
    layer.sync(new Set(), null, false);
    expect(layer.view(sw.id)?.node.querySelector('.resize-handle')).toBeTruthy();
  });
});
