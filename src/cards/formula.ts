import type { TableCell } from '../state/schema';
import { localeTag } from '../locale';

// Tiny formula evaluator: =NAME(args) where args are numbers, A1-style
// cell refs, or A1:B3 ranges. SUM/MIN/MAX/COUNT/AVERAGE fold over the
// resolved numbers; IF(cond, a, b) takes one comparison between refs,
// numbers or quoted strings. Anything unparseable, circular or NaN
// returns null so the raw '=' text can render instead.

export const FORMULA_NAMES = ['SUM', 'IF', 'MIN', 'MAX', 'COUNT', 'AVERAGE'] as const;

type Val = number | string;

// Evaluation state: seen holds 'r:c' keys of cells being expanded so
// reference cycles surface; bad marks any error encountered.
interface St {
  seen: Set<string>;
  bad: boolean;
}

const CALL = /^=\s*([A-Za-z]+)\s*\((.*)\)\s*$/s;
const REF = /^([A-Za-z]+)([0-9]+)$/;
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const QUOTED = /^(["'])(.*)\1$/;
const MAX_DEPTH = 24;
const MAX_RANGE = 4096;

function colOf(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function refOf(s: string): { r: number; c: number } | null {
  const m = REF.exec(s.trim());
  if (!m) return null;
  return { r: parseInt(m[2]!, 10) - 1, c: colOf(m[1]!) };
}

// Args never nest calls, so splitting on commas outside quotes suffices.
function splitArgs(s: string): string[] {
  const out = [''];
  let quote = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
    if (ch === ',' && !quote) out.push('');
    else out[out.length - 1] += ch;
  }
  return out.map((a) => a.trim()).filter((a) => a !== '');
}

// A referenced cell's value: formula cells recurse, numeric text
// coerces, other text stays a string for IF comparisons. Cycles and
// bad formulas flag the eval.
function cellVal(cells: TableCell[][], r: number, c: number, st: St): Val {
  const text = cells[r]?.[c]?.text.trim() ?? '';
  if (text.startsWith('=')) {
    const key = `${r}:${c}`;
    if (st.seen.has(key) || st.seen.size >= MAX_DEPTH) {
      st.bad = true;
      return NaN;
    }
    st.seen.add(key);
    const v = evalCall(text, cells, st);
    st.seen.delete(key);
    if (v === null) {
      st.bad = true;
      return NaN;
    }
    return v;
  }
  const n = parseFloat(text.replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : text;
}

function cellNum(cells: TableCell[][], r: number, c: number, st: St): number {
  const v = cellVal(cells, r, c, st);
  return typeof v === 'number' ? v : NaN;
}

// One arg position -> the numbers it contributes (refs/ranges expand,
// uncoercible cells become NaN and are filtered out by the caller).
function valuesOf(arg: string, cells: TableCell[][], st: St): number[] {
  const rm = /^(.+?)\s*:\s*(.+)$/.exec(arg);
  if (rm) {
    const a = refOf(rm[1]!);
    const b = refOf(rm[2]!);
    if (a && b) {
      const span = (Math.abs(a.r - b.r) + 1) * (Math.abs(a.c - b.c) + 1);
      if (span > MAX_RANGE) {
        st.bad = true;
        return [];
      }
      const out: number[] = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
          out.push(cellNum(cells, r, c, st));
        }
      }
      return out;
    }
    return [];
  }
  const ref = refOf(arg);
  if (ref) return [cellNum(cells, ref.r, ref.c, st)];
  if (NUM.test(arg)) return [parseFloat(arg)];
  return [];
}

// IF operands: number, cell ref, or quoted string literal.
function operand(arg: string, cells: TableCell[][], st: St): Val {
  const q = QUOTED.exec(arg);
  if (q) return q[2]!;
  const ref = refOf(arg);
  if (ref) return cellVal(cells, ref.r, ref.c, st);
  if (NUM.test(arg)) return parseFloat(arg);
  return NaN;
}

const OPS = ['>=', '<=', '!=', '>', '<', '='] as const;

function evalIf(args: string[], cells: TableCell[][], st: St): Val | null {
  if (args.length !== 3) return null;
  const cond = args[0]!;
  for (const op of OPS) {
    const i = cond.indexOf(op);
    if (i < 0) continue;
    const l = operand(cond.slice(0, i), cells, st);
    const r = operand(cond.slice(i + op.length), cells, st);
    let pass: boolean;
    if (typeof l === 'number' && typeof r === 'number') {
      if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
      pass =
        op === '>' ? l > r
        : op === '<' ? l < r
        : op === '>=' ? l >= r
        : op === '<=' ? l <= r
        : op === '!=' ? l !== r
        : l === r;
    } else if (typeof l === 'string' && typeof r === 'string' && (op === '=' || op === '!=')) {
      pass = op === '=' ? l === r : l !== r;
    } else {
      return null;
    }
    return operand(args[pass ? 1 : 2]!, cells, st);
  }
  return null;
}

function evalCall(src: string, cells: TableCell[][], st: St): Val | null {
  const m = CALL.exec(src.trim());
  if (!m) return null;
  const name = m[1]!.toUpperCase();
  const args = splitArgs(m[2]!);
  if (name === 'IF') return evalIf(args, cells, st);
  const nums = args.flatMap((a) => valuesOf(a, cells, st)).filter(Number.isFinite);
  switch (name) {
    case 'SUM':
      return nums.reduce((a, b) => a + b, 0);
    case 'MIN':
      return nums.length ? Math.min(...nums) : null;
    case 'MAX':
      return nums.length ? Math.max(...nums) : null;
    case 'COUNT':
      return nums.length;
    case 'AVERAGE':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    default:
      return null;
  }
}

export function isFormula(text: string): boolean {
  return text.trimStart().startsWith('=');
}

// Rewrite A1 refs inside a formula string through map(r, c), leaving
// quoted spans alone so literals like "A1" survive. Structural table
// edits call this on every cell so formulas keep tracking moved data.
function remapRefs(text: string, map: (r: number, c: number) => { r: number; c: number }): string {
  if (!isFormula(text)) return text;
  const seg = (s: string) =>
    s.replace(/([A-Za-z]+)([0-9]+)/g, (m, ls: string, ds: string, off: number, src: string) => {
      // Call position is a function name (=LOG10(2)), not a cell ref.
      if (src.charAt(off + m.length) === '(') return m;
      const p = map(parseInt(ds, 10) - 1, colOf(ls));
      return `${colName(p.c)}${p.r + 1}`;
    });
  let out = '';
  let quote = '';
  let buf = '';
  for (const ch of text) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      out += seg(buf);
      buf = '';
      out += ch;
      quote = ch;
    } else {
      buf += ch;
    }
  }
  return out + seg(buf);
}

export function remapCells(
  cells: TableCell[][],
  map: (r: number, c: number) => { r: number; c: number },
): TableCell[][] {
  return cells.map((row) =>
    row.map((cell) => {
      const text = remapRefs(cell.text, map);
      return text === cell.text ? cell : { ...cell, text };
    }),
  );
}

// Display string for a formula cell, or null to render the raw text.
export function evalFormula(src: string, cells: TableCell[][]): string | null {
  const st: St = { seen: new Set(), bad: false };
  const v = evalCall(src, cells, st);
  if (st.bad || v === null || (typeof v === 'number' && !Number.isFinite(v))) return null;
  if (typeof v === 'string') return v;
  return Number.isInteger(v) ? String(v) : v.toLocaleString(localeTag(), { maximumFractionDigits: 4 });
}
