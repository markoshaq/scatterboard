import type { Board, Doc, Element, ID, Label, Template, TrashEntry } from './schema';

type PatchOf<T, K extends keyof T> = { [P in K]?: T[P] | undefined };

export type ElementPatch = PatchOf<
  Element,
  | 'x'
  | 'y'
  | 'w'
  | 'z'
  | 'locked'
  | 'color'
  | 'anchorId'
  | 'boardId'
  | 'parentId'
  | 'content'
  | 'labels'
  | 'reactions'
  | 'syncGroup'
  | 'modifiedAt'
>;
type BoardPatch = PatchOf<Board, 'title' | 'icon' | 'color' | 'grid' | 'position' | 'modifiedAt'>;
type LabelPatch = PatchOf<Label, 'name' | 'color'>;
type TemplatePatch = PatchOf<Template, 'name'>;

export type Action =
  | { type: 'element.create'; el: Element }
  | { type: 'element.delete'; el: Element }
  | { type: 'element.patch'; id: ID; patch: ElementPatch }
  | { type: 'board.create'; board: Board }
  | { type: 'board.delete'; board: Board }
  | { type: 'board.patch'; id: ID; patch: BoardPatch }
  | { type: 'label.create'; label: Label }
  | { type: 'label.delete'; label: Label }
  | { type: 'label.patch'; id: ID; patch: LabelPatch }
  | { type: 'trash.add'; id: ID; entry: TrashEntry }
  | { type: 'trash.remove'; id: ID }
  | { type: 'template.create'; tpl: Template }
  | { type: 'template.delete'; tpl: Template }
  | { type: 'template.patch'; id: ID; patch: TemplatePatch }
  | { type: 'batch'; actions: Action[] };

export interface Change {
  elements: Set<ID>;
  boards: Set<ID>;
  deleted: Set<ID>;
  labels: Set<ID>;
  trash: Set<ID>;
  templates: Set<ID>;
  // True when the change replays history (undo/redo): chrome uses it
  // to keep replays silent (no exit animations).
  replay: boolean;
}

export function emptyChange(): Change {
  return { elements: new Set(), boards: new Set(), deleted: new Set(), labels: new Set(), trash: new Set(), templates: new Set(), replay: false };
}

export function applyAction(doc: Doc, a: Action, change: Change): Action {
  switch (a.type) {
    case 'element.create':
      doc.elements[a.el.id] = a.el;
      change.elements.add(a.el.id);
      return { type: 'element.delete', el: a.el };
    case 'element.delete':
      if (!doc.elements[a.el.id]) return { type: 'batch', actions: [] };
      delete doc.elements[a.el.id];
      change.elements.add(a.el.id);
      change.deleted.add(a.el.id);
      return { type: 'element.create', el: a.el };
    case 'element.patch': {
      const el = doc.elements[a.id];
      if (!el) return { type: 'batch', actions: [] };
      const before: ElementPatch = {};
      const rec = el as unknown as Record<string, unknown>;
      // modifiedAt rides the patch record so an undo restores the
      // timestamp it replaced instead of stamping a fresh one.
      (before as Record<string, unknown>).modifiedAt = rec.modifiedAt;
      for (const k of Object.keys(a.patch) as (keyof ElementPatch)[]) {
        (before as Record<string, unknown>)[k] = rec[k];
        rec[k] = a.patch[k];
      }
      rec.modifiedAt = a.patch.modifiedAt ?? Date.now();
      change.elements.add(a.id);
      return { type: 'element.patch', id: a.id, patch: before };
    }
    case 'board.create':
      doc.boards[a.board.id] = a.board;
      change.boards.add(a.board.id);
      return { type: 'board.delete', board: a.board };
    case 'board.delete':
      if (!doc.boards[a.board.id]) return { type: 'batch', actions: [] };
      delete doc.boards[a.board.id];
      change.boards.add(a.board.id);
      return { type: 'board.create', board: a.board };
    case 'board.patch': {
      const b = doc.boards[a.id];
      if (!b) return { type: 'batch', actions: [] };
      const before: BoardPatch = {};
      const rec = b as unknown as Record<string, unknown>;
      (before as Record<string, unknown>).modifiedAt = rec.modifiedAt;
      for (const k of Object.keys(a.patch) as (keyof BoardPatch)[]) {
        (before as Record<string, unknown>)[k] = rec[k];
        rec[k] = a.patch[k];
      }
      rec.modifiedAt = a.patch.modifiedAt ?? Date.now();
      change.boards.add(a.id);
      return { type: 'board.patch', id: a.id, patch: before };
    }
    case 'label.create':
      doc.labels[a.label.id] = a.label;
      change.labels.add(a.label.id);
      return { type: 'label.delete', label: a.label };
    case 'label.delete':
      if (!doc.labels[a.label.id]) return { type: 'batch', actions: [] };
      delete doc.labels[a.label.id];
      change.labels.add(a.label.id);
      return { type: 'label.create', label: a.label };
    case 'label.patch': {
      const l = doc.labels[a.id];
      if (!l) return { type: 'batch', actions: [] };
      const before: LabelPatch = {};
      const rec = l as unknown as Record<string, unknown>;
      for (const k of Object.keys(a.patch) as (keyof LabelPatch)[]) {
        (before as Record<string, unknown>)[k] = rec[k];
        rec[k] = a.patch[k];
      }
      change.labels.add(a.id);
      return { type: 'label.patch', id: a.id, patch: before };
    }
    case 'trash.add':
      doc.trash[a.id] = a.entry;
      change.trash.add(a.id);
      return { type: 'trash.remove', id: a.id };
    case 'trash.remove': {
      const entry = doc.trash[a.id];
      if (!entry) return { type: 'batch', actions: [] };
      delete doc.trash[a.id];
      change.trash.add(a.id);
      return { type: 'trash.add', id: a.id, entry };
    }
    case 'template.create':
      doc.templates[a.tpl.id] = a.tpl;
      change.templates.add(a.tpl.id);
      return { type: 'template.delete', tpl: a.tpl };
    case 'template.delete':
      if (!doc.templates[a.tpl.id]) return { type: 'batch', actions: [] };
      delete doc.templates[a.tpl.id];
      change.templates.add(a.tpl.id);
      return { type: 'template.create', tpl: a.tpl };
    case 'template.patch': {
      const tp = doc.templates[a.id];
      if (!tp) return { type: 'batch', actions: [] };
      const before: TemplatePatch = {};
      const rec = tp as unknown as Record<string, unknown>;
      for (const k of Object.keys(a.patch) as (keyof TemplatePatch)[]) {
        (before as Record<string, unknown>)[k] = rec[k];
        rec[k] = a.patch[k];
      }
      change.templates.add(a.id);
      return { type: 'template.patch', id: a.id, patch: before };
    }
    case 'batch': {
      const inverses: Action[] = [];
      for (const child of a.actions) inverses.unshift(applyAction(doc, child, change));
      return { type: 'batch', actions: inverses };
    }
  }
}

export function coalesceKey(a: Action): string | null {
  return a.type === 'element.patch' ? `ep:${a.id}` : a.type === 'board.patch' ? `bp:${a.id}` : null;
}

export function mergePatch(a: Action, b: Action): Action {
  if (a.type === 'element.patch' && b.type === 'element.patch' && a.id === b.id) {
    return { type: 'element.patch', id: a.id, patch: { ...a.patch, ...b.patch } };
  }
  if (a.type === 'board.patch' && b.type === 'board.patch' && a.id === b.id) {
    return { type: 'board.patch', id: a.id, patch: { ...a.patch, ...b.patch } };
  }
  return b;
}
