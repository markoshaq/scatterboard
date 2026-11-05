export type ID = string;

// Per-board presentation toggles (View menu): direct mutation +
// scheduleSave like board.position; not undoable.
export interface PresentOpts {
  focus?: boolean;
  comments?: boolean;
  edit?: boolean;
}

export interface Board {
  id: ID;
  title: string;
  icon?: string;
  color?: string;
  parentId: ID | null;
  position?: { x: number; y: number; z: number };
  grid: boolean;
  presentOpts?: PresentOpts;
  createdAt: number;
  modifiedAt: number;
}

export type ElementType =
  | 'note'
  | 'column'
  | 'board'
  | 'todo'
  | 'heading'
  | 'swatch'
  | 'line'
  | 'comment'
  | 'link'
  | 'embed'
  | 'image'
  | 'file'
  | 'document'
  | 'sketch'
  | 'annotation'
  | 'table';

export const UNSORTED: ID = 'unsorted';

interface NoteDoc {
  text: string;
  html?: string;
}

interface ColumnDoc {
  title: string;
}

export interface TodoItem {
  id: ID;
  text: string;
  done: boolean;
  dueAt?: number;
  // Whether dueAt's clock part is meaningful: day-only dues show no time.
  dueTime?: boolean;
  assignee?: 'self';
  reactions?: string[];
}

export interface TodoDoc {
  title: string;
  showTitle: boolean;
  items: TodoItem[];
}

interface HeadingDoc {
  text: string;
  level: 1 | 2;
  html?: string;
}

interface SwatchDoc {
  color: string;
  caption: string;
  showValue: boolean;
}

export type LineMarker = 'none' | 'arrow' | 'dot';
export type LineWeight = 'thin' | 'medium' | 'thick';

export interface LineEnd {
  el?: ID;
  x: number;
  y: number;
}

interface LineDoc {
  from: LineEnd;
  to: LineEnd;
  fromMarker: LineMarker;
  toMarker: LineMarker;
  dashed: boolean;
  weight: LineWeight;
  label: string;
}

export interface CommentItem {
  id: ID;
  text: string;
  createdAt: number;
  editedAt?: number;
}

interface CommentDoc {
  items: CommentItem[];
}

interface LinkDoc {
  url: string;
  title: string;
  caption: string;
  showPreview: boolean;
  // Optional unfurled preview fields (online extra): remote image URL
  // and a short description. Stored verbatim, no blob download.
  desc?: string;
  image?: string;
}

export type EmbedKind = 'audio' | 'map' | 'video';

interface EmbedDoc {
  kind: EmbedKind;
  url: string;
  title: string;
  caption: string;
  showPreview: boolean;
}

// natW/natH = stored blob's pixel size; draw-on strokes live in that
// natural space and render via an svg viewBox, like the sketch card.
// Crop/rotate/flip and background removal bake a new blob instead of
// storing parameters.
export interface ImageDoc {
  blobRef: ID;
  name: string;
  caption: string;
  aspect: number;
  source?: string;
  natW?: number;
  natH?: number;
  strokes?: Stroke[];
}

interface FileDoc {
  blobRef: ID;
  name: string;
  size: number;
  mime: string;
  ext: string;
}

type DocDisplayMode = 'icon' | 'detail';

export interface DocumentDoc {
  title: string;
  text: string;
  html?: string;
  displayMode: DocDisplayMode;
  caption: string;
}

export interface Stroke {
  pts: [number, number][];
  color: string;
  size: number;
  // Per-point widths for the ink effect (pressure/velocity pen); when
  // present it must match pts in length and rendering uses it instead
  // of a constant stroke-width.
  widths?: number[];
}

// Sketch strokes live in a fixed 600x450 editor space.
export interface SketchDoc {
  strokes: Stroke[];
}

// Annotation strokes live in board space, relative to element x/y
// (the stroke bbox origin).
interface AnnotationDoc {
  strokes: Stroke[];
}

export type CellType = 'auto' | 'number' | 'currency' | 'percent' | 'text' | 'datetime' | 'checkbox';
type CellAlignH = 'left' | 'center' | 'right';
type CellAlignV = 'top' | 'middle' | 'bottom';

// A formula is stored as text starting with '='; the computed value
// renders in place of the raw text outside edit mode.
export interface TableCell {
  text: string;
  html?: string;
  type?: CellType;
  alignH?: CellAlignH;
  alignV?: CellAlignV;
  color?: string;
}

