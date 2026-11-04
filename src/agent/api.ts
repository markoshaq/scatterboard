import type { Action, ElementPatch } from '../state/actions';
import type { Store } from '../state/store';
import { builtinTemplates, instantiateActions, snapshotTemplate } from '../state/templates';
import {
  createAnnotation,
  createBoard,
  createBoardCard,
  createColumn,
  createComment,
  createDocument,
  createEmbed,
  createFile,
  createHeading,
  createImage,
  createLine,
  createLink,
  createNote,
  createSketch,
  createSwatch,
  createTable,
  createTodo,
  embedDoc,
  linkDoc,
  saneContent,
  strokesBBox,
  uid,
  type CellType,
  type Doc,
  type Element,
  type ElementType,
  type EmbedKind,
  type ID,
  type LineMarker,
  type LineWeight,
  type PresentOpts,
  type TableCell,
  type TodoItem,
  type TypeContent,
} from '../state/schema';
import type { Viewport, Rect } from '../canvas/viewport';
import { resolveLine } from '../canvas/lines';
import { remapElements } from '../state/clone';
import { autoTitled } from '../app/editing';
import type { Prefs } from '../persist/storage';
import {
  fail,
  scrubHtml,
  vBoardId,
  vBool,
  vBoolOpt,
  vElId,
  vHtml,
  vId,
  vLabels,
  vLineEnd,
  vNum,
  vNumOpt,
  vObj,
  vParentId,
  vStr,
  vStrArray,
  vStrOpt,
  vStrokes,
  vUrl,
  vUrlOpt,
  vWidth,
  type Dict,
} from './validate';

// The slice of App the command surface needs; tests stub it, App
// satisfies it structurally.
export interface AgentHost {
  store: Store;
  prefs: Prefs;
  vp: Viewport;
  boardId: ID | null;
  agentConnected: boolean;
  doc: Doc;
  lockedView(): boolean;
  openBoard(id: ID): void;
  sel: ReadonlySet<ID>;
  setSelection(ids: Iterable<ID>): void;
  deleteSelection(): void;
  stampBoardColor(el: Element): void;
  scheduleSave(): void;
  editing: { endEdit(): void };
  layer: { rectOf(el: Element): Rect };
  exporter: {
    snapshotPng(boardId?: ID, region?: Rect, scale?: number): Promise<Blob | null>;
    boardRaster(scale: number, region?: Rect): Promise<HTMLCanvasElement | null>;
    mediaZip(boardId: ID): Promise<Blob | null>;
  };
  blobStore: { put(id: ID, blob: Blob): Promise<void> };
  flush(): Promise<void>;
  presenting: boolean;
  enterPresent(): void;
  exitPresent(): void;
  setPresentOpts(o: PresentOpts): void;
}

export interface AgentCommand {
  method: string;
  params?: unknown;
}

// [{method, params}] | {name, args} | [method, params] tuple.
export function parseCommand(raw: unknown): AgentCommand {
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw.length > 1 ? { method: raw[0], params: raw[1] } : { method: raw[0] };
  }
  const o = vObj(raw, 'command');
  const m = o.method ?? o.name;
  return { method: vStr(m, 'command.method', 64), params: o.params ?? o.args };
}

// Commands that change the doc; reads, navigation and present are
// exempt from the presenting lock.
export const MUTATING = new Set([
  'create',
  'patch',
  'remove',
  'connect',
  'undo',
  'redo',
  'batch',
  'dispatch',
  'restore',
  'emptyTrash',
  'instantiate',
  'saveTemplate',
  'upload',
  'import',
  'unfurl',
  'duplicate',
]);

// Commands a ?do= link may run without asking: reads, selection,
// navigation and exports. Everything else confirms first.
export const URL_SAFE = new Set([
  'boards',
  'openBoard',
  'state',
  'labels',
  'search',
  'elements',
  'get',
  'trash',
  'select',
  'view',
  'snapshot',
  'export',
  'templates',
]);

const EMBED_KINDS = new Set(['audio', 'map', 'video']);
const LINE_MARKERS = new Set(['none', 'arrow', 'dot']);
const LINE_WEIGHTS = new Set(['thin', 'medium', 'thick']);
const CELL_TYPES = new Set(['auto', 'number', 'currency', 'percent', 'text', 'datetime', 'checkbox']);
const EXPORT_FORMATS = new Set(['png', 'pdf', 'md', 'txt', 'doc', 'json', 'zip']);
const PRESENT_KEYS = new Set(['on', 'focus', 'comments', 'edit']);
const ALIGNS_H = new Set(['left', 'center', 'right']);
const ALIGNS_V = new Set(['top', 'middle', 'bottom']);
const ELEMENT_TYPES = new Set<ElementType>([
  'note', 'column', 'board', 'todo', 'heading', 'swatch', 'line', 'comment',
  'link', 'embed', 'image', 'file', 'document', 'sketch', 'annotation', 'table',
]);

// Per-type friendly content prop names accepted by create/patch.
const TYPE_PROPS: Record<string, Set<string>> = {
  note: new Set(['text', 'html']),
  heading: new Set(['text', 'html', 'level']),
  todo: new Set(['title', 'items', 'showTitle']),
  column: new Set(['title']),
  board: new Set(['ref', 'title']),
  swatch: new Set(['value', 'caption', 'showValue']),
  line: new Set(['from', 'to', 'label', 'dashed', 'weight', 'fromMarker', 'toMarker']),
  comment: new Set(['text', 'items', 'add', 'anchor', 'anchorId']),
  link: new Set(['url', 'title', 'caption', 'showPreview', 'desc', 'image']),
  embed: new Set(['kind', 'url', 'title', 'caption', 'showPreview']),
  image: new Set(['caption', 'strokes']),
  file: new Set([]),
  document: new Set(['title', 'text', 'html', 'caption', 'displayMode']),
  sketch: new Set(['strokes']),
  annotation: new Set(['strokes']),
  table: new Set(['title', 'caption', 'cells']),
};

const COMMON_PROPS = new Set(['x', 'y', 'w', 'color', 'parentId', 'boardId', 'labels', 'reactions']);
const PATCH_TOP = new Set([
  'x', 'y', 'w', 'z', 'locked', 'color', 'anchorId', 'boardId', 'parentId', 'labels', 'reactions', 'syncGroup',
]);

function vEnum<T extends string>(v: unknown, name: string, set: Set<string>): T {
  const s = vStr(v, name, 32);
  if (!set.has(s)) fail('bad_field', `${name} must be one of ${[...set].join(', ')}`);
  return s as T;
}

