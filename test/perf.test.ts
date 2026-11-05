import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBoard, createColumn, createNote, emptyDoc, type Doc } from '../src/state/schema';
import { BoardIndex } from '../src/cards/boardindex';

function perfDoc(n: number): Doc {
  const d = emptyDoc();
  d.boards.home = createBoard({ id: 'home', title: 'Home' });
  const col = createColumn(d, 'home', 0, 0, 'col');
  d.elements[col.id] = col;
  for (let i = 0; i < n; i++) {
    const el = createNote(d, 'home', (i % 50) * 260, Math.floor(i / 50) * 160, `n${i}`);
    if (i < 20) el.parentId = col.id;
    d.elements[el.id] = el;
  }
  return d;
}

// update() must be O(card), never O(doc): the method bodies below may
// not scan doc.elements/doc.labels and may not read layout. The regex
// anchors on `update(el` so interface signatures (note.ts) and helper
// methods like comment.ts's `update(items)` cannot match instead.
const UPDATE_RE = /^ {2}update\(el[^)]*\)\s*(?::[^\n{]+)?\{/m;
// Files in src/cards that hold no card view; anything else must match.
const NON_CARD = new Set(['boardindex.ts', 'factory.ts', 'formula.ts', 'layer.ts', 'measure.ts']);
function updateBody(src: string): string {
  const m = UPDATE_RE.exec(src);
  if (!m) return '';
  const start = src.indexOf('{', m.index);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j);
    }
  }
  return src.slice(start);
}

describe('card update() structural invariants', () => {
  const dir = join(__dirname, '..', 'src', 'cards');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    it(`${f} keeps update() off doc scans and layout reads`, () => {
      const body = updateBody(readFileSync(join(dir, f), 'utf8'));
      if (NON_CARD.has(f)) return;
      expect(body, `${f} declares no update(el...) method`).not.toBe('');
      expect(body).not.toMatch(/\bObject\.(values|keys|entries)\(/);
      // The anti-pattern is a read-compare per row per render; innerText
      // reads inside event closures built by update() are fine.
      expect(body).not.toMatch(/\.innerText\s*(===|!==)/);
      expect(body).not.toMatch(/\.getBoundingClientRect\(/);
      expect(body).not.toMatch(/\.offset(Width|Height|Top|Left)\b/);
      expect(body).not.toMatch(/\bdoc\.(elements|labels)\b/);
    });
  }
});

describe('member layout guards', () => {
  // .col-body members must stay in flex flow: any card-root rule that
  // re-declares position after .col-body > .card wins equal specificity
  // and pins the member absolutely over its siblings (the .card.table
  // regression). The base .card rule is fine - it sits earlier.
  it('no card-type rule declares position', () => {
    // style.css is a pure @import list; resolve it so the guard sees
    // the same concatenated sheets the build does.
    const entry = readFileSync(join(__dirname, '..', 'src', 'style.css'), 'utf8');
    const css = [...entry.matchAll(/@import '(.+?)';/g)]
      .map((m) => readFileSync(join(__dirname, '..', 'src', m[1]!), 'utf8'))
      .join('\n');
    const colBody = css.indexOf('.col-body > .card');
    expect(colBody).toBeGreaterThan(-1);
    for (const m of css.matchAll(/\.card\.[\w-]+\s*\{[^}]*\}/g)) {
      expect(m[0]).not.toMatch(/position\s*:/);
    }
  });
});

describe('BoardIndex structural guards', () => {
  it('members returns the cached byParent list, not a rescan', () => {
    const d = perfDoc(2000);
    const idx = new BoardIndex();
    idx.ensure(d, 'home', 1);
    const col = Object.values(d.elements).find((e) => e.type === 'column')!;
    const members = idx.members(col.id);
    expect(members.length).toBe(20);
    // Identity proves the index path: a rescan would allocate a copy.
    expect(members).toBe(idx.byParent.get(col.id));
    expect(idx.members('missing')).toEqual([]);
  });

  it('counts every board in the same single pass', () => {
    const d = perfDoc(100);
    d.boards.other = createBoard({ id: 'other', title: 'Other', parentId: 'home' });
    const n = createNote(d, 'other', 0, 0);
    d.elements[n.id] = n;
    const col = createColumn(d, 'other', 0, 0);
    d.elements[col.id] = col;
    const member = createNote(d, 'other', 0, 0);
    member.parentId = col.id;
    d.elements[member.id] = member;
    const idx = new BoardIndex();
    idx.ensure(d, 'home', 1);
    // boardCardCount semantics: every element on the board.
    expect(idx.cardCount('other')).toBe(3);
    // canvasCounts: canvas cards only (members and lines excluded).
    expect(idx.canvasCounts.get('other')).toBe(2);
  });

  it('rebuilds only on rev or board change', () => {
    const d = perfDoc(50);
    const idx = new BoardIndex();
    expect(idx.ensure(d, 'home', 1)).toBe(true);
    expect(idx.ensure(d, 'home', 1)).toBe(false);
    expect(idx.ensure(d, 'home', 2)).toBe(true);
    expect(idx.ensure(d, 'other', 2)).toBe(true);
  });
});