// cells[row][col], always a non-empty rectangular grid. widths, when
// present, is one css-px width per column (same length as a row).
export interface TableDoc {
  title: string;
  caption: string;
  cells: TableCell[][];
  widths?: number[];
}

export type TypeContent =
  | { note: NoteDoc }
  | { column: ColumnDoc }
  | { boardRef: ID }
  | { todo: TodoDoc }
  | { heading: HeadingDoc }
  | { swatch: SwatchDoc }
  | { line: LineDoc }
  | { comment: CommentDoc }
  | { link: LinkDoc }
  | { embed: EmbedDoc }
  | { image: ImageDoc }
  | { file: FileDoc }
  | { document: DocumentDoc }
  | { sketch: SketchDoc }
  | { annotation: AnnotationDoc }
  | { table: TableDoc };

export interface Element {
  id: ID;
  boardId: ID;
  type: ElementType;
  parentId: ID | null;
  x: number;
  y: number;
  w?: number;
  z: number;
  locked: boolean;
  color?: string;
  anchorId?: ID;
  // Synced note copies: elements sharing a group id keep their note
  // content identical on the same board.
  syncGroup?: ID;
  content: TypeContent;
  labels: ID[];
  reactions?: string[];
  createdAt: number;
  modifiedAt: number;
}

export interface Label {
  id: ID;
  boardId: ID;
  name: string;
  color: string;
}

export interface TrashEntry {
  el: Element;
  deletedAt: number;
}

// A template is a named snapshot of one board: its fields plus the
// elements and labels that lived on it. blobRefs are kept verbatim
// (same device, same IndexedDB store).
export interface Template {
  id: ID;
  name: string;
  board: Board;
  elements: Element[];
  labels: Label[];
  createdAt: number;
}

export interface Doc {
  boards: Record<ID, Board>;
  elements: Record<ID, Element>;
  labels: Record<ID, Label>;
  trash: Record<ID, TrashEntry>;
  templates: Record<ID, Template>;
  seq: number;
}

export const GRID = 40;
export const NOTE_W = 240;
export const NOTE_MIN_W = 140;
export const NOTE_MAX_W = 800;
const COLUMN_W = 280;
const BOARD_CARD_W = 210;
const SWATCH_W = 200;
export const LINK_W = 280;
export const IMAGE_W = 240;
const FILE_W = 190;
export const DOC_W = 280;
export const SKETCH_W = 280;
const TABLE_W = 300;
export const SKETCH_PAD_W = 600;
export const SKETCH_PAD_H = 450;
const DEFAULT_SWATCH = '#3d84e0';

export function uid(): ID {
  return crypto.randomUUID().slice(0, 8) + Date.now().toString(36).slice(-4);
}

export function emptyDoc(): Doc {
  return { boards: {}, elements: {}, labels: {}, trash: {}, templates: {}, seq: 0 };
}

// Defaults for fields added after persisted version 1 was written.
export function migrateDoc(doc: Doc): Doc {
  doc.boards ??= {};
  doc.elements ??= {};
  // Persisted v1 docs may still carry the removed comments record.
  delete (doc as { comments?: unknown }).comments;
  doc.labels ??= {};
  doc.trash ??= {};
  doc.templates ??= {};
  let maxZ = 0;
  for (const el of Object.values(doc.elements)) {
    el.labels ??= [];
    // Canvas membership is parentId === null: an undefined parentId
    // would silently vanish the element into a bucket nobody renders.
    el.parentId ??= null;
    if (el.z > maxZ) maxZ = el.z;
  }
  for (const t of Object.values(doc.trash)) {
    t.el.labels ??= [];
    t.el.parentId ??= null;
    if (t.el.z > maxZ) maxZ = t.el.z;
  }
  for (const tpl of Object.values(doc.templates)) {
    for (const el of tpl.elements) {
      el.labels ??= [];
      el.parentId ??= null;
    }
  }
  doc.seq = Math.max(doc.seq ?? 0, maxZ);
  return doc;
}

// Every take on "new top z" goes through here: the doc-level counter
// is a sanctioned direct mutation (like board.position), never undone.
export function nextZ(doc: Doc): number {
  return ++doc.seq;
}

