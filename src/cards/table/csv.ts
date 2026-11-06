import type { TableCell, TableDoc } from '../../state/schema';

const MAX_CSV_CHARS = 1024 * 1024;
const MAX_CSV_CELLS = 10000;

export function parseCsv(text: string): string[][] {
  if (text.length > MAX_CSV_CHARS) throw new Error('csv too large');
  // A UTF-8 BOM would land verbatim in the first cell.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldQuoted = false;
  let cells = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '' && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
    } else if (ch === ',') {
      if (++cells > MAX_CSV_CELLS) throw new Error('csv too large');
      row.push(field);
      field = '';
      fieldQuoted = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (++cells > MAX_CSV_CELLS) throw new Error('csv too large');
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldQuoted = false;
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  if (field !== '' || fieldQuoted || row.length > 0) {
    if (++cells > MAX_CSV_CELLS) throw new Error('csv too large');
    row.push(field);
    rows.push(row);
  }
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) {
    while (r.length < maxCols) r.push('');
  }
  return rows;
}

export function serializeCsv(cells: TableCell[][]): string {
  // BOM: Excel decodes BOM-less CSV as ANSI, so non-ASCII mojibakes.
  return (
    '\uFEFF' +
    cells
      .map((row) =>
        row
          .map((c) => {
            const v = c.text;
            if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
              return `"${v.replace(/"/g, '""')}"`;
            }
            return v;
          })
          .join(','),
      )
      .join('\r\n')
  );
}

export function csvToTableDoc(rows: string[][], title = ''): TableDoc {
  let rEnd = rows.length;
  while (rEnd > 0 && rows[rEnd - 1]!.every((v) => v === '')) rEnd--;
  const trimmed = rows.slice(0, rEnd);
  let cEnd = trimmed.reduce((m, r) => Math.max(m, r.length), 0);
  while (cEnd > 0 && trimmed.every((r) => (r[cEnd - 1] ?? '') === '')) cEnd--;
  if (!rEnd || !cEnd) return { title, caption: '', cells: [] };
  const cells: TableCell[][] = trimmed.map((r) =>
    Array.from({ length: cEnd }, (_, c) => ({ text: r[c] ?? '' })),
  );
  return { title, caption: '', cells };
}

export function compareCells(a: TableCell, b: TableCell, locale = 'en', sign = 1): number {
  // Type resolution must be symmetric: picking a's type first would
  // make cmp(a,b) disagree with -cmp(b,a) in mixed-type columns.
  const ta = a.type && a.type !== 'auto' ? a.type : undefined;
  const tb = b.type && b.type !== 'auto' ? b.type : undefined;
  const type = ta && tb ? (ta <= tb ? ta : tb) : (ta ?? tb ?? 'auto');
  if (type === 'checkbox') {
    const va = a.text === '1' ? 1 : 0;
    const vb = b.text === '1' ? 1 : 0;
    return (va - vb) * sign;
  }
  if (type === 'number' || type === 'currency' || type === 'percent') {
    const na = a.text.trim() === '' ? NaN : parseFloat(a.text.trim());
    const nb = b.text.trim() === '' ? NaN : parseFloat(b.text.trim());
    const fa = Number.isFinite(na);
    const fb = Number.isFinite(nb);
    if (fa && fb) return (na - nb) * sign;
    // Cells with no value trail the sort in both directions.
    if (fa !== fb) return fa ? -1 : 1;
    return a.text.localeCompare(b.text, locale) * sign;
  }
  if (type === 'datetime') {
    const ta = a.text.trim() === '' ? NaN : Date.parse(a.text.trim());
    const tb = b.text.trim() === '' ? NaN : Date.parse(b.text.trim());
    const fa = !Number.isNaN(ta);
    const fb = !Number.isNaN(tb);
    if (fa && fb) return (ta - tb) * sign;
    if (fa !== fb) return fa ? -1 : 1;
    return a.text.localeCompare(b.text, locale) * sign;
  }
  return a.text.localeCompare(b.text, locale) * sign;
}

// A1 refs are positional, so sorting changes what formulas point at.
export function sortTableRows(
  cells: TableCell[][],
  col: number,
  dir: 'asc' | 'desc',
  locale = 'en',
): TableCell[][] {
  const sign = dir === 'desc' ? -1 : 1;
  return cells
    .map((row) => row.slice())
    .sort((ra, rb) => compareCells(ra[col] ?? { text: '' }, rb[col] ?? { text: '' }, locale, sign));
}