function vPosition(v: unknown): { x: number; y: number; z: number } {
  const o = vObj(v, 'position');
  return { x: vNum(o.x, 'position.x'), y: vNum(o.y, 'position.y'), z: vNum(o.z, 'position.z') };
}

function vTodoItems(v: unknown): TodoItem[] {
  if (!Array.isArray(v)) fail('bad_field', 'items must be an array');
  return v.map((raw): TodoItem => {
    const o = vObj(raw, 'items[]');
    const it: TodoItem = {
      id: uid(),
      text: vStrOpt(o.text, 'items[].text', 8192) ?? '',
      done: vBoolOpt(o.done, 'items[].done') ?? false,
    };
    if (o.dueAt !== undefined) it.dueAt = vNum(o.dueAt, 'items[].dueAt');
    if (o.dueTime !== undefined) it.dueTime = vBool(o.dueTime, 'items[].dueTime');
    if (o.assignee !== undefined) {
      if (o.assignee !== 'self') fail('bad_field', 'assignee must be "self"');
      it.assignee = 'self';
    }
    return it;
  });
}

function vCommentItems(v: unknown) {
  if (!Array.isArray(v)) fail('bad_field', 'items must be an array');
  const now = Date.now();
  return v.map((raw) => {
    const o = vObj(raw, 'items[]');
    return { id: uid(), text: vStr(o.text, 'items[].text', 8192), createdAt: vNumOpt(o.createdAt, 'items[].createdAt') ?? now };
  });
}

function vCell(v: unknown): Partial<TableCell> {
  const o = vObj(v, 'cell');
  const out: Partial<TableCell> = {};
  if (o.text !== undefined) out.text = vStr(o.text, 'cell.text', 8192);
  if (o.html !== undefined) out.html = vHtml(o.html, 'cell.html');
  if (o.type !== undefined) out.type = vEnum<CellType>(o.type, 'cell.type', CELL_TYPES);
  if (o.alignH !== undefined) out.alignH = vEnum(o.alignH, 'cell.alignH', ALIGNS_H);
  if (o.alignV !== undefined) out.alignV = vEnum(o.alignV, 'cell.alignV', ALIGNS_V);
  if (o.color !== undefined) out.color = vStr(o.color, 'cell.color', 64);
  return out;
}

const MAX_CELL_ROW = 200;
const MAX_CELL_COL = 104;

