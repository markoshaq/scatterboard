import { describe, expect, it } from 'vitest';
import { fmtSize, ingestPaste, parseUrlText } from '../src/ingest/files';

describe('fmtSize', () => {
  it('formats bytes, KB and MB with trimmed decimals', () => {
    expect(fmtSize(0)).toBe('0 B');
    expect(fmtSize(512)).toBe('512 B');
    expect(fmtSize(1023)).toBe('1023 B');
    expect(fmtSize(1024)).toBe('1 KB');
    expect(fmtSize(1536)).toBe('1.5 KB');
    expect(fmtSize(1024 * 1024)).toBe('1 MB');
    expect(fmtSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });
});

describe('parseUrlText', () => {
  it('accepts http(s) urls and bare domains', () => {
    expect(parseUrlText('https://example.com/x?y=1')).toBe('https://example.com/x?y=1');
    expect(parseUrlText('http://a.b')).toBe('http://a.b/');
    expect(parseUrlText('example.com')).toBe('https://example.com/');
    expect(parseUrlText('  example.com  ')).toBe('https://example.com/');
    expect(parseUrlText('localhost:3000/dev')).toBe('https://localhost:3000/dev');
    expect(parseUrlText('localhost')).toBe('https://localhost/');
  });

  it('rejects non-web schemes, whitespace and junk', () => {
    expect(parseUrlText('javascript:alert(1)')).toBeNull();
    expect(parseUrlText('mailto:a@b.c')).toBeNull();
    expect(parseUrlText('file:///etc/passwd')).toBeNull();
    expect(parseUrlText('two words.com')).toBeNull();
    expect(parseUrlText('')).toBeNull();
    expect(parseUrlText('   ')).toBeNull();
    expect(parseUrlText('notaurl')).toBeNull();
    expect(parseUrlText('x'.repeat(2100))).toBeNull();
  });
});

describe('ingestPaste', () => {
  const paste = (opts: { files?: File[]; text?: string }) =>
    ingestPaste({
      clipboardData: {
        files: opts.files ?? [],
        getData: (t: string) => (t === 'text/plain' ? (opts.text ?? '') : ''),
      },
    } as unknown as ClipboardEvent);

  it('prefers files over text', () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' });
    const out = paste({ files: [f], text: 'https://example.com' });
    expect(out.files).toEqual([f]);
    expect(out.url).toBeNull();
  });

  it('parses a url when no files are present', () => {
    expect(paste({ text: 'example.com' }).url).toBe('https://example.com/');
    expect(paste({ text: 'not a url' }).url).toBeNull();
    expect(paste({}).url).toBeNull();
    expect(paste({}).files).toEqual([]);
  });
});