// Where a delete, import or boot lands when the intended board is gone:
// 'home' when it survives, else the first surviving root board in
// createdAt order, else `fallback`, else any board still alive.
export function survivingBoard(doc: Doc, dead: Set<ID> = new Set(), fallback?: ID | null): ID | null {
  const alive = (id: ID | null | undefined): id is ID =>
    id !== null && id !== undefined && !dead.has(id) && doc.boards[id] !== undefined;
  if (alive('home')) return 'home';
  const root = Object.values(doc.boards)
    .filter((b) => b.parentId === null && !dead.has(b.id))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (root) return root.id;
  if (alive(fallback)) return fallback;
  return Object.values(doc.boards).find((b) => !dead.has(b.id))?.id ?? null;
}

// Element types that own a dedicated full-screen editor route (#/e/<id>).
export const EDITOR_TYPES: ReadonlySet<ElementType> = new Set(['document', 'sketch', 'image']);

export function createBoard(partial: Partial<Board> & { title: string }): Board {
  const now = Date.now();
  return {
    id: uid(),
    parentId: null,
    grid: true,
    createdAt: now,
    modifiedAt: now,
    ...partial,
  };
}

function baseElement(doc: Doc, boardId: ID, type: ElementType, x: number, y: number, content: TypeContent): Element {
  const now = Date.now();
  return {
    id: uid(),
    boardId,
    type,
    parentId: null,
    x,
    y,
    z: nextZ(doc),
    locked: false,
    content,
    labels: [],
    createdAt: now,
    modifiedAt: now,
  };
}

export function createNote(doc: Doc, boardId: ID, x: number, y: number, text = ''): Element {
  return { ...baseElement(doc, boardId, 'note', x, y, { note: { text } }), w: NOTE_W };
}

export function createColumn(doc: Doc, boardId: ID, x: number, y: number, title = ''): Element {
  return { ...baseElement(doc, boardId, 'column', x, y, { column: { title } }), w: COLUMN_W };
}

export function createBoardCard(doc: Doc, boardId: ID, refId: ID, x: number, y: number): Element {
  return { ...baseElement(doc, boardId, 'board', x, y, { boardRef: refId }), w: BOARD_CARD_W };
}

export function createTodo(doc: Doc, boardId: ID, x: number, y: number): Element {
  const content: TypeContent = {
    todo: { title: '', showTitle: false, items: [{ id: uid(), text: '', done: false }] },
  };
  return { ...baseElement(doc, boardId, 'todo', x, y, content), w: NOTE_W };
}

export function createHeading(doc: Doc, boardId: ID, x: number, y: number, level: 1 | 2 = 1): Element {
  return { ...baseElement(doc, boardId, 'heading', x, y, { heading: { text: '', level } }), w: NOTE_W };
}

export function createSwatch(doc: Doc, boardId: ID, x: number, y: number, color = DEFAULT_SWATCH): Element {
  const content: TypeContent = { swatch: { color, caption: '', showValue: true } };
  return { ...baseElement(doc, boardId, 'swatch', x, y, content), w: SWATCH_W };
}

export function createLine(doc: Doc, boardId: ID, from: LineEnd, to: LineEnd): Element {
  const content: TypeContent = {
    line: {
      from,
      to,
      fromMarker: 'none',
      toMarker: 'arrow',
      dashed: false,
      weight: 'medium',
      label: '',
    },
  };
  return baseElement(doc, boardId, 'line', Math.min(from.x, to.x), Math.min(from.y, to.y), content);
}

export function createComment(doc: Doc, boardId: ID, x: number, y: number, anchorId?: ID): Element {
  const el = baseElement(doc, boardId, 'comment', x, y, { comment: { items: [] } });
  el.w = 260;
  if (anchorId !== undefined) el.anchorId = anchorId;
  return el;
}

export function createLink(doc: Doc, boardId: ID, x: number, y: number, url = ''): Element {
  const content: TypeContent = { link: { url, title: '', caption: '', showPreview: true } };
  return { ...baseElement(doc, boardId, 'link', x, y, content), w: LINK_W };
}

export function createEmbed(doc: Doc, boardId: ID, kind: EmbedKind, x: number, y: number): Element {
  const content: TypeContent = { embed: { kind, url: '', title: '', caption: '', showPreview: true } };
  return { ...baseElement(doc, boardId, 'embed', x, y, content), w: LINK_W };
}

export function createImage(
  doc: Doc,
  boardId: ID,
  x: number,
  y: number,
  blobRef: ID,
  name: string,
  aspect: number,
  natW?: number,
  natH?: number,
): Element {
  const image: ImageDoc = { blobRef, name, caption: '', aspect };
  if (natW !== undefined && natH !== undefined) {
    image.natW = natW;
    image.natH = natH;
  }
  const content: TypeContent = { image };
  return { ...baseElement(doc, boardId, 'image', x, y, content), w: IMAGE_W };
}

