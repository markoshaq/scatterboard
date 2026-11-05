import type { Action } from './actions';
import { remapElements } from './clone';
import {
  createBoard,
  createBoardCard,
  uid,
  UNSORTED,
  type Board,
  type Doc,
  type Element,
  type ElementType,
  type ID,
  type Label,
  type Template,
  type TypeContent,
} from './schema';

// Built-in preset templates: original seed layouts offered in the
// new-board picker. Elements carry placeholder ids/boardId; the remap
// in instantiateActions hands out fresh ones.
function el(id: string, type: ElementType, x: number, y: number, w: number | undefined, content: TypeContent): Element {
  return {
    id,
    boardId: '',
    type,
    parentId: null,
    x,
    y,
    ...(w !== undefined ? { w } : {}),
    z: 0,
    locked: false,
    content,
    labels: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function tpl(id: string, name: string, elements: Element[], board: Partial<Board> = {}): Template {
  return {
    id,
    name,
    board: { id: '', title: name, parentId: null, grid: true, createdAt: 0, modifiedAt: 0, ...board },
    elements,
    labels: [],
    createdAt: 0,
  };
}

export function builtinTemplates(): Template[] {
  const sprint = tpl('builtin:sprint', 'Sprint plan', [
    el('s-h', 'heading', 0, 0, 340, { heading: { text: 'Sprint plan', level: 1 } }),
    el('s-c1', 'column', 0, 80, 260, { column: { title: 'To do' } }),
    el('s-c2', 'column', 320, 80, 260, { column: { title: 'Doing' } }),
    el('s-c3', 'column', 640, 80, 260, { column: { title: 'Done' } }),
    el('s-n1', 'note', 0, 0, undefined, { note: { text: 'Write the first task' } }),
    el('s-t', 'todo', 0, 380, 240, {
      todo: {
        title: 'Sprint goals',
        showTitle: true,
        items: [
          { id: 's-t1', text: 'Pick the goal', done: false },
          { id: 's-t2', text: 'Cut what does not fit', done: false },
          { id: 's-t3', text: 'Demo on Friday', done: false },
        ],
      },
    }),
  ]);
  sprint.elements[3]!.parentId = 's-c1';

  const mood = tpl('builtin:mood', 'Moodboard', [
    el('m-h', 'heading', 0, 0, 300, { heading: { text: 'Moodboard', level: 1 } }),
    el('m-s1', 'swatch', 0, 80, 200, { swatch: { color: '#e8734a', caption: 'Warm accent', showValue: true } }),
    el('m-s2', 'swatch', 240, 80, 200, { swatch: { color: '#3d84e0', caption: 'Cool accent', showValue: true } }),
    el('m-s3', 'swatch', 480, 80, 200, { swatch: { color: '#5f9e5f', caption: 'Ground tone', showValue: true } }),
    el('m-n1', 'note', 0, 300, 240, { note: { text: 'Drop reference images here' } }),
    el('m-n2', 'note', 280, 320, 240, { note: { text: 'What should it feel like?' } }),
    el('m-sk', 'sketch', 560, 300, 280, { sketch: { strokes: [] } }),
  ]);

  const research = tpl('builtin:research', 'Research', [
    el('r-h', 'heading', 0, 0, 300, { heading: { text: 'Research', level: 1 } }),
    el('r-d', 'document', 0, 80, 280, {
      document: { title: 'Notes', text: 'Findings go here.', displayMode: 'detail', caption: '' },
    }),
    el('r-c', 'column', 340, 80, 260, { column: { title: 'Questions' } }),
    el('r-q1', 'note', 0, 0, undefined, { note: { text: 'What are we trying to learn?' } }),
    el('r-q2', 'note', 0, 0, undefined, { note: { text: 'What would change our mind?' } }),
    el('r-n', 'note', 660, 80, 240, { note: { text: 'Paste links and sources as you find them' } }),
  ]);
  research.elements[3]!.parentId = 'r-c';
  research.elements[4]!.parentId = 'r-c';

  const week = tpl('builtin:week', 'Week planner', [
    el('w-h', 'heading', 0, 0, 300, { heading: { text: 'This week', level: 1 } }),
    el('w-m', 'column', 0, 80, 220, { column: { title: 'Mon' } }),
    el('w-t', 'column', 260, 80, 220, { column: { title: 'Tue' } }),
    el('w-w', 'column', 520, 80, 220, { column: { title: 'Wed' } }),
    el('w-th', 'column', 780, 80, 220, { column: { title: 'Thu' } }),
    el('w-f', 'column', 1040, 80, 220, { column: { title: 'Fri' } }),
    el('w-n', 'note', 0, 400, 240, { note: { text: 'Anything else on your mind' } }),
  ]);

  return [sprint, mood, research, week];
}

// Snapshot a live board (its canvas + column members and labels) into a
// template record. Unsorted-filed cards are left out.
export function snapshotTemplate(doc: Doc, boardId: ID, name: string): Template | null {
  const board = doc.boards[boardId];
  if (!board) return null;
  const elements = Object.values(doc.elements).filter((e) => e.boardId === boardId && e.parentId !== UNSORTED);
  const labels = Object.values(doc.labels).filter((l) => l.boardId === boardId);
  return {
    id: uid(),
    name: name || board.title || 'Template',
    board: structuredClone(board),
    elements: structuredClone(elements),
    labels: structuredClone(labels),
    createdAt: Date.now(),
  };
}

// Instantiate a template into a fresh child board of hostId: new ids
// everywhere, labels rebound to the new board, board card placed at `at`.
// hostId null creates a root project board and skips the card.
export function instantiateActions(
  doc: Doc,
  template: Template,
  hostId: ID | null,
  at: { x: number; y: number },
): { actions: Action[]; cardId?: ID; boardId: ID } {
  const partial: Partial<Board> & { title: string } = {
    title: template.board.title || template.name,
    grid: template.board.grid,
    parentId: hostId,
  };
  if (template.board.icon !== undefined) partial.icon = template.board.icon;
  if (template.board.color !== undefined) partial.color = template.board.color;
  const board = createBoard(partial);
  const lmap = new Map<ID, ID>();
  const labels: Label[] = template.labels.map((l) => {
    const id = uid();
    lmap.set(l.id, id);
    return { ...structuredClone(l), id, boardId: board.id };
  });
  const { clones } = remapElements(doc, template.elements, () => board.id, 0, 0, {
    labelId: (lid) => lmap.get(lid) ?? null,
  });
  const actions: Action[] = [
    { type: 'board.create', board },
    ...labels.map((label): Action => ({ type: 'label.create', label })),
    ...clones.map((el): Action => ({ type: 'element.create', el })),
  ];
  let cardId: ID | undefined;
  if (hostId !== null) {
    const card = createBoardCard(doc, hostId, board.id, Math.round(at.x), Math.round(at.y));
    cardId = card.id;
    actions.push({ type: 'element.create', el: card });
  }
  return cardId === undefined ? { actions, boardId: board.id } : { actions, cardId, boardId: board.id };
}
