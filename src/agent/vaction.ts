import type { Action, ElementPatch } from '../state/actions';
import {
  createBoard,
  nextZ,
  saneContent,
  uid,
  type Doc,
  type Element,
  type ElementType,
  type ID,
  type TypeContent,
} from '../state/schema';
import { t } from '../strings';
import {
  fail,
  scrubContent,
  vAnchorId,
  vBoardId,
  vBool,
  vBoolOpt,
  vElementPatch,
  vId,
  vLabels,
  vNum,
  vNumOpt,
  vObj,
  vParentId,
  vPosition,
  vStr,
  vStrArray,
  vWidth,
} from './validate';

export const ELEMENT_TYPES = new Set<ElementType>([
  'note', 'column', 'board', 'todo', 'heading', 'swatch', 'line', 'comment',
  'link', 'embed', 'image', 'file', 'document', 'sketch', 'annotation', 'table',
]);

export function vAction(d: Doc, raw: unknown, depth: number): Action {
  const o = vObj(raw, 'action');
  const type = vStr(o.type, 'action.type', 64);
  switch (type) {
    case 'element.create': {
      const e = vObj(o.el, 'el');
      const etype = vStr(e.type, 'el.type', 32) as ElementType;
      if (!ELEMENT_TYPES.has(etype)) fail('bad_type', `unknown element type ${etype}`);
      const boardId = vBoardId(d, e.boardId);
      const content = vObj(e.content, 'el.content');
      if (!saneContent(content, etype)) fail('bad_field', 'el.content is malformed for this type');
      if ('boardRef' in content && !d.boards[content.boardRef]) {
        fail('not_found', `no board ${content.boardRef}`);
      }
      scrubContent(content);
      const now = Date.now();
      let z = vNumOpt(e.z, 'el.z');
      if (z === undefined) z = nextZ(d);
      else if (z > d.seq) d.seq = z;
      const id = e.id === undefined ? uid() : vId(e.id, 'el.id');
      if (d.elements[id]) fail('bad_field', `element ${id} already exists`);
      const el: Element = {
        id,
        boardId,
        type: etype,
        parentId: e.parentId === undefined ? null : vParentId(d, e.parentId, boardId),
        x: vNumOpt(e.x, 'el.x') ?? 0,
        y: vNumOpt(e.y, 'el.y') ?? 0,
        z,
        locked: vBoolOpt(e.locked, 'el.locked') ?? false,
        content: content as unknown as TypeContent,
        labels: e.labels === undefined ? [] : vLabels(d, e.labels, boardId),
        createdAt: vNumOpt(e.createdAt, 'el.createdAt') ?? now,
        modifiedAt: vNumOpt(e.modifiedAt, 'el.modifiedAt') ?? now,
      };
      if (e.w !== undefined) el.w = vWidth(e.w);
      if (e.color !== undefined) el.color = vStr(e.color, 'el.color', 64);
      if (e.anchorId !== undefined) el.anchorId = vAnchorId(d, e.anchorId, boardId);
      if (e.syncGroup !== undefined) el.syncGroup = vId(e.syncGroup, 'el.syncGroup');
      if (e.reactions !== undefined) el.reactions = vStrArray(e.reactions, 'el.reactions', 32);
      return { type: 'element.create', el };
    }
    case 'element.patch': {
      const id = vId(o.id, 'id');
      const el = d.elements[id];
      if (!el) fail('not_found', `no element ${id}`);
      const rawPatch = vObj(o.patch, 'patch');
      // parentId and labels must resolve against the board the
      // element ends up on, which a same-patch boardId can move.
      const targetBoard = rawPatch.boardId === undefined ? el.boardId : vBoardId(d, rawPatch.boardId);
      const patch = vElementPatch(d, el, rawPatch, targetBoard, id);
      scrubMove(el, patch, d);
      return { type: 'element.patch', id, patch };
    }
    case 'board.create': {
      const b = vObj(o.board, 'board');
      const board = createBoard({
        ...(b.id !== undefined ? { id: vId(b.id, 'board.id') } : {}),
        title: b.title === undefined ? t('untitled') : vStr(b.title, 'board.title'),
        parentId: b.parentId === undefined || b.parentId === null ? null : vBoardId(d, b.parentId),
        ...(b.grid !== undefined ? { grid: vBool(b.grid, 'board.grid') } : {}),
        ...(b.icon !== undefined ? { icon: vStr(b.icon, 'board.icon', 256) } : {}),
        ...(b.color !== undefined ? { color: vStr(b.color, 'board.color', 64) } : {}),
        ...(b.position !== undefined ? { position: vPosition(b.position) } : {}),
      });
      if (d.boards[board.id]) fail('bad_field', `board ${board.id} already exists`);
      return { type: 'board.create', board };
    }
    case 'board.patch': {
      const id = vId(o.id, 'id');
      if (!d.boards[id]) fail('not_found', `no board ${id}`);
      const patch: { title?: string; icon?: string | undefined; color?: string | undefined; grid?: boolean; position?: { x: number; y: number; z: number } } = {};
      for (const [k, v] of Object.entries(vObj(o.patch, 'patch'))) {
        if (k === 'title') patch.title = vStr(v, 'patch.title');
        else if (k === 'icon') patch.icon = v === null ? undefined : vStr(v, 'patch.icon', 256);
        else if (k === 'color') patch.color = v === null ? undefined : vStr(v, 'patch.color', 64);
        else if (k === 'grid') patch.grid = vBool(v, 'patch.grid');
        else if (k === 'position') {
          const pos = vObj(v, 'patch.position');
          patch.position = { x: vNum(pos.x, 'position.x'), y: vNum(pos.y, 'position.y'), z: vNum(pos.z, 'position.z') };
        } else fail('bad_field', `unknown board patch field ${k}`);
      }
      return { type: 'board.patch', id, patch };
    }
    case 'label.create': {
      const l = vObj(o.label, 'label');
      const id = l.id === undefined ? uid() : vId(l.id, 'label.id');
      if (d.labels[id]) fail('bad_field', `label ${id} already exists`);
      return {
        type: 'label.create',
        label: {
          id,
          boardId: vBoardId(d, l.boardId),
          name: vStr(l.name, 'label.name', 256),
          color: vStr(l.color, 'label.color', 64),
        },
      };
    }
    case 'label.delete': {
      const label = d.labels[vId(vObj(o.label, 'label').id, 'label.id')];
      if (!label) fail('not_found', 'no such label');
      return { type: 'label.delete', label };
    }
    case 'label.patch': {
      const id = vId(o.id, 'id');
      if (!d.labels[id]) fail('not_found', `no label ${id}`);
      const patch: { name?: string; color?: string } = {};
      for (const [k, v] of Object.entries(vObj(o.patch, 'patch'))) {
        if (k === 'name') patch.name = vStr(v, 'patch.name', 256);
        else if (k === 'color') patch.color = vStr(v, 'patch.color', 64);
        else fail('bad_field', `unknown label patch field ${k}`);
      }
      return { type: 'label.patch', id, patch };
    }
    case 'template.delete': {
      const tpl = d.templates[vId(vObj(o.tpl, 'tpl').id, 'tpl.id')];
      if (!tpl) fail('not_found', 'no such template');
      return { type: 'template.delete', tpl };
    }
    case 'template.patch': {
      const id = vId(o.id, 'id');
      if (!d.templates[id]) fail('not_found', `no template ${id}`);
      const patch: { name?: string } = {};
      for (const [k, v] of Object.entries(vObj(o.patch, 'patch'))) {
        if (k === 'name') patch.name = vStr(v, 'patch.name', 256);
        else fail('bad_field', `unknown template patch field ${k}`);
      }
      return { type: 'template.patch', id, patch };
    }
    case 'batch': {
      if (depth > 4) fail('too_large', 'batch nesting too deep');
      if (!Array.isArray(o.actions)) fail('bad_params', 'batch needs an actions array');
      return { type: 'batch', actions: o.actions.map((a) => vAction(d, a, depth + 1)) };
    }
    default:
      fail('forbidden', `action ${type} is not allowed`);
  }
}