export function createFile(doc: Doc, boardId: ID, x: number, y: number, blobRef: ID, name: string, size: number, mime: string): Element {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const content: TypeContent = { file: { blobRef, name, size, mime, ext } };
  return { ...baseElement(doc, boardId, 'file', x, y, content), w: FILE_W };
}

export function createDocument(doc: Doc, boardId: ID, x: number, y: number): Element {
  const content: TypeContent = {
    document: { title: '', text: '', displayMode: 'icon', caption: '' },
  };
  return { ...baseElement(doc, boardId, 'document', x, y, content), w: DOC_W };
}

export function createSketch(doc: Doc, boardId: ID, x: number, y: number): Element {
  const content: TypeContent = { sketch: { strokes: [] } };
  return { ...baseElement(doc, boardId, 'sketch', x, y, content), w: SKETCH_W };
}

export function createTable(doc: Doc, boardId: ID, x: number, y: number): Element {
  const cells: TableCell[][] = [];
  for (let r = 0; r < 4; r++) cells.push(Array.from({ length: 3 }, () => ({ text: '' })));
  const content: TypeContent = { table: { title: '', caption: '', cells } };
  return { ...baseElement(doc, boardId, 'table', x, y, content), w: TABLE_W };
}

// Strokes arrive in board coords; the element origin is their bbox min
// and stored pts are relative to it.
export function createAnnotation(doc: Doc, boardId: ID, strokes: Stroke[]): Element {
  const box = strokesBBox(strokes);
  const rel = strokes.map((s) => ({
    ...s,
    pts: s.pts.map(([px, py]): [number, number] => [px - box.x, py - box.y]),
  }));
  const el = baseElement(doc, boardId, 'annotation', Math.round(box.x), Math.round(box.y), {
    annotation: { strokes: rel },
  });
  el.w = Math.max(1, Math.round(box.w));
  return el;
}

const bboxCache = new WeakMap<Stroke[], { x: number; y: number; w: number; h: number }>();

// Strokes are replaced wholesale on content patches, so identity is a
// safe memo key: layer.heightOf and the annotation overlay both hit
// this per render pass.
export function strokesBBoxCached(strokes: Stroke[]): { x: number; y: number; w: number; h: number } {
  let box = bboxCache.get(strokes);
  if (!box) {
    box = strokesBBox(strokes);
    bboxCache.set(strokes, box);
  }
  return box;
}

