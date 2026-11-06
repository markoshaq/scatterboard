import type { Action, ElementPatch } from '../state/actions';
import {
  createAnnotation,
  createBoard,
  createBoardCard,
  createColumn,
  createComment,
  createDocument,
  createEmbed,
  createHeading,
  createLink,
  createLine,
  createNote,
  createSketch,
  createSwatch,
  createTable,
  createTodo,
  strokesBBox,
  uid,
  type CellType,
  type Doc,
  type Element,
  type ElementType,
  type EmbedKind,
  type ID,
  type LineMarker,
  type LineRoute,
  type LineWeight,
  type RecurFreq,
  type TableCell,
  type TodoItem,
  type TypeContent,
} from '../state/schema';
import { t } from '../strings';
import {
  fail,
  vAnchorId,
  vBoardId,
  vBool,
  vBoolOpt,
  vEnum,
  vHtml,
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
import type { AgentHost } from './api';

const EMBED_KINDS = new Set(['audio', 'map', 'video']);
const LINE_MARKERS = new Set(['none', 'arrow', 'dot']);
const LINE_WEIGHTS = new Set(['thin', 'medium', 'thick']);
const LINE_ROUTES = new Set(['straight', 'elbow']);
const CELL_TYPES = new Set(['auto', 'number', 'currency', 'percent', 'text', 'datetime', 'checkbox']);
const ALIGNS_H = new Set(['left', 'center', 'right']);
const ALIGNS_V = new Set(['top', 'middle', 'bottom']);
const RECUR_FREQS = new Set(['day', 'week', 'month', 'year']);

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
    if (o.recur !== undefined) {
      const r = vObj(o.recur, 'items[].recur');
      const f = vEnum<RecurFreq>(r.f, 'items[].recur.f', RECUR_FREQS);
      const n = r.n === undefined ? 1 : vNum(r.n, 'items[].recur.n');
      if (n < 1) fail('bad_field', 'items[].recur.n must be >= 1');
      it.recur = { f, n };
    }
    if (o.assignee !== undefined) {
      if (o.assignee !== 'self') fail('bad_field', 'assignee must be "self"');
      it.assignee = 'self';
    }
    if (o.reactions !== undefined) it.reactions = vStrArray(o.reactions, 'items[].reactions', 32);
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

// Applies the friendly content props to a copy of the element's
// content. Also validates them: unknown keys already failed upstream,
// bad values fail here. `top` carries element-field side effects
// (annotation strokes re-origin the element), `extra` whole other
// actions (a board card's title belongs to the board record).
export function mergeContent(d: Doc, el: Element, p: Dict): { content: TypeContent; top?: ElementPatch; extra?: Action[] } {
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
    const extra: Action[] = [];
    // The card shows the board's title: patching it edits the board.
    if (p.title !== undefined) {
      extra.push({ type: 'board.patch', id: c.boardRef, patch: { title: vStr(p.title, 'title') } });
    }
    return {
      content: p.ref !== undefined ? { boardRef: vBoardId(d, p.ref) } : c,
      ...(extra.length ? { extra } : {}),
    };
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
    if (p.from !== undefined) line.from = vLineEnd(d, p.from, 'from', el.boardId);
    if (p.to !== undefined) line.to = vLineEnd(d, p.to, 'to', el.boardId);
    if (p.label !== undefined) line.label = vStr(p.label, 'label', 4096);
    if (p.dashed !== undefined) line.dashed = vBool(p.dashed, 'dashed');
    if (p.weight !== undefined) line.weight = vEnum<LineWeight>(p.weight, 'weight', LINE_WEIGHTS);
    if (p.fromMarker !== undefined) line.fromMarker = vEnum<LineMarker>(p.fromMarker, 'fromMarker', LINE_MARKERS);
    if (p.toMarker !== undefined) line.toMarker = vEnum<LineMarker>(p.toMarker, 'toMarker', LINE_MARKERS);
    if (p.route !== undefined) line.route = vEnum<LineRoute>(p.route, 'route', LINE_ROUTES);
    return { content: { line } };
  }
  if ('comment' in c) {
    let items = c.comment.items;
    if (p.items !== undefined) items = vCommentItems(p.items);
    if (p.add !== undefined) {
      items = [...items, { id: uid(), text: vStr(p.add, 'add', 8192), createdAt: Date.now() }];
    }
    if (p.text !== undefined && p.items === undefined) {
      // 'text' names the thread's first comment, matching create.
      const text = vStr(p.text, 'text', 8192);
      items = items.length
        ? [{ ...items[0]!, text }, ...items.slice(1)]
        : [{ id: uid(), text, createdAt: Date.now() }];
    }
    const top: ElementPatch = {};
    if (p.anchor !== undefined) {
      top.anchorId = p.anchor === null ? undefined : vAnchorId(d, p.anchor, el.boardId);
    }
    return { content: { comment: { items } }, ...(Object.keys(top).length ? { top } : {}) };
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
    if (p.alt !== undefined) {
      if (p.alt === null) delete image.alt;
      else image.alt = vStr(p.alt, 'alt', 4096);
    }
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
    if (p.widths !== undefined) {
      if (p.widths === null) delete table.widths;
      else {
        if (!Array.isArray(p.widths)) fail('bad_field', 'widths must be an array');
        table.widths = p.widths.map((w) => vNum(w, 'widths[]'));
      }
    }
    return { content: { table } };
  }
  return { content: c };
}