// A patch that moves an element to another board must not carry
// refs that only resolve on the old board (same fixups as restore):
// an unset parentId drops to the canvas, labels filter to the new
// board's set, syncGroup clears and a stale anchorId drops.
export function scrubMove(el: Element, patch: ElementPatch, d: Doc) {
  if (patch.boardId === undefined || patch.boardId === el.boardId) return;
  if (patch.parentId === undefined) patch.parentId = null;
  if (patch.labels === undefined) {
    patch.labels = el.labels.filter((l) => d.labels[l]?.boardId === patch.boardId);
  }
  if (patch.syncGroup === undefined) patch.syncGroup = undefined;
  if (patch.anchorId === undefined && el.anchorId !== undefined) {
    if (d.elements[el.anchorId]?.boardId !== patch.boardId) patch.anchorId = undefined;
  }
}

// Re-checked at run time too: two creates in one batch could carry
// the same id, and a plain assignment would overwrite the loser.
// `seen` catches repeats inside the batch; the doc check catches
// collisions with existing records.
export function checkNoOverwrite(d: Doc, a: Action, seen = new Set<ID>()): void {
  if (a.type === 'batch') {
    for (const x of a.actions) checkNoOverwrite(d, x, seen);
    return;
  }
  const dup = (kind: string, id: ID, exists: boolean) => {
    if (exists || seen.has(id)) fail('bad_field', `${kind} ${id} already exists`);
    seen.add(id);
  };
  if (a.type === 'element.create') dup('element', a.el.id, !!d.elements[a.el.id]);
  if (a.type === 'board.create') dup('board', a.board.id, !!d.boards[a.board.id]);
  if (a.type === 'label.create') dup('label', a.label.id, !!d.labels[a.label.id]);
  if (a.type === 'template.create') dup('template', a.tpl.id, !!d.templates[a.tpl.id]);
}