function cellRef(ref: string): { r: number; c: number } {
  const m = /^([A-Za-z]{1,2})([1-9][0-9]{0,2})$/.exec(ref);
  if (!m) fail('bad_field', `bad cell ref ${ref}`);
  let c = 0;
  for (const ch of m[1]!.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  const out = { r: Number(m[2]) - 1, c: c - 1 };
  if (out.r >= MAX_CELL_ROW || out.c >= MAX_CELL_COL) fail('too_large', `cell ref ${ref} out of range`);
  return out;
}

// Sparse {B2: {text}} merge into a copy of the grid; the grid grows to
// fit out-of-range refs.
function mergeCells(cur: TableCell[][], v: unknown): TableCell[][] {
  const cells = cur.map((row) => row.map((c) => ({ ...c })));
  if (!cells.length) cells.push([{ text: '' }]);
  for (const [ref, raw] of Object.entries(vObj(v, 'cells'))) {
    const { r, c } = cellRef(ref);
    while (cells.length <= r) cells.push(Array.from({ length: cells[0]!.length }, () => ({ text: '' })));
    for (const row of cells) while (row.length <= c) row.push({ text: '' });
    cells[r]![c] = { ...cells[r]![c]!, ...vCell(raw) };
  }
  return cells;
}

// Upload payloads arrive as raw base64 or a base64 data URL. Anything
// else fails loudly rather than producing a corrupt blob.
function b64ToBlob(s: string, mime?: string): Blob {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(s);
  const type = m?.[1] || mime || 'application/octet-stream';
  const b64 = (m ? m[2]! : s).replace(/\s/g, '');
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) fail('bad_field', 'data must be base64 or a base64 data URL');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

type Runner = () => unknown | Promise<unknown>;

export function createAgentApi(app: AgentHost) {
  const doc = () => app.doc;

  let dispatchCount = 0;
  const dispatch = (a: Action) => {
    dispatchCount++;
    app.store.dispatch(a);
  };

  const guard = () => {
    if (app.lockedView()) fail('locked', 'board is read-only while presenting');
  };

  const requireBoard = (): ID => {
    const bid = app.boardId;
    if (!bid || !doc().boards[bid]) fail('no_board', 'no board is open');
    return bid;
  };

  const elView = (el: Element): Dict => {
    const v: Dict = { ...el };
    if (el.boardId === app.boardId) v.rect = app.layer.rectOf(el);
    return v;
  };

  // Applies the friendly content props to a copy of the element's
  // content. Also validates them: unknown keys already failed upstream,
  // bad values fail here. `top` carries element-field side effects
  // (annotation strokes re-origin the element).
  function mergeContent(el: Element, p: Dict): { content: TypeContent; top?: ElementPatch } {
    const c = el.content;
    if ('note' in c) {
      const note = { ...c.note };
      if (p.text !== undefined) note.text = vStr(p.text, 'text');
      if (p.html !== undefined) note.html = vHtml(p.html, 'html');
      return { content: { note } };
    }
    if ('heading' in c) {
      const heading = { ...c.heading };
      if (p.text !== undefined) heading.text = vStr(p.text, 'text');
      if (p.html !== undefined) heading.html = vHtml(p.html, 'html');
      if (p.level !== undefined) heading.level = vNum(p.level, 'level') === 2 ? 2 : 1;
      return { content: { heading } };
    }
    if ('column' in c) {
      const column = { ...c.column };
      if (p.title !== undefined) column.title = vStr(p.title, 'title');
      return { content: { column } };
    }
    if ('todo' in c) {
      const todo = { ...c.todo };
      if (p.title !== undefined) todo.title = vStr(p.title, 'title');
      if (p.showTitle !== undefined) todo.showTitle = vBool(p.showTitle, 'showTitle');
      if (p.items !== undefined) todo.items = vTodoItems(p.items);
      return { content: { todo } };
    }
    if ('boardRef' in c) {
      if (p.ref !== undefined) return { content: { boardRef: vBoardId(doc(), p.ref) } };
      return { content: c };
    }
    if ('swatch' in c) {
      const swatch = { ...c.swatch };
      if (p.value !== undefined) swatch.color = vStr(p.value, 'value', 64);
      if (p.caption !== undefined) swatch.caption = vStr(p.caption, 'caption');
      if (p.showValue !== undefined) swatch.showValue = vBool(p.showValue, 'showValue');
      return { content: { swatch } };
    }
    if ('line' in c) {
      const line = { ...c.line };
      if (p.from !== undefined) line.from = vLineEnd(doc(), p.from, 'from');
      if (p.to !== undefined) line.to = vLineEnd(doc(), p.to, 'to');
      if (p.label !== undefined) line.label = vStr(p.label, 'label', 4096);
      if (p.dashed !== undefined) line.dashed = vBool(p.dashed, 'dashed');
      if (p.weight !== undefined) line.weight = vEnum<LineWeight>(p.weight, 'weight', LINE_WEIGHTS);
      if (p.fromMarker !== undefined) line.fromMarker = vEnum<LineMarker>(p.fromMarker, 'fromMarker', LINE_MARKERS);
      if (p.toMarker !== undefined) line.toMarker = vEnum<LineMarker>(p.toMarker, 'toMarker', LINE_MARKERS);
      return { content: { line } };
    }
    if ('comment' in c) {
      let items = c.comment.items;
      if (p.items !== undefined) items = vCommentItems(p.items);
      if (p.add !== undefined) {
        items = [...items, { id: uid(), text: vStr(p.add, 'add', 8192), createdAt: Date.now() }];
      }
      return { content: { comment: { items } } };
    }
    if ('link' in c) {
      const link = { ...c.link };
      if (p.url !== undefined) link.url = vUrl(p.url, 'url');
      if (p.title !== undefined) link.title = vStr(p.title, 'title');
      if (p.caption !== undefined) link.caption = vStr(p.caption, 'caption');
      if (p.showPreview !== undefined) link.showPreview = vBool(p.showPreview, 'showPreview');
      if (p.desc !== undefined) {
        if (p.desc === null) delete link.desc;
        else link.desc = vStr(p.desc, 'desc', 8192);
      }
      if (p.image !== undefined) {
        if (p.image === null) delete link.image;
        else link.image = vStr(p.image, 'image', 8192);
      }
      return { content: { link } };
    }
    if ('embed' in c) {
      const embed = { ...c.embed };
      if (p.kind !== undefined) embed.kind = vEnum<EmbedKind>(p.kind, 'kind', EMBED_KINDS);
      if (p.url !== undefined) embed.url = vUrl(p.url, 'url');
      if (p.title !== undefined) embed.title = vStr(p.title, 'title');
      if (p.caption !== undefined) embed.caption = vStr(p.caption, 'caption');
      if (p.showPreview !== undefined) embed.showPreview = vBool(p.showPreview, 'showPreview');
      return { content: { embed } };
    }
    if ('image' in c) {
      const image = { ...c.image };
      if (p.caption !== undefined) image.caption = vStr(p.caption, 'caption');
      if (p.strokes !== undefined) image.strokes = vStrokes(p.strokes);
      return { content: { image } };
    }
    if ('file' in c) return { content: c };
    if ('document' in c) {
      const document = { ...c.document };
      if (p.title !== undefined) document.title = vStr(p.title, 'title');
      if (p.text !== undefined) document.text = vStr(p.text, 'text');
      if (p.html !== undefined) document.html = vHtml(p.html, 'html');
      if (p.caption !== undefined) document.caption = vStr(p.caption, 'caption');
      if (p.displayMode !== undefined) {
        document.displayMode = vEnum(p.displayMode, 'displayMode', new Set(['icon', 'detail']));
      }
      return { content: { document } };
    }
    if ('sketch' in c) {
      if (p.strokes === undefined) return { content: c };
      return { content: { sketch: { strokes: vStrokes(p.strokes) } } };
    }
    if ('annotation' in c) {
      if (p.strokes === undefined) return { content: c };
      const strokes = vStrokes(p.strokes);
      // Board-space strokes re-origin the element exactly like
      // createAnnotation does.
      const box = strokesBBox(strokes);
      const rel = strokes.map((s) => ({
        ...s,
        pts: s.pts.map(([px, py]): [number, number] => [px - box.x, py - box.y]),
      }));
      return {
        content: { annotation: { strokes: rel } },
        top: { x: Math.round(box.x), y: Math.round(box.y), w: Math.max(1, Math.round(box.w)) },
      };
    }
    if ('table' in c) {
      const table = { ...c.table };
      if (p.title !== undefined) table.title = vStr(p.title, 'title');
      if (p.caption !== undefined) table.caption = vStr(p.caption, 'caption');
      if (p.cells !== undefined) table.cells = mergeCells(c.table.cells, p.cells);
      return { content: { table } };
    }
    return { content: c };
  }

  function checkKeys(o: Dict, allowed: Set<string>) {
    for (const k of Object.keys(o)) {
      if (!allowed.has(k)) fail('bad_field', `unknown field ${k}`);
    }
  }

  function checkProps(type: ElementType, p: Dict, extra: Set<string>) {
    checkKeys(p, new Set([...extra, ...(TYPE_PROPS[type] ?? [])]));
  }

  function buildElement(type: ElementType, p: Dict): { id: ID; action: Action } {
    const d = doc();
    const boardId = p.boardId === undefined ? requireBoard() : vBoardId(d, p.boardId);
    const center = app.vp.toBoard(app.vp.vw / 2, app.vp.vh / 2);
    const x = Math.round(vNumOpt(p.x, 'x') ?? center.x);
    const y = Math.round(vNumOpt(p.y, 'y') ?? center.y);
    const parentId = p.parentId === undefined ? null : vParentId(d, p.parentId, boardId);
    let el: Element;
    const actions: Action[] = [];
    switch (type) {
      case 'note': {
        el = createNote(d, boardId, x, y, vStrOpt(p.text, 'text') ?? '');
        if (p.html !== undefined) el.content = mergeContent(el, p).content;
        break;
      }
      case 'heading': {
        const level = p.level === undefined ? 1 : vNum(p.level, 'level') === 2 ? 2 : 1;
        el = createHeading(d, boardId, x, y, level);
        el.content = mergeContent(el, p).content;
        break;
      }
      case 'column':
        el = createColumn(d, boardId, x, y, vStrOpt(p.title, 'title') ?? '');
        break;
      case 'board': {
        if (p.ref !== undefined) {
          el = createBoardCard(d, boardId, vBoardId(d, p.ref), x, y);
        } else {
          const board = createBoard({ parentId: boardId, title: vStrOpt(p.title, 'title') ?? 'Untitled board' });
          actions.push({ type: 'board.create', board });
          el = createBoardCard(d, boardId, board.id, x, y);
        }
        break;
      }
      case 'todo': {
        el = createTodo(d, boardId, x, y);
        el.content = mergeContent(el, p).content;
        if (p.title !== undefined && p.showTitle === undefined && 'todo' in el.content) {
          el.content.todo.showTitle = true;
        }
        break;
      }
      case 'swatch': {
        el = createSwatch(d, boardId, x, y, vStrOpt(p.value ?? p.color, 'value', 64) ?? '#3d84e0');
        el.content = mergeContent(el, p).content;
        break;
      }
      case 'line': {
        if (p.from === undefined || p.to === undefined) fail('bad_params', 'line needs from and to');
        el = createLine(d, boardId, vLineEnd(d, p.from, 'from'), vLineEnd(d, p.to, 'to'));
        el.content = mergeContent(el, p).content;
        break;
      }
      case 'comment': {
        const anchor = p.anchorId ?? p.anchor;
        el = createComment(d, boardId, x, y, anchor === undefined ? undefined : vElId(d, anchor, 'anchorId'));
        if (p.text !== undefined && p.items === undefined) {
          p = { ...p, items: [{ text: p.text }] };
        }
        el.content = mergeContent(el, p).content;
        break;
      }
      case 'link':
        el = createLink(d, boardId, x, y, vUrlOpt(p.url, 'url') ?? '');
        el.content = mergeContent(el, p).content;
        break;
      case 'embed': {
        const kind = p.kind === undefined ? 'video' : vEnum<EmbedKind>(p.kind, 'kind', EMBED_KINDS);
        el = createEmbed(d, boardId, kind, x, y);
        el.content = mergeContent(el, p).content;
        break;
      }
      case 'document':
        el = createDocument(d, boardId, x, y);
        el.content = mergeContent(el, p).content;
        break;
      case 'sketch':
        el = createSketch(d, boardId, x, y);
        el.content = mergeContent(el, p).content;
        break;
      case 'annotation': {
        const strokes = vStrokes(p.strokes ?? fail('bad_params', 'annotation needs strokes'));
        if (!strokes.length) fail('bad_field', 'annotation needs at least one stroke');
        el = createAnnotation(d, boardId, strokes);
        break;
      }
      case 'table': {
        el = createTable(d, boardId, x, y);
        el.content = mergeContent(el, p).content;
        break;
      }
      case 'image':
      case 'file':
        fail('unsupported', `${type} cards carry a blob; create them with the upload command`);
        break;
      default:
        fail('bad_type', `unknown card type ${type}`);
    }
    app.stampBoardColor(el);
    if (p.w !== undefined) el.w = vWidth(p.w);
    if (p.color !== undefined && type !== 'swatch') el.color = vStr(p.color, 'color', 64);
    el.parentId = parentId;
    if (p.labels !== undefined) el.labels = vLabels(d, p.labels, boardId);
    if (p.reactions !== undefined) el.reactions = vStrArray(p.reactions, 'reactions', 32);
    actions.push({ type: 'element.create', el });
    return { id: el.id, action: actions.length > 1 ? { type: 'batch', actions } : actions[0]! };
  }

  function vAction(raw: unknown, depth: number): Action {
    const o = vObj(raw, 'action');
    const type = vStr(o.type, 'action.type', 64);
    const d = doc();
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
        scrubHtml(content);
        const now = Date.now();
        let z = vNumOpt(e.z, 'el.z');
        if (z === undefined) z = ++d.seq;
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
        if (e.anchorId !== undefined) el.anchorId = vElId(d, e.anchorId, 'el.anchorId');
        if (e.syncGroup !== undefined) el.syncGroup = vId(e.syncGroup, 'el.syncGroup');
        if (e.reactions !== undefined) el.reactions = vStrArray(e.reactions, 'el.reactions', 32);
        return { type: 'element.create', el };
      }
      case 'element.delete': {
        const el = d.elements[vId(vObj(o.el, 'el').id, 'el.id')];
        if (!el) fail('not_found', 'no such element');
        return { type: 'element.delete', el };
      }
      case 'element.patch': {
        const id = vId(o.id, 'id');
        const el = d.elements[id];
        if (!el) fail('not_found', `no element ${id}`);
        const patch: ElementPatch = {};
        const rawPatch = vObj(o.patch, 'patch');
        // parentId and labels must resolve against the board the
        // element ends up on, which a same-patch boardId can move.
        const targetBoard = rawPatch.boardId === undefined ? el.boardId : vBoardId(d, rawPatch.boardId);
        for (const [k, v] of Object.entries(rawPatch)) {
          switch (k) {
            case 'x':
            case 'y':
            case 'z':
              patch[k] = vNum(v, `patch.${k}`);
              break;
            case 'w':
              patch.w = vWidth(v);
              break;
            case 'locked':
              patch.locked = vBool(v, 'patch.locked');
              break;
            case 'color':
              patch.color = v === null ? undefined : vStr(v, 'patch.color', 64);
              break;
            case 'anchorId':
              if (v !== null && el.type !== 'comment') fail('bad_field', 'anchorId applies to comment elements');
              patch.anchorId = v === null ? undefined : vElId(d, v, 'patch.anchorId');
              break;
            case 'boardId':
              patch.boardId = vBoardId(d, v);
              break;
            case 'parentId':
              patch.parentId = vParentId(d, v, targetBoard);
              break;
            case 'content': {
              const c = vObj(v, 'patch.content');
              if (!saneContent(c, el.type)) fail('bad_field', 'patch.content is malformed for this element type');
              scrubHtml(c);
              patch.content = c as unknown as TypeContent;
              break;
            }
            case 'labels':
              patch.labels = vLabels(d, v, targetBoard);
              break;
            case 'reactions':
              patch.reactions = v === null ? undefined : vStrArray(v, 'patch.reactions', 32);
              break;
            case 'syncGroup':
              patch.syncGroup = v === null ? undefined : vId(v, 'patch.syncGroup');
              break;
            default:
              fail('bad_field', `unknown patch field ${k}`);
          }
        }
        return { type: 'element.patch', id, patch };
      }
      case 'board.create': {
        const b = vObj(o.board, 'board');
        const board = createBoard({
          ...(b.id !== undefined ? { id: vId(b.id, 'board.id') } : {}),
          ...(b.title !== undefined ? { title: vStr(b.title, 'board.title') } : {}),
          parentId: b.parentId === undefined || b.parentId === null ? null : vBoardId(d, b.parentId),
          ...(b.grid !== undefined ? { grid: vBool(b.grid, 'board.grid') } : {}),
          ...(b.icon !== undefined ? { icon: vStr(b.icon, 'board.icon', 256) } : {}),
          ...(b.color !== undefined ? { color: vStr(b.color, 'board.color', 64) } : {}),
          ...(b.position !== undefined ? { position: vPosition(b.position) } : {}),
        });
        if (d.boards[board.id]) fail('bad_field', `board ${board.id} already exists`);
        return { type: 'board.create', board };
      }
      case 'board.delete': {
        const board = d.boards[vId(vObj(o.board, 'board').id, 'board.id')];
        if (!board) fail('not_found', 'no such board');
        return { type: 'board.delete', board };
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
        return { type: 'batch', actions: o.actions.map((a) => vAction(a, depth + 1)) };
      }
      default:
        fail('forbidden', `action ${type} is not allowed`);
    }
  }

  // Re-checked at run time too: two creates in one batch could carry
  // the same id, and a plain assignment would overwrite the loser.
  function checkNoOverwrite(a: Action): void {
    if (a.type === 'batch') {
      for (const x of a.actions) checkNoOverwrite(x);
      return;
    }
    const d = doc();
    if (a.type === 'element.create' && d.elements[a.el.id]) {
      fail('bad_field', `element ${a.el.id} already exists`);
    }
    if (a.type === 'board.create' && d.boards[a.board.id]) fail('bad_field', `board ${a.board.id} already exists`);
    if (a.type === 'label.create' && d.labels[a.label.id]) fail('bad_field', `label ${a.label.id} already exists`);
  }

  async function runPlanned(planned: Runner[]): Promise<unknown[]> {
    // Inside an outer group (a nested batch) the parent owns rollback.
    if (app.store.inGroup) {
      const flat: unknown[] = [];
      for (const r of planned) flat.push(await r());
      return flat;
    }
    guard();
    // An open edit session holds a store group; closing it first keeps
    // this batch a single undo entry and the abort undo-able.
    app.editing.endEdit();
    const before = dispatchCount;
    app.store.beginGroup();
    try {
      const out: unknown[] = [];
      for (const r of planned) out.push(await r());
      app.store.endGroup('agent');
      return out;
    } catch (e) {
      app.store.endGroup();
      if (dispatchCount > before) {
        app.store.undo();
        // The abort undo queues the partial batch as a redo entry; an
        // empty grouped dispatch clears future so it cannot replay.
        app.store.beginGroup();
        app.store.dispatch({ type: 'batch', actions: [] });
        app.store.endGroup();
      }
      throw e;
    }
  }

  function plan(method: string, params: unknown): Runner {
    switch (method) {
      case 'boards':
        return () =>
          Object.values(doc().boards).map((b) => ({
            id: b.id,
            title: b.title,
            parentId: b.parentId,
            icon: b.icon,
            color: b.color,
            grid: b.grid,
            position: b.position,
            presentOpts: b.presentOpts,
          }));
      case 'openBoard': {
        if (params !== null && typeof params === 'object') checkKeys(vObj(params, 'params'), new Set(['id']));
        const id = vBoardId(doc(), params !== null && typeof params === 'object' ? vObj(params, 'params').id : params);
        return () => {
          app.openBoard(id);
          return { ok: true };
        };
      }
      case 'state':
        return () => {
          const vp = app.vp;
          return {
            boardId: app.boardId,
            selection: [...app.sel],
            view: { x: (vp.vw / 2 - vp.x) / vp.z, y: (vp.vh / 2 - vp.y) / vp.z, z: vp.z },
            presenting: app.presenting,
            locked: app.lockedView(),
            connected: app.agentConnected,
          };
        };
      case 'labels': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId']));
        const bid = o.boardId === undefined ? null : vBoardId(doc(), o.boardId);
        return () =>
          Object.values(doc().labels)
            .filter((l) => bid === null || l.boardId === bid)
            .map((l) => ({ ...l }));
      }
      case 'search': {
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['query', 'boardId', 'all']));
        const q = vStr(o.query, 'query', 2048);
        const all = vBoolOpt(o.all, 'all') ?? false;
        const bid = o.boardId === undefined ? null : vBoardId(doc(), o.boardId);
        return async () => {
          const { searchBoard } = await import('../ui/search');
          const boards = all ? Object.keys(doc().boards) : [bid ?? requireBoard()];
          return boards.flatMap((b) => searchBoard(doc(), b, q));
        };
      }
      case 'elements': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId']));
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        return () => Object.values(doc().elements).filter((e) => e.boardId === bid).map(elView);
      }
      case 'get': {
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = vId(o.id, 'id');
        return () => {
          const el = doc().elements[id];
          return el ? elView(el) : null;
        };
      }
      case 'create': {
        guard();
        const o = vObj(params, 'params');
        const type = vStr(o.type, 'type', 32) as ElementType;
        if (!ELEMENT_TYPES.has(type)) fail('bad_type', `unknown card type ${type}`);
        const p: Dict = o.props === undefined ? { ...o } : { ...vObj(o.props, 'props') };
        delete p.type;
        checkProps(type, p, COMMON_PROPS);
        const built = buildElement(type, p);
        return () => {
          guard();
          dispatch(built.action);
          return { id: built.id };
        };
      }
      case 'patch': {
        guard();
        const o = vObj(params, 'params');
        const id = vId(o.id, 'id');
        const el = doc().elements[id];
        if (!el) fail('not_found', `no element ${id}`);
        const raw = o.patch === undefined ? { ...o } : { ...vObj(o.patch, 'patch') };
        delete raw.id;
        const contentKeys = TYPE_PROPS[el.type] ?? new Set<string>();
        const top: ElementPatch = {};
        const contentProps: Dict = {};
        const d = doc();
        // parentId and labels must resolve against the board the
        // element ends up on, which a same-patch boardId can move.
        const targetBoard = raw.boardId === undefined ? el.boardId : vBoardId(d, raw.boardId);
        for (const [k, v] of Object.entries(raw)) {
          if (PATCH_TOP.has(k)) {
            if (k === 'x' || k === 'y' || k === 'z') top[k] = vNum(v, k);
            else if (k === 'w') top.w = vWidth(v);
            else if (k === 'locked') top.locked = vBool(v, 'locked');
            else if (k === 'color') top.color = v === null ? undefined : vStr(v, 'color', 64);
            else if (k === 'anchorId') {
              if (v !== null && el.type !== 'comment') fail('bad_field', 'anchorId applies to comment elements');
              top.anchorId = v === null ? undefined : vElId(d, v, 'anchorId');
            } else if (k === 'boardId') top.boardId = vBoardId(d, v);
            else if (k === 'parentId') {
              const pid = vParentId(d, v, targetBoard);
              if (pid === id) fail('bad_field', 'parentId cannot be the element itself');
              top.parentId = pid;
            } else if (k === 'labels') top.labels = vLabels(d, v, targetBoard);
            else if (k === 'reactions') top.reactions = v === null ? undefined : vStrArray(v, 'reactions', 32);
            else if (k === 'syncGroup') top.syncGroup = v === null ? undefined : vId(v, 'syncGroup');
          } else if (contentKeys.has(k)) {
            contentProps[k] = v;
          } else {
            fail('bad_field', `unknown field ${k}`);
          }
        }
        if (Object.keys(contentProps).length) mergeContent(el, contentProps);
        return () => {
          guard();
          const cur = doc().elements[id];
          if (!cur) fail('not_found', `no element ${id}`);
          const patch: ElementPatch = { ...top };
          if (Object.keys(contentProps).length) {
            const m = mergeContent(cur, contentProps);
            patch.content = m.content;
            if (m.top) Object.assign(patch, m.top);
          }
          dispatch({ type: 'element.patch', id, patch });
          return { ok: true };
        };
      }
      case 'remove': {
        guard();
        const id = vId(vObj(params, 'params').id, 'id');
        if (!doc().elements[id]) fail('not_found', `no element ${id}`);
        return () => {
          guard();
          if (!doc().elements[id]) fail('not_found', `no element ${id}`);
          dispatchCount++;
          app.setSelection([id]);
          app.deleteSelection();
          return { ok: true };
        };
      }
      case 'connect': {
        guard();
        const o = vObj(params, 'params');
        const from = vElId(doc(), o.from, 'from');
        const to = vElId(doc(), o.to, 'to');
        const fa = doc().elements[from]!;
        const ta = doc().elements[to]!;
        if (fa.boardId !== ta.boardId) fail('bad_field', 'endpoints are on different boards');
        const opts: Dict = {};
        for (const k of Object.keys(o)) {
          if (k === 'label' || k === 'dashed' || k === 'weight' || k === 'fromMarker' || k === 'toMarker') opts[k] = o[k];
          else if (k !== 'from' && k !== 'to') fail('bad_field', `unknown field ${k}`);
        }
        return () => {
          guard();
          const a = doc().elements[from];
          const b = doc().elements[to];
          if (!a || !b) fail('not_found', 'endpoint element is gone');
          const ra = app.layer.rectOf(a);
          const rb = app.layer.rectOf(b);
          const el = createLine(
            doc(),
            a.boardId,
            { el: from, x: Math.round(ra.x + ra.w), y: Math.round(ra.y + ra.h / 2) },
            { el: to, x: Math.round(rb.x), y: Math.round(rb.y + rb.h / 2) },
          );
          el.content = mergeContent(el, opts).content;
          dispatch({ type: 'element.create', el });
          return { id: el.id };
        };
      }
      case 'trash':
        return () =>
          Object.entries(doc().trash).map(([id, e]) => ({ id, deletedAt: e.deletedAt, el: e.el }));
      case 'restore': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id', 'boardId', 'x', 'y']));
        const id = vId(o.id, 'id');
        if (!doc().trash[id]) fail('not_found', `no trash entry ${id}`);
        const boardId =
          o.boardId === undefined ? (app.boardId ?? doc().trash[id]!.el.boardId) : vBoardId(doc(), o.boardId);
        if (!doc().boards[boardId]) fail('not_found', `no board ${boardId}`);
        const x = vNumOpt(o.x, 'x');
        const y = vNumOpt(o.y, 'y');
        return () => {
          guard();
          const entry = doc().trash[id];
          if (!entry) fail('not_found', `no trash entry ${id}`);
          if (!doc().boards[boardId]) fail('not_found', `no board ${boardId}`);
          // Same fixups as the trash panel's drop-restore: dead or
          // foreign-board anchors/labels/syncGroups would hide the card.
          const el: Element = {
            ...entry.el,
            boardId,
            parentId: null,
            x: Math.round(x ?? entry.el.x),
            y: Math.round(y ?? entry.el.y),
            z: ++doc().seq,
          };
          if (el.anchorId !== undefined && doc().elements[el.anchorId]?.boardId !== boardId) {
            delete el.anchorId;
          }
          el.labels = el.labels.filter((l) => doc().labels[l]?.boardId === boardId);
          if (boardId !== entry.el.boardId) delete el.syncGroup;
          app.stampBoardColor(el);
          dispatch({ type: 'batch', actions: [{ type: 'element.create', el }, { type: 'trash.remove', id }] });
          app.setSelection([el.id]);
          return { id: el.id };
        };
      }
      case 'emptyTrash': {
        guard();
        return () => {
          guard();
          const ids = Object.keys(doc().trash);
          if (ids.length) {
            dispatch({ type: 'batch', actions: ids.map((id) => ({ type: 'trash.remove' as const, id })) });
          }
          return { removed: ids.length };
        };
      }
      case 'select': {
        const arr = Array.isArray(params) ? params : vObj(params ?? {}, 'params').ids;
        if (!Array.isArray(arr)) fail('bad_params', 'ids must be an array');
        const ids = arr.map((i) => vElId(doc(), i, 'ids[]'));
        return () => {
          app.setSelection(ids);
          return { selected: ids.length };
        };
      }
      case 'view': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['x', 'y', 'z']));
        const x = vNumOpt(o.x, 'x');
        const y = vNumOpt(o.y, 'y');
        const z = vNumOpt(o.z, 'z');
        return () => {
          const vp = app.vp;
          const zz = z === undefined ? vp.z : Math.min(4, Math.max(0.1, z));
          // x/y are the board point to center on; missing keeps the
          // current center.
          const cx = x ?? (vp.vw / 2 - vp.x) / vp.z;
          const cy = y ?? (vp.vh / 2 - vp.y) / vp.z;
          vp.z = zz;
          vp.x = vp.vw / 2 - cx * zz;
          vp.y = vp.vh / 2 - cy * zz;
          vp.changed();
          return {
            x: (vp.vw / 2 - vp.x) / vp.z,
            y: (vp.vh / 2 - vp.y) / vp.z,
            z: vp.z,
          };
        };
      }
      case 'present': {
        // Not mutating on purpose: a prevent-editing lock would
        // otherwise block the agent from leaving presentation mode.
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, PRESENT_KEYS);
        const on = vBoolOpt(o.on, 'on');
        const opts: PresentOpts = {};
        if (o.focus !== undefined) opts.focus = vBool(o.focus, 'focus');
        if (o.comments !== undefined) opts.comments = vBool(o.comments, 'comments');
        if (o.edit !== undefined) opts.edit = vBool(o.edit, 'edit');
        return () => {
          if (Object.keys(opts).length) app.setPresentOpts(opts);
          if (on === true) app.enterPresent();
          else if (on === false) app.exitPresent();
          const board = app.boardId ? doc().boards[app.boardId] : undefined;
          return { presenting: app.presenting, presentOpts: board?.presentOpts ?? {} };
        };
      }
      case 'undo':
        guard();
        return () => {
          guard();
          app.store.undo();
          return { ok: true };
        };
      case 'redo':
        guard();
        return () => {
          guard();
          app.store.redo();
          return { ok: true };
        };
      case 'duplicate': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['ids', 'dx', 'dy']));
        if (!Array.isArray(o.ids)) fail('bad_params', 'ids must be an array');
        const ids = o.ids.map((i) => vElId(doc(), i, 'ids[]'));
        const dx = vNumOpt(o.dx, 'dx') ?? 24;
        const dy = vNumOpt(o.dy, 'dy') ?? 24;
        return () => {
          guard();
          const els = ids.map((i) => doc().elements[i]).filter((e): e is Element => !!e);
          if (!els.length) fail('not_found', 'no elements left to duplicate');
          const rectOf = (t: Element) => app.layer.rectOf(t);
          const { clones } = remapElements(doc(), els, (e) => e.boardId, dx, dy, {
            resolveEnd: (e, which) => {
              const l = resolveLine(e, doc(), rectOf);
              if (!l) return null;
              return which === 'from' ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 };
            },
          });
          dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
          const top = clones.filter((c) => c.parentId === null);
          app.setSelection((top.length ? top : clones).map((c) => c.id));
          return { ids: clones.map((c) => c.id) };
        };
      }
      case 'snapshot': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId', 'x', 'y', 'w', 'h', 'scale']));
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const region =
          o.x !== undefined || o.y !== undefined || o.w !== undefined || o.h !== undefined
            ? { x: vNum(o.x, 'x'), y: vNum(o.y, 'y'), w: vNum(o.w, 'w'), h: vNum(o.h, 'h') }
            : undefined;
        if (region && (region.w <= 0 || region.h <= 0)) fail('bad_field', 'region w/h must be positive');
        const scale = Math.min(4, Math.max(0.1, vNumOpt(o.scale, 'scale') ?? 2));
        // Canvas caps around 32k px per side; refuse early rather than
        // crash the tab allocating a huge raster.
        if (region && Math.max(region.w, region.h) * scale > 16384) {
          fail('too_large', 'region exceeds the canvas limit');
        }
        return async () => {
          const blob = await app.exporter.snapshotPng(bid, region, scale);
          if (!blob) fail('snapshot', 'board snapshot failed');
          return { dataUrl: await blobToDataUrl(blob) };
        };
      }
      case 'templates':
        return () => [
          ...builtinTemplates().map((t) => ({ id: t.id, name: t.name, builtin: true, elements: t.elements.length })),
          ...Object.values(doc().templates).map((t) => ({
            id: t.id,
            name: t.name,
            builtin: false,
            elements: t.elements.length,
          })),
        ];
      case 'instantiate': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id', 'boardId', 'x', 'y']));
        const id = vId(o.id, 'id');
        const tpl = builtinTemplates().find((t) => t.id === id) ?? doc().templates[id];
        if (!tpl) fail('not_found', `no template ${id}`);
        const hostId =
          o.boardId === undefined ? app.boardId : o.boardId === null ? null : vBoardId(doc(), o.boardId);
        const center = app.vp.toBoard(app.vp.vw / 2, app.vp.vh / 2);
        const at = { x: vNumOpt(o.x, 'x') ?? center.x, y: vNumOpt(o.y, 'y') ?? center.y };
        return () => {
          guard();
          const { actions, boardId, cardId } = instantiateActions(doc(), tpl, hostId, at);
          dispatch({ type: 'batch', actions });
          if (hostId === null) app.openBoard(boardId);
          return { boardId, cardId };
        };
      }
      case 'saveTemplate': {
        guard();
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId', 'name']));
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const name = vStrOpt(o.name, 'name', 256) ?? '';
        return () => {
          guard();
          const tpl = snapshotTemplate(doc(), bid, name);
          if (!tpl) fail('no_board', 'no such board');
          dispatch({ type: 'template.create', tpl });
          return { id: tpl.id, name: tpl.name };
        };
      }
      case 'upload': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['data', 'name', 'mime', 'boardId', 'parentId', 'x', 'y', 'caption']));
        const data = vStr(o.data, 'data', 48 * 1024 * 1024);
        const name = vStrOpt(o.name, 'name', 512);
        const mime = vStrOpt(o.mime, 'mime', 128);
        const boardId = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const parentId = o.parentId === undefined ? null : vParentId(doc(), o.parentId, boardId);
        const center = app.vp.toBoard(app.vp.vw / 2, app.vp.vh / 2);
        const x = Math.round(vNumOpt(o.x, 'x') ?? center.x);
        const y = Math.round(vNumOpt(o.y, 'y') ?? center.y);
        const caption = vStrOpt(o.caption, 'caption');
        return async () => {
          guard();
          const blob = b64ToBlob(data, mime);
          let el: Element | null = null;
          if (blob.type.startsWith('image/')) {
            try {
              const { prepareImage } = await import('../ui/files');
              const { blob: baked, aspect, natW, natH } = await prepareImage(blob);
              const ref = uid();
              await app.blobStore.put(ref, baked);
              el = createImage(doc(), boardId, x, y, ref, name ?? 'image', aspect, natW, natH);
            } catch {
              el = null; // undecodable image falls back to a file card
            }
          }
          if (!el) {
            const ref = uid();
            try {
              await app.blobStore.put(ref, blob);
            } catch {
              fail('blob', 'blob store rejected the upload');
            }
            el = createFile(doc(), boardId, x, y, ref, name ?? 'file', blob.size, blob.type);
          }
          el.parentId = parentId;
          app.stampBoardColor(el);
          if (caption !== undefined) el.content = mergeContent(el, { caption }).content;
          dispatch({ type: 'element.create', el });
          app.setSelection([el.id]);
          return { id: el.id, type: el.type };
        };
      }
      case 'export': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['format', 'boardId', 'subs', 'hi']));
        const format = vEnum(o.format, 'format', EXPORT_FORMATS);
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const subs = vBoolOpt(o.subs, 'subs') ?? false;
        const hi = vBoolOpt(o.hi, 'hi') ?? false;
        return async () => {
          const { slugFileName } = await import('../export/download');
          const base = slugFileName(doc().boards[bid]?.title ?? 'board');
          if (format === 'png') {
            const blob = await app.exporter.snapshotPng(bid);
            if (!blob) fail('export', 'png export failed');
            return { name: `${base}.png`, mime: 'image/png', dataUrl: await blobToDataUrl(blob) };
          }
          if (format === 'pdf') {
            const scale = hi ? 2 : 1;
            if (bid !== app.boardId) app.openBoard(bid);
            const cv = await app.exporter.boardRaster(scale);
            const { toBlob } = await import('../export/boardpng');
            const blob = cv && (await toBlob(cv, 'image/jpeg', hi ? 0.95 : 0.8));
            if (!cv || !blob) fail('export', 'pdf export failed');
            const jpeg = new Uint8Array(await blob.arrayBuffer());
            const { jpegToPdf } = await import('../export/pdf');
            const pdf = jpegToPdf(jpeg, cv.width, cv.height, (cv.width / scale) * 0.75, (cv.height / scale) * 0.75);
            return { name: `${base}.pdf`, mime: 'application/pdf', dataUrl: await blobToDataUrl(pdf) };
          }
          if (format === 'md' || format === 'txt' || format === 'doc') {
            const { boardItems, toMarkdown, toPlain, toWordHtml } = await import('../export/linear');
            const title = doc().boards[bid]?.title ?? '';
            const items = boardItems(doc(), bid, subs);
            const text = format === 'md' ? toMarkdown(title, items) : format === 'txt' ? toPlain(title, items) : toWordHtml(title, items);
            const ext = format === 'doc' ? 'doc' : format;
            const mime = format === 'md' ? 'text/markdown' : format === 'txt' ? 'text/plain' : 'application/msword';
            return { name: `${base}.${ext}`, mime, text };
          }
          if (format === 'json') {
            const { exportBoard } = await import('../export/jsonio');
            const text = exportBoard(doc(), bid);
            if (!text) fail('export', 'json export failed');
            return { name: `${base}.json`, mime: 'application/json', text };
          }
          const blob = await app.exporter.mediaZip(bid);
          if (!blob) fail('export', 'board has no media to zip');
          return { name: `${base}-files.zip`, mime: 'application/zip', dataUrl: await blobToDataUrl(blob) };
        };
      }
      case 'import': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['data', 'boardId']));
        const data = vStr(o.data, 'data', 16 * 1024 * 1024);
        const hostId = o.boardId === undefined ? null : vBoardId(doc(), o.boardId);
        return async () => {
          guard();
          const { parseBoardExport, importActions } = await import('../export/jsonio');
          const parsed = parseBoardExport(data);
          const host =
            hostId ??
            doc().boards.home?.id ??
            Object.values(doc().boards).find((b) => b.parentId === null)?.id ??
            app.boardId;
          const res = parsed && host ? importActions(doc(), parsed, host) : null;
          if (!res) fail('bad_payload', 'data is not a board export, or no host board exists');
          dispatch({ type: 'batch', actions: res.actions });
          app.openBoard(res.boardId);
          return { boardId: res.boardId };
        };
      }
      case 'unfurl': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = vElId(doc(), o.id, 'id');
        return async () => {
          guard();
          const el = doc().elements[id];
          if (!el) fail('not_found', `no element ${id}`);
          const link = linkDoc(el);
          const embed = embedDoc(el);
          const url = link?.url ?? embed?.url;
          if (!url) fail('bad_field', 'element is not a link/embed card with a url');
          // Links honour the user's online-extra pref; embeds enrich
          // without it (creating one already opted into the provider).
          if (link && app.prefs.unfurl === false) return { ok: false, reason: 'link unfurl is disabled in settings' };
          if (!navigator.onLine) return { ok: false, reason: 'offline' };
          const { fetchLinkPreview } = await import('../ui/unfurl');
          const res = await fetchLinkPreview(url);
          if (!res) return { ok: false, reason: 'no preview returned' };
          if (link) {
            dispatch({
              type: 'element.patch',
              id,
              patch: {
                content: {
                  link: {
                    ...link,
                    title: autoTitled(link.title, url) ? (res.title ?? link.title) : link.title,
                    ...(res.desc !== undefined ? { desc: res.desc } : {}),
                    ...(res.image !== undefined ? { image: res.image } : {}),
                  },
                },
              },
            });
          } else if (embed && res.title && autoTitled(embed.title, url)) {
            dispatch({ type: 'element.patch', id, patch: { content: { embed: { ...embed, title: res.title } } } });
          }
          return { ok: true, title: res.title, desc: res.desc, image: res.image };
        };
      }
      case 'batch': {
        guard();
        const list = Array.isArray(params) ? params : vObj(params, 'params').commands;
        if (!Array.isArray(list)) fail('bad_params', 'commands must be an array');
        const planned = list.map((c) => {
          const cmd = parseCommand(c);
          return plan(cmd.method, cmd.params);
        });
        return () => runPlanned(planned);
      }
      case 'dispatch': {
        guard();
        const o = vObj(params, 'params');
        const action = vAction('type' in o ? o : o.action, 0);
        return () => {
          guard();
          checkNoOverwrite(action);
          dispatch(action);
          return { ok: true };
        };
      }
      default:
        fail('unknown_method', `no command ${method}`);
    }
  }

  return {
    async run(method: string, params?: unknown): Promise<unknown> {
      if (MUTATING.has(method)) guard();
      return plan(method, params)();
    },
    // Plan every command first, then run them inside one store group:
    // a bad command aborts everything, a good list is one undo entry.
    async runCommands(commands: AgentCommand[]): Promise<unknown[]> {
      const planned = commands.map((c) => {
        if (MUTATING.has(c.method)) guard();
        return plan(c.method, c.params);
      });
      return runPlanned(planned);
    },
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