export function strokesBBox(strokes: Stroke[]): { x: number; y: number; w: number; h: number } {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const s of strokes) {
    const maxW = s.widths?.length ? Math.max(s.size, ...s.widths) : s.size;
    const pad = maxW / 2;
    for (const [px, py] of s.pts) {
      x1 = Math.min(x1, px - pad);
      y1 = Math.min(y1, py - pad);
      x2 = Math.max(x2, px + pad);
      y2 = Math.max(y2, py + pad);
    }
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function createLabel(boardId: ID, name: string, color: string): Label {
  return { id: uid(), boardId, name, color };
}

export function boardElements(doc: Doc, boardId: ID): Element[] {
  return Object.values(doc.elements).filter((e) => e.boardId === boardId && e.parentId === null);
}

export function columnMembers(doc: Doc, columnId: ID): Element[] {
  return Object.values(doc.elements)
    .filter((e) => e.parentId === columnId)
    .sort((a, b) => a.z - b.z);
}

export function boardCardCount(doc: Doc, boardId: ID): number {
  let n = 0;
  for (const e of Object.values(doc.elements)) if (e.boardId === boardId) n++;
  return n;
}

export function defaultWidth(el: Element): number {
  if (el.type === 'column') return COLUMN_W;
  if (el.type === 'board') return BOARD_CARD_W;
  if (el.type === 'swatch') return SWATCH_W;
  if (el.type === 'link' || el.type === 'embed') return LINK_W;
  if (el.type === 'file') return FILE_W;
  if (el.type === 'document') return DOC_W;
  if (el.type === 'sketch') return SKETCH_W;
  if (el.type === 'table') return TABLE_W;
  return NOTE_W;
}

export function noteText(el: Element): string {
  return 'note' in el.content ? el.content.note.text : '';
}

export function columnTitle(el: Element): string {
  return 'column' in el.content ? el.content.column.title : '';
}

export function boardRefOf(el: Element): ID | null {
  return 'boardRef' in el.content ? el.content.boardRef : null;
}

export function todoDoc(el: Element): TodoDoc | null {
  return 'todo' in el.content ? el.content.todo : null;
}

export function headingDoc(el: Element): HeadingDoc | null {
  return 'heading' in el.content ? el.content.heading : null;
}

export function swatchDoc(el: Element): SwatchDoc | null {
  return 'swatch' in el.content ? el.content.swatch : null;
}

export function lineDoc(el: Element): LineDoc | null {
  return 'line' in el.content ? el.content.line : null;
}

export function commentDoc(el: Element): CommentDoc | null {
  return 'comment' in el.content ? el.content.comment : null;
}

export function linkDoc(el: Element): LinkDoc | null {
  return 'link' in el.content ? el.content.link : null;
}

export function embedDoc(el: Element): EmbedDoc | null {
  return 'embed' in el.content ? el.content.embed : null;
}

export function imageDoc(el: Element): ImageDoc | null {
  return 'image' in el.content ? el.content.image : null;
}

export function fileDoc(el: Element): FileDoc | null {
  return 'file' in el.content ? el.content.file : null;
}

export function documentDoc(el: Element): DocumentDoc | null {
  return 'document' in el.content ? el.content.document : null;
}

export function sketchDoc(el: Element): SketchDoc | null {
  return 'sketch' in el.content ? el.content.sketch : null;
}

export function annotationDoc(el: Element): AnnotationDoc | null {
  return 'annotation' in el.content ? el.content.annotation : null;
}

export function tableDoc(el: Element): TableDoc | null {
  return 'table' in el.content ? el.content.table : null;
}

// board.icon encoding: 'g:<glyphId>' our icon set, 'c:<chars>' monogram
// or letter, 'e:<emoji>', 'b:<blobRef>' uploaded image.
export function iconBlobRef(icon: string | undefined): ID | null {
  return icon?.startsWith('b:') ? icon.slice(2) : null;
}

export function blobRefOf(el: Element): ID | null {
  const c = el.content;
  if ('image' in c) return c.image.blobRef;
  if ('file' in c) return c.file.blobRef;
  return null;
}

// Schemes a link/embed card may navigate or unfurl to; anything else
// (javascript:, data:, file:) is refused at ingest.
export function isSafeUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:' || p === 'mailto:';
  } catch {
    return false;
  }
}