export function buildElement(
  ctx: { app: AgentHost; requireBoard(): ID },
  type: ElementType,
  p: Dict,
): { id: ID; action: Action } {
  const app = ctx.app;
  const d = app.doc;
  const boardId = p.boardId === undefined ? ctx.requireBoard() : vBoardId(d, p.boardId);
  const center = app.vp.toBoard(app.vp.vw / 2, app.vp.vh / 2);
  const x = Math.round(vNumOpt(p.x, 'x') ?? center.x);
  const y = Math.round(vNumOpt(p.y, 'y') ?? center.y);
  const parentId = p.parentId === undefined ? null : vParentId(d, p.parentId, boardId);
  let el: Element;
  const actions: Action[] = [];
  switch (type) {
    case 'note': {
      el = createNote(d, boardId, x, y, vStrOpt(p.text, 'text') ?? '');
      if (p.html !== undefined) el.content = mergeContent(d, el, p).content;
      break;
    }
    case 'heading': {
      const level = p.level === undefined ? 1 : vNum(p.level, 'level') === 2 ? 2 : 1;
      el = createHeading(d, boardId, x, y, level);
      el.content = mergeContent(d, el, p).content;
      break;
    }
    case 'column':
      el = createColumn(d, boardId, x, y, vStrOpt(p.title, 'title') ?? '');
      break;
    case 'board': {
      if (p.ref !== undefined) {
        el = createBoardCard(d, boardId, vBoardId(d, p.ref), x, y);
      } else {
        const board = createBoard({ parentId: boardId, title: vStrOpt(p.title, 'title') ?? t('untitled') });
        actions.push({ type: 'board.create', board });
        el = createBoardCard(d, boardId, board.id, x, y);
      }
      break;
    }
    case 'todo': {
      el = createTodo(d, boardId, x, y);
      el.content = mergeContent(d, el, p).content;
      if (p.title !== undefined && p.showTitle === undefined && 'todo' in el.content) {
        el.content.todo.showTitle = true;
      }
      break;
    }
    case 'swatch': {
      el = createSwatch(d, boardId, x, y, vStrOpt(p.value ?? p.color, 'value', 64) ?? '#3d84e0');
      el.content = mergeContent(d, el, p).content;
      break;
    }
    case 'line': {
      if (p.from === undefined || p.to === undefined) fail('bad_params', 'line needs from and to');
      el = createLine(d, boardId, vLineEnd(d, p.from, 'from', boardId), vLineEnd(d, p.to, 'to', boardId));
      el.content = mergeContent(d, el, p).content;
      break;
    }
    case 'comment': {
      const anchor = p.anchorId ?? p.anchor;
      el = createComment(d, boardId, x, y, anchor === undefined ? undefined : vAnchorId(d, anchor, boardId));
      if (p.text !== undefined && p.items === undefined) {
        p = { ...p, items: [{ text: p.text }] };
      }
      el.content = mergeContent(d, el, p).content;
      break;
    }
    case 'link':
      el = createLink(d, boardId, x, y, vUrlOpt(p.url, 'url') ?? '');
      el.content = mergeContent(d, el, p).content;
      break;
    case 'embed': {
      const kind = p.kind === undefined ? 'video' : vEnum<EmbedKind>(p.kind, 'kind', EMBED_KINDS);
      el = createEmbed(d, boardId, kind, x, y);
      el.content = mergeContent(d, el, p).content;
      break;
    }
    case 'document':
      el = createDocument(d, boardId, x, y);
      el.content = mergeContent(d, el, p).content;
      break;
    case 'sketch':
      el = createSketch(d, boardId, x, y);
      el.content = mergeContent(d, el, p).content;
      break;
    case 'annotation': {
      const strokes = vStrokes(p.strokes ?? fail('bad_params', 'annotation needs strokes'));
      if (!strokes.length) fail('bad_field', 'annotation needs at least one stroke');
      el = createAnnotation(d, boardId, strokes);
      break;
    }
    case 'table': {
      el = createTable(d, boardId, x, y);
      el.content = mergeContent(d, el, p).content;
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
