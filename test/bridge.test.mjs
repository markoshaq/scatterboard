import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../bridge/install.mjs';

// Node-env suite for the bridge's JSONC-tolerant config parser; it is
// what keeps `scatterboard-mcp install` from corrupting user configs.
describe('parseJsonc', () => {
  it('parses plain JSON unchanged', () => {
    expect(parseJsonc('{"a":1,"b":[2,3],"c":{"d":"x"}}')).toEqual({ a: 1, b: [2, 3], c: { d: 'x' } });
  });

  it('strips line and block comments outside strings', () => {
    const out = parseJsonc(`{
      // comment line
      "a": 1, /* inline */ "b": "// not a comment",
      /* multi
         line */ "c": "/* also not */"
    }`);
    expect(out).toEqual({ a: 1, b: '// not a comment', c: '/* also not */' });
  });

  it('drops trailing commas before } and ]', () => {
    expect(parseJsonc('{"a":1, "b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
    expect(parseJsonc('{"a": 1,\n\n  }')).toEqual({ a: 1 });
  });

  it('keeps commas inside strings', () => {
    expect(parseJsonc('{"u":"a,b}"}')).toEqual({ u: 'a,b}' });
    expect(parseJsonc('{"u":"x,]"}')).toEqual({ u: 'x,]' });
  });

  it('honours escaped quotes and backslashes inside strings', () => {
    expect(parseJsonc('{"q":"she said \\"hi // not comment\\""}')).toEqual({ q: 'she said "hi // not comment"' });
    expect(parseJsonc('{"p":"C:\\\\tmp\\\\x"}')).toEqual({ p: 'C:\\tmp\\x' });
  });

  it('rejects malformed input like JSON.parse', () => {
    expect(() => parseJsonc('{a:1}')).toThrow();
    expect(() => parseJsonc('{"a":}')).toThrow();
    expect(() => parseJsonc('')).toThrow();
  });
});