// Element type -> its single content key.
export const CONTENT_KEY: Record<ElementType, string> = {
  note: 'note',
  column: 'column',
  board: 'boardRef',
  todo: 'todo',
  heading: 'heading',
  swatch: 'swatch',
  line: 'line',
  comment: 'comment',
  link: 'link',
  embed: 'embed',
  image: 'image',
  file: 'file',
  document: 'document',
  sketch: 'sketch',
  annotation: 'annotation',
  table: 'table',
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const optStr = (v: unknown) => v === undefined || isStr(v);
const optNum = (v: unknown) => v === undefined || isNum(v);
const optBool = (v: unknown) => v === undefined || isBool(v);

function saneStroke(s: unknown): boolean {
  if (!isObj(s) || !Array.isArray(s.pts) || !isStr(s.color) || !isNum(s.size)) return false;
  if (!s.pts.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) return false;
  if (s.widths !== undefined && (!Array.isArray(s.widths) || s.widths.length !== s.pts.length || !s.widths.every(isNum)))
    return false;
  return true;
}

const saneStrokes = (v: unknown): v is Stroke[] => Array.isArray(v) && v.every(saneStroke);

function saneLineEnd(v: unknown): v is LineEnd {
  return isObj(v) && isNum(v.x) && isNum(v.y) && optStr(v.el);
}

const LINE_MARKERS_SANE = new Set(['none', 'arrow', 'dot']);
const LINE_WEIGHTS_SANE = new Set(['thin', 'medium', 'thick']);
const CELL_TYPES_SANE = new Set(['auto', 'number', 'currency', 'percent', 'text', 'datetime', 'checkbox']);
const ALIGNS_H_SANE = new Set(['left', 'center', 'right']);
const ALIGNS_V_SANE = new Set(['top', 'middle', 'bottom']);

// Structural check for raw content carried by dispatch and import
// payloads: exactly one key matching the element type, and every
// field the card views dereference present with the right shape. The
// friendly create/patch props are validated field by field instead.
export function saneContent(v: unknown, type: ElementType): v is TypeContent {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  const key = CONTENT_KEY[type];
  if (keys.length !== 1 || keys[0] !== key) return false;
  const c = v[key];
  switch (key) {
    case 'note':
      return isObj(c) && isStr(c.text) && optStr(c.html);
    case 'heading':
      return isObj(c) && isStr(c.text) && (c.level === 1 || c.level === 2) && optStr(c.html);
    case 'column':
      return isObj(c) && isStr(c.title);
    case 'boardRef':
      return isStr(c);
    case 'todo':
      return (
        isObj(c) &&
        isStr(c.title) &&
        isBool(c.showTitle) &&
        Array.isArray(c.items) &&
        c.items.every(
          (it) =>
            isObj(it) &&
            isStr(it.id) &&
            isStr(it.text) &&
            isBool(it.done) &&
            optNum(it.dueAt) &&
            optBool(it.dueTime) &&
            (it.assignee === undefined || it.assignee === 'self') &&
            (it.reactions === undefined || (Array.isArray(it.reactions) && it.reactions.every(isStr))),
        )
      );
    case 'swatch':
      return isObj(c) && isStr(c.color) && isStr(c.caption) && isBool(c.showValue);
    case 'line':
      return (
        isObj(c) &&
        saneLineEnd(c.from) &&
        saneLineEnd(c.to) &&
        (c.fromMarker === undefined || LINE_MARKERS_SANE.has(c.fromMarker as string)) &&
        (c.toMarker === undefined || LINE_MARKERS_SANE.has(c.toMarker as string)) &&
        optBool(c.dashed) &&
        (c.weight === undefined || LINE_WEIGHTS_SANE.has(c.weight as string)) &&
        optStr(c.label)
      );
    case 'comment':
      return (
        isObj(c) &&
        Array.isArray(c.items) &&
        c.items.every((it) => isObj(it) && isStr(it.id) && isStr(it.text) && isNum(it.createdAt) && optNum(it.editedAt))
      );
    case 'link':
      return (
        isObj(c) &&
        isStr(c.url) &&
        (!c.url || isSafeUrl(c.url)) &&
        isStr(c.title) &&
        isStr(c.caption) &&
        isBool(c.showPreview) &&
        optStr(c.desc) &&
        optStr(c.image)
      );
    case 'embed':
      return (
        isObj(c) &&
        (c.kind === 'audio' || c.kind === 'map' || c.kind === 'video') &&
        isStr(c.url) &&
        (!c.url || isSafeUrl(c.url)) &&
        isStr(c.title) &&
        isStr(c.caption) &&
        isBool(c.showPreview)
      );
    case 'image':
      return (
        isObj(c) &&
        isStr(c.blobRef) &&
        isStr(c.name) &&
        isStr(c.caption) &&
        isNum(c.aspect) &&
        optStr(c.source) &&
        optNum(c.natW) &&
        optNum(c.natH) &&
        (c.strokes === undefined || saneStrokes(c.strokes))
      );
    case 'file':
      return isObj(c) && isStr(c.blobRef) && isStr(c.name) && isNum(c.size) && isStr(c.mime) && isStr(c.ext);
    case 'document':
      return (
        isObj(c) &&
        isStr(c.title) &&
        isStr(c.text) &&
        optStr(c.html) &&
        (c.displayMode === 'icon' || c.displayMode === 'detail') &&
        isStr(c.caption)
      );
    case 'sketch':
    case 'annotation':
      return isObj(c) && saneStrokes(c.strokes);
    case 'table': {
      if (!isObj(c) || !isStr(c.title) || !isStr(c.caption) || !Array.isArray(c.cells)) return false;
      if (c.widths !== undefined && (!Array.isArray(c.widths) || !c.widths.every(isNum))) return false;
      // cells must be a non-empty rectangular grid: a ragged import
      // would silently drop or pad columns at render.
      const cols = Array.isArray(c.cells[0]) ? c.cells[0].length : 0;
      if (!cols) return false;
      return c.cells.every(
        (row) =>
          Array.isArray(row) &&
          row.length === cols &&
          row.every(
            (cell) =>
              isObj(cell) &&
              isStr(cell.text) &&
              optStr(cell.html) &&
              (cell.type === undefined || CELL_TYPES_SANE.has(cell.type as string)) &&
              (cell.alignH === undefined || ALIGNS_H_SANE.has(cell.alignH as string)) &&
              (cell.alignV === undefined || ALIGNS_V_SANE.has(cell.alignV as string)) &&
              optStr(cell.color),
          ),
      );
    }
    default:
      return false;
  }
}
