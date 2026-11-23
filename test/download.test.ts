import { describe, expect, it } from 'vitest';
import { dedupFileName, slugFileName } from '../src/export/download';

describe('slugFileName', () => {
  it('lowercases, dashes non-alphanumerics, trims edge dashes', () => {
    expect(slugFileName('Sprint Plan!')).toBe('sprint-plan');
    expect(slugFileName('  --Weird  Title__ ')).toBe('weird-title');
    expect(slugFileName('Q4: Budget (v2)')).toBe('q4-budget-v2');
  });

  it('falls back when nothing slug-able remains', () => {
    expect(slugFileName('')).toBe('board');
    expect(slugFileName('!!!')).toBe('board');
    expect(slugFileName('')).toBe('board');
    expect(slugFileName('', 'export')).toBe('export');
  });
});

describe('dedupFileName', () => {
  it('passes unique names through untouched', () => {
    const used = new Set<string>();
    expect(dedupFileName('a.png', used)).toBe('a.png');
    expect(dedupFileName('b.png', used)).toBe('b.png');
  });

  it('appends " 2", " 3", ... before the extension', () => {
    const used = new Set<string>();
    dedupFileName('a.png', used);
    expect(dedupFileName('a.png', used)).toBe('a 2.png');
    expect(dedupFileName('a.png', used)).toBe('a 3.png');
  });

  it('handles names with no extension or a leading dot', () => {
    const used = new Set<string>();
    dedupFileName('README', used);
    expect(dedupFileName('README', used)).toBe('README 2');
    dedupFileName('.env', used);
    // Leading dot: no extension split, stem is the whole name.
    expect(dedupFileName('.env', used)).toBe('.env 2');
  });

  it('skips collisions against pre-numbered names', () => {
    const used = new Set<string>(['a.png', 'a 2.png']);
    expect(dedupFileName('a.png', used)).toBe('a 3.png');
  });
});
