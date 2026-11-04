import {
  isSafeUrl,
  NOTE_MAX_W,
  NOTE_MIN_W,
  UNSORTED,
  type Doc,
  type ID,
  type LineEnd,
  type Stroke,
} from '../state/schema';
import { sanitizeHtml, scrubHtml } from '../ui/sanitize';

// One agent command payload may not exceed this per string.
export const MAX_STR = 100 * 1024;

export type Dict = Record<string, unknown>;

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function fail(code: string, message: string): never {
  throw new AgentError(code, message);
}

export function vObj(v: unknown, name: string): Dict {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_params', `${name} must be an object`);
  return v as Dict;
}

export function vStr(v: unknown, name: string, max = MAX_STR): string {
  if (typeof v !== 'string') fail('bad_field', `${name} must be a string`);
  if (v.length > max) fail('too_large', `${name} exceeds ${max} chars`);
  return v;
}

export function vStrOpt(v: unknown, name: string, max = MAX_STR): string | undefined {
  return v === undefined ? undefined : vStr(v, name, max);
}

export function vStrArray(v: unknown, name: string, max = 128): string[] {
  if (!Array.isArray(v)) fail('bad_field', `${name} must be an array`);
  return v.map((s) => vStr(s, `${name}[]`, max));
}

export function vNum(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('bad_field', `${name} must be a number`);
  return v;
}

export function vNumOpt(v: unknown, name: string): number | undefined {
  return v === undefined ? undefined : vNum(v, name);
}

export function vBool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail('bad_field', `${name} must be a boolean`);
  return v;
}

export function vBoolOpt(v: unknown, name: string): boolean | undefined {
  return v === undefined ? undefined : vBool(v, name);
}

export function vId(v: unknown, name: string): ID {
  return vStr(v, name, 128);
}

// Link/embed URLs must be schemes the card can safely navigate to; a
// stored javascript: URL would execute on click.
export function vUrl(v: unknown, name: string): string {
  const s = vStr(v, name, 8192);
  if (s && !isSafeUrl(s)) fail('bad_field', `${name} must be an http(s) or mailto URL`);
  return s;
}

export function vUrlOpt(v: unknown, name: string): string | undefined {
  return v === undefined ? undefined : vUrl(v, name);
}

export function vHtml(v: unknown, name: string): string {
  return sanitizeHtml(vStr(v, name));
}

export function vWidth(v: unknown): number {
  const w = vNum(v, 'w');
  return Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, Math.round(w)));
}

export function vBoardId(doc: Doc, v: unknown): ID {
  const id = vId(v, 'boardId');
  if (!doc.boards[id]) fail('not_found', `no board ${id}`);
  return id;
}

export function vElId(doc: Doc, v: unknown, name: string): ID {
  const id = vId(v, name);
  if (!doc.elements[id]) fail('not_found', `no element ${id}`);
  return id;
}

// Canvas = null, 'unsorted' = inbox, otherwise an existing column id.
// boardId pins the column to the element's board: a cross-board parent
// desyncs the member index and hides the card.
export function vParentId(doc: Doc, v: unknown, boardId?: ID): ID | null {
  if (v === null) return null;
  const id = vId(v, 'parentId');
  if (id === UNSORTED) return id;
  const el = doc.elements[id];
  if (!el) fail('not_found', `no element ${id}`);
  if (el.type !== 'column') fail('bad_field', `parentId ${id} is not a column`);
  if (boardId !== undefined && el.boardId !== boardId) {
    fail('bad_field', `parentId ${id} is on another board`);
  }
  return id;
}

export function vLabels(doc: Doc, v: unknown, boardId: ID): ID[] {
  if (!Array.isArray(v)) fail('bad_field', 'labels must be an array');
  return v.map((raw) => {
    const id = vId(raw, 'labels[]');
    const l = doc.labels[id];
    if (!l || l.boardId !== boardId) fail('not_found', `no label ${id} on board ${boardId}`);
    return id;
  });
}

export function vLineEnd(doc: Doc, v: unknown, name: string): LineEnd {
  const o = vObj(v, name);
  const end: LineEnd = { x: vNum(o.x, `${name}.x`), y: vNum(o.y, `${name}.y`) };
  if (o.el !== undefined) end.el = vElId(doc, o.el, `${name}.el`);
  return end;
}

const STROKE_PT_CAP = 20000;

export function vStrokes(v: unknown): Stroke[] {
  if (!Array.isArray(v)) fail('bad_field', 'strokes must be an array');
  let pts = 0;
  return v.map((raw): Stroke => {
    const o = vObj(raw, 'strokes[]');
    if (!Array.isArray(o.pts)) fail('bad_field', 'stroke.pts must be an array');
    pts += o.pts.length;
    if (pts > STROKE_PT_CAP) fail('too_large', 'too many stroke points');
    const s: Stroke = {
      pts: o.pts.map((p): [number, number] => {
        if (!Array.isArray(p)) fail('bad_field', 'stroke point must be [x,y]');
        return [vNum(p[0], 'pt.x'), vNum(p[1], 'pt.y')];
      }),
      color: vStr(o.color, 'stroke.color', 64),
      size: vNum(o.size, 'stroke.size'),
    };
    if (o.widths !== undefined) {
      if (!Array.isArray(o.widths) || o.widths.length !== s.pts.length) {
        fail('bad_field', 'stroke.widths must match pts in length');
      }
      s.widths = o.widths.map((w) => vNum(w, 'stroke.widths[]'));
    }
    return s;
  });
}

export { scrubHtml };
