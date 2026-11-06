import { describe, expect, it } from 'vitest';
import { compareCells, csvToTableDoc, parseCsv, serializeCsv, sortTableRows } from '../src/cards/table/csv';
import type { TableCell } from '../src/state/schema';

describe('table CSV and sort', () => {
  it('round-trips CSV with quotes, commas, embedded newlines, and CRLF', () => {
    const cells: TableCell[][] = [
      [{ text: 'Name' }, { text: 'Note, "quoted"' }, { text: '=SUM(A1:A2)' }],
      [{ text: 'Line 1\nLine 2' }, { text: 'plain' }, { text: '' }],
    ];
    const raw = serializeCsv(cells);
    expect(raw).toContain('\r\n');
    const parsed = parseCsv(raw);
    expect(parsed).toEqual([
      ['Name', 'Note, "quoted"', '=SUM(A1:A2)'],
      ['Line 1\nLine 2', 'plain', ''],
    ]);
  });

  it('pads ragged rows and trims trailing empty rows/cols in csvToTableDoc', () => {
    const rows = parseCsv('a,b,c\r\n1\r\n,,\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['', '', ''],
    ]);

    const doc = csvToTableDoc(
      [
        ['x', 'y', ''],
        ['z'],
        ['', '', ''],
      ],
      'Imported',
    );
    expect(doc.title).toBe('Imported');
    expect(doc.cells).toEqual([
      [{ text: 'x' }, { text: 'y' }],
      [{ text: 'z' }, { text: '' }],
    ]);

    expect(csvToTableDoc([['', '']], 'Empty').cells).toEqual([]);
  });

  it('compares and stably sorts rows by cell type in asc and desc order', () => {
    expect(compareCells({ text: '10', type: 'number' }, { text: '2', type: 'number' })).toBeGreaterThan(0);
    expect(compareCells({ text: '2.5', type: 'currency' }, { text: '10', type: 'currency' })).toBeLessThan(0);
    expect(compareCells({ text: '0.5', type: 'percent' }, { text: '0.1', type: 'percent' })).toBeGreaterThan(0);
    expect(
      compareCells({ text: '2026-01-02', type: 'datetime' }, { text: '2025-12-31', type: 'datetime' }),
    ).toBeGreaterThan(0);
    expect(compareCells({ text: '0', type: 'checkbox' }, { text: '1', type: 'checkbox' })).toBeLessThan(0);
    expect(compareCells({ text: 'apple' }, { text: 'banana' }, 'en')).toBeLessThan(0);

    const grid: TableCell[][] = [
      [{ text: '10', type: 'number' }, { text: 'first-10' }],
      [{ text: '2', type: 'number' }, { text: 'only-2' }],
      [{ text: '10', type: 'number' }, { text: 'second-10' }],
    ];

    const asc = sortTableRows(grid, 0, 'asc', 'en');
    expect(asc.map((r) => r[1]!.text)).toEqual(['only-2', 'first-10', 'second-10']);

    const desc = sortTableRows(grid, 0, 'desc', 'en');
    expect(desc.map((r) => r[1]!.text)).toEqual(['first-10', 'second-10', 'only-2']);
  });

  it('keeps empty and unparseable cells last in both sort directions', () => {
    const grid: TableCell[][] = [
      [{ text: '', type: 'number' }, { text: 'blank' }],
      [{ text: '5', type: 'number' }, { text: 'five' }],
      [{ text: 'n/a', type: 'number' }, { text: 'unparsed' }],
      [{ text: '1', type: 'number' }, { text: 'one' }],
    ];

    const asc = sortTableRows(grid, 0, 'asc', 'en').map((r) => r[1]!.text);
    expect(asc.slice(0, 2)).toEqual(['one', 'five']);
    expect(asc.slice(2).sort()).toEqual(['blank', 'unparsed']);

    const desc = sortTableRows(grid, 0, 'desc', 'en').map((r) => r[1]!.text);
    expect(desc.slice(0, 2)).toEqual(['five', 'one']);
    expect(desc.slice(2).sort()).toEqual(['blank', 'unparsed']);
  });
});
