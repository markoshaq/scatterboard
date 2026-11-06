import type { Doc, Element, ID, TableCell } from '../state/schema';
import { boardElements, columnMembers } from '../state/schema';
import { evalFormula, isFormula } from '../cards/formula';
import { fmtCurrency, fmtDate, fmtNumber } from '../locale';

// Board -> linear document. Top-level cards sort into rough reading
// rows by (y, x); each type emits plain-text items rendered to
// Markdown, plain text, or the html .doc Word/Pages opens.

type Item =
  | { k: 'h'; level: 1 | 2 | 3; text: string }
  | { k: 'p'; text: string }
  | { k: 'todo'; text: string; done: boolean }
  | { k: 'link'; text: string; url: string }
  | { k: 'quote'; text: string }
  | { k: 'table'; rows: string[][] };

// Same visual row = tops within this board-space tolerance.
const ROW_TOL = 120;

function readingOrder(els: Element[]): Element[] {
  const sorted = [...els].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Element[][] = [];
  let rowY = -Infinity;
  for (const el of sorted) {
    if (el.y - rowY > ROW_TOL) rows.push([]);
    rowY = Math.max(rowY, el.y);
    rows[rows.length - 1]!.push(el);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

// Display value for a table cell: checkboxes and formulas resolve,
// typed cells format like the card view (locale-aware via locale.ts).
function cellText(cell: TableCell, cells: TableCell[][]): string {
  const type = cell.type ?? 'auto';
  const raw = cell.text;
  if (type === 'checkbox') return raw === '1' ? '[x]' : '[ ]';
  if (isFormula(raw)) return evalFormula(raw, cells) ?? raw;
  const n = parseFloat(raw.trim());
  const num = Number.isFinite(n) && raw.trim() !== '';
  switch (type) {
    case 'number':
      return num ? fmtNumber(n) : raw;
    case 'currency':
      return num ? fmtCurrency(n) : raw;
    case 'percent':
      return num ? `${Number((n * 100).toPrecision(12))}%` : raw;
    case 'datetime': {
      const ts = Date.parse(raw.trim());
      return Number.isNaN(ts) ? raw : fmtDate(ts);
    }
    default:
      return raw;
  }
}

function elementItems(el: Element, doc: Doc, out: Item[], subs: boolean, seen: Set<ID>) {
  const c = el.content;
  if ('note' in c) {
    for (const line of c.note.text.split('\n')) out.push({ k: 'p', text: line });
  } else if ('heading' in c) {
    out.push({ k: 'h', level: c.heading.level, text: c.heading.text });
  } else if ('todo' in c) {
    if (c.todo.showTitle && c.todo.title) out.push({ k: 'h', level: 3, text: c.todo.title });
    for (const item of c.todo.items) out.push({ k: 'todo', text: item.text, done: item.done });
  } else if ('link' in c) {
    out.push({ k: 'link', text: c.link.title || c.link.caption || c.link.url, url: c.link.url });
  } else if ('embed' in c) {
    out.push({ k: 'link', text: c.embed.title || c.embed.caption || c.embed.url, url: c.embed.url });
  } else if ('column' in c) {
    if (c.column.title) out.push({ k: 'h', level: 3, text: c.column.title });
    for (const m of columnMembers(doc, el.id)) elementItems(m, doc, out, subs, seen);
  } else if ('boardRef' in c) {
    const b = doc.boards[c.boardRef];
    out.push({ k: 'h', level: 2, text: `Board: ${b?.title ?? 'Untitled board'}` });
    if (subs && b && !seen.has(b.id)) {
      seen.add(b.id);
      boardItemsInto(b.id, doc, out, subs, seen);
    }
  } else if ('comment' in c) {
    for (const item of c.comment.items) out.push({ k: 'quote', text: item.text });
  } else if ('image' in c) {
    out.push({ k: 'p', text: `Image: ${c.image.name || 'image'}` });
  } else if ('file' in c) {
    out.push({ k: 'p', text: `File: ${c.file.name}` });
  } else if ('document' in c) {
    if (c.document.title) out.push({ k: 'h', level: 3, text: c.document.title });
    for (const line of c.document.text.split('\n')) out.push({ k: 'p', text: line });
  } else if ('swatch' in c) {
    out.push({ k: 'p', text: [c.swatch.color, c.swatch.caption].filter(Boolean).join(' ') });
  } else if ('sketch' in c) {
    out.push({ k: 'p', text: '(sketch)' });
  } else if ('table' in c) {
    if (c.table.title) out.push({ k: 'h', level: 3, text: c.table.title });
    out.push({ k: 'table', rows: c.table.cells.map((row) => row.map((cell) => cellText(cell, c.table.cells))) });
  }
  // line and annotation elements are spatial; no linear output.
}

function boardItemsInto(boardId: ID, doc: Doc, out: Item[], subs: boolean, seen: Set<ID>) {
  const els = readingOrder(boardElements(doc, boardId).filter((e) => e.type !== 'line' && e.type !== 'annotation'));
  for (const el of els) elementItems(el, doc, out, subs, seen);
}

export function boardItems(doc: Doc, boardId: ID, subs: boolean): Item[] {
  const out: Item[] = [];
  boardItemsInto(boardId, doc, out, subs, new Set([boardId]));
  return out;
}

export function toMarkdown(title: string, items: Item[]): string {
  const parts = [`# ${title || 'Untitled board'}`];
  for (const it of items) {
    if (it.k === 'h') parts.push(`${'#'.repeat(it.level)} ${it.text}`.trimEnd());
    else if (it.k === 'p') parts.push(it.text);
    else if (it.k === 'todo') parts.push(`- [${it.done ? 'x' : ' '}] ${it.text}`);
    else if (it.k === 'link') {
      // <url> is the CommonMark destination form: a ')' inside the url
      // would otherwise close the link early.
      // Brackets in the label must escape or they corrupt the link.
      parts.push(it.text && it.text !== it.url ? `[${it.text.replace(/[\[\]]/g, '\\$&')}](<${it.url}>)` : it.url);
    }
    else if (it.k === 'quote') parts.push(`> ${it.text}`);
    else if (it.k === 'table') {
      const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
      const rows = it.rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
      const sep = `| ${it.rows[0]?.map(() => '---').join(' | ') ?? '---'} |`;
      parts.push([rows[0] ?? '', sep, ...rows.slice(1)].join('\n'));
    }
  }
  return `${parts.filter((p) => p !== '').join('\n\n')}\n`;
}

function plainLines(items: Item[]): string[] {
  const parts: string[] = [];
  for (const it of items) {
    if (it.k === 'h') parts.push(it.text, '');
    else if (it.k === 'p') parts.push(it.text);
    else if (it.k === 'todo') parts.push(`[${it.done ? 'x' : ' '}] ${it.text}`);
    else if (it.k === 'link') parts.push(it.text && it.text !== it.url ? `${it.text} ${it.url}` : it.url);
    else if (it.k === 'quote') parts.push(`  ${it.text}`);
    else if (it.k === 'table') for (const r of it.rows) parts.push(r.join('  |  '));
  }
  return parts;
}

export function toPlain(title: string, items: Item[]): string {
  const parts = [(title || 'Untitled board').toUpperCase(), '', ...plainLines(items)];
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// Clipboard text for an arbitrary element set (Cmd+C): same linear
// rendering as the plain-text export, minus the board title. Members
// whose column came along are skipped: columnItems already emits them.
export function elementsToPlain(doc: Doc, els: Element[]): string {
  const ids = new Set(els.map((e) => e.id));
  const top = els.filter((e) => {
    let p = e.parentId;
    let guard = 0;
    while (p && guard++ < 64) {
      if (ids.has(p)) return false;
      p = doc.elements[p]?.parentId ?? null;
    }
    return true;
  });
  const items: Item[] = [];
  const seen = new Set<ID>();
  for (const el of readingOrder(top)) elementItems(el, doc, items, false, seen);
  return plainLines(items).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// An html file saved with a .doc extension; Word and Pages open it.
export function toWordHtml(title: string, items: Item[]): string {
  const body: string[] = [`<h1>${esc(title || 'Untitled board')}</h1>`];
  for (const it of items) {
    if (it.k === 'h') body.push(`<h${it.level}>${esc(it.text)}</h${it.level}>`);
    else if (it.k === 'p') body.push(`<p>${esc(it.text)}</p>`);
    else if (it.k === 'todo') body.push(`<p>[${it.done ? 'x' : ' '}] ${esc(it.text)}</p>`);
    else if (it.k === 'link') {
      const label = it.text && it.text !== it.url ? it.text : it.url;
      body.push(`<p><a href="${esc(it.url)}">${esc(label)}</a></p>`);
    } else if (it.k === 'quote') {
      body.push(`<blockquote>${esc(it.text)}</blockquote>`);
    } else if (it.k === 'table') {
      const rows = it.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      body.push(`<table border="1" cellspacing="0" cellpadding="6">${rows}</table>`);
    }
  }
  return (
    `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n` +
    `<style>body{font-family:sans-serif;font-size:11pt}h1{font-size:20pt}</style>\n</head>\n<body>\n` +
    `${body.join('\n')}\n</body>\n</html>\n`
  );
}
