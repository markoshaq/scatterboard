import type { Doc, ID } from '../state/schema';
import { UNSORTED } from '../state/schema';
import { t } from '../strings';
import { typeIcon } from './icons';
import { mountBoardIcon } from './boardicons';
import { openPanel, panelEmpty, panelRow, type PanelHandle } from './panel';

export interface SearchHit {
  // Target board of the jump (the board a board-card points at for
  // title hits, the element's own board otherwise).
  boardId: ID;
  // Board the matching card sits on; equals boardId for card hits.
  onBoardId?: ID;
  elementId?: ID;
  icon: string;
  snippet: string;
  modifiedAt: number;
  query?: string;
  // Title of the board the card sits on, shown as context in
  // workspace-wide results. 'Unsorted' cards are flagged separately.
  boardTitle?: string;
  unsorted?: boolean;
}

export type SearchScope = 'board' | 'all';

type SearchSort = 'relevance' | 'modified' | 'viewed';

interface RecentBoard {
  boardId: ID;
  title: string;
  icon?: string;
}

function snippet(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const start = Math.max(0, i - 24);
  const end = Math.min(text.length, i + q.length + 34);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '...' : ''}`;
}

function matchText(text: string | undefined, q: string): string | null {
  if (!text) return null;
  return snippet(text, q);
}

// Unsorted raw hits; the panel applies the chosen sort so switching
// order does not re-run the index scan.
export function searchBoard(doc: Doc, boardId: ID, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const el of Object.values(doc.elements)) {
    // Anchored comments render as pins: jumping to one would select an
    // invisible element.
    if (el.boardId !== boardId || el.parentId === UNSORTED || el.anchorId !== undefined) continue;
    const texts: (string | undefined)[] = [];
    const c = el.content;
    if ('note' in c) texts.push(c.note.text);
    else if ('heading' in c) texts.push(c.heading.text);
    else if ('todo' in c) texts.push(c.todo.title, ...c.todo.items.map((i) => i.text));
    else if ('column' in c) texts.push(c.column.title);
    else if ('swatch' in c) texts.push(c.swatch.caption, c.swatch.color);
    else if ('line' in c) texts.push(c.line.label);
    else if ('link' in c) texts.push(c.link.title, c.link.url, c.link.caption);
    else if ('embed' in c) texts.push(c.embed.title, c.embed.url, c.embed.caption);
    else if ('image' in c) texts.push(c.image.caption, c.image.name);
    else if ('file' in c) texts.push(c.file.name);
    else if ('document' in c) texts.push(c.document.title, c.document.text, c.document.caption);
    else if ('table' in c) {
      texts.push(c.table.title, c.table.caption, ...c.table.cells.flat().map((cell) => cell.text));
    }
    else if ('comment' in c) texts.push(...c.comment.items.map((i) => i.text));
    else if ('boardRef' in c) {
      const board = doc.boards[c.boardRef];
      const s = matchText(board?.title, q);
      if (s) {
        hits.push({ boardId: c.boardRef, onBoardId: boardId, icon: typeIcon('board'), snippet: s, modifiedAt: board!.modifiedAt, boardTitle: board!.title });
      }
      continue;
    }
    for (const text of texts) {
      const s = matchText(text, q);
      if (s) {
        hits.push({ boardId, elementId: el.id, icon: typeIcon(el.type), snippet: s, modifiedAt: el.modifiedAt });
        break;
      }
    }
  }
  return hits;
}

// Workspace-wide variant: every element in the doc, Unsorted members
// included, plus a title pass over boards (which also catches boards
// no card on the workspace points at). Anchored comments stay skipped.
export function searchDoc(doc: Doc, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const el of Object.values(doc.elements)) {
    if (el.anchorId !== undefined || 'boardRef' in el.content) continue;
    const boardId = el.boardId;
    const texts: (string | undefined)[] = [];
    const c = el.content;
    if ('note' in c) texts.push(c.note.text);
    else if ('heading' in c) texts.push(c.heading.text);
    else if ('todo' in c) texts.push(c.todo.title, ...c.todo.items.map((i) => i.text));
    else if ('column' in c) texts.push(c.column.title);
    else if ('swatch' in c) texts.push(c.swatch.caption, c.swatch.color);
    else if ('line' in c) texts.push(c.line.label);
    else if ('link' in c) texts.push(c.link.title, c.link.url, c.link.caption);
    else if ('embed' in c) texts.push(c.embed.title, c.embed.url, c.embed.caption);
    else if ('image' in c) texts.push(c.image.caption, c.image.name);
    else if ('file' in c) texts.push(c.file.name);
    else if ('document' in c) texts.push(c.document.title, c.document.text, c.document.caption);
    else if ('table' in c) {
      texts.push(c.table.title, c.table.caption, ...c.table.cells.flat().map((cell) => cell.text));
    }
    else if ('comment' in c) texts.push(...c.comment.items.map((i) => i.text));
    for (const text of texts) {
      const s = matchText(text, q);
      if (s) {
        hits.push({
          boardId,
          elementId: el.id,
          icon: typeIcon(el.type),
          snippet: s,
          modifiedAt: el.modifiedAt,
          boardTitle: doc.boards[boardId]?.title ?? '',
          ...(el.parentId === UNSORTED ? { unsorted: true } : {}),
        });
        break;
      }
    }
  }
  for (const b of Object.values(doc.boards)) {
    const s = matchText(b.title, q);
    if (s) {
      hits.push({ boardId: b.id, icon: typeIcon('board'), snippet: s, modifiedAt: b.modifiedAt, boardTitle: b.title });
    }
  }
  return hits;
}

function sortHits(hits: SearchHit[], sort: SearchSort, recentIds: ID[]): SearchHit[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  const byMod = (a: SearchHit, b: SearchHit) => b.modifiedAt - a.modifiedAt;
  const out = hits.slice();
  if (sort === 'modified') out.sort(byMod);
  else if (sort === 'viewed') {
    out.sort((a, b) => {
      const ra = rank.get(a.boardId) ?? recentIds.length;
      const rb = rank.get(b.boardId) ?? recentIds.length;
      return ra === rb ? byMod(a, b) : ra - rb;
    });
  } else {
    // Relevance: board title hits first, then card hits by recency.
    out.sort((a, b) => {
      const ba = a.elementId ? 1 : 0;
      const bb = b.elementId ? 1 : 0;
      return ba === bb ? byMod(a, b) : ba - bb;
    });
  }
  return out;
}

export function openSearchPanel(opts: {
  search(q: string, scope: SearchScope): SearchHit[];
  boardTitle(): string;
  recents(): RecentBoard[];
  recentIds(): ID[];
  onJump(hit: SearchHit): void;
  onClose(): void;
}): PanelHandle {
  const handle = openPanel({ title: t('searchTitle') });
  handle.onClose = opts.onClose;
  const input = document.createElement('input');
  input.name = 'board-search';
  input.type = 'text';
  input.className = 'sp-search';
  input.placeholder = t('searchPh');
  const scope = document.createElement('select');
  scope.className = 'sp-scope';
  scope.title = t('searchScope');
  scope.setAttribute('aria-label', t('searchScope'));
  for (const [v, label] of [
    ['all', t('searchAll')],
    ['board', opts.boardTitle() || t('searchBoard')],
  ] as [SearchScope, string][]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    scope.appendChild(o);
  }
  const sort = document.createElement('select');
  sort.className = 'sp-sort';
  sort.title = t('sortLabel');  sort.setAttribute('aria-label', t('sortLabel'));
  for (const [v, label] of [
    ['relevance', t('sortRelevance')],
    ['modified', t('sortModified')],
    ['viewed', t('sortViewed')],
  ] as [SearchSort, string][]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sort.appendChild(o);
  }
  const results = document.createElement('div');
  results.className = 'sp-results';
  handle.body.append(input, scope, sort, results);

  // Cache the raw hits per query: a sort flip only re-orders, it does
  // not re-run the scan.
  let cacheQ = '';
  let cacheHits: SearchHit[] = [];
  // Keyboard walk over .sp-hit rows: -1 means nothing picked yet, so
  // the first ArrowDown lands on row 0 and Enter still jumps the top hit.
  let navIdx = -1;

  const render = () => {
    navIdx = -1;
    results.textContent = '';
    const q = input.value.trim();
    if (!q) {
      cacheQ = '';
      cacheHits = [];
      const recents = opts.recents();
      if (!recents.length) return;
      const head = document.createElement('div');
      head.className = 'sp-group';
      head.textContent = t('recentHead');
      results.appendChild(head);
      for (const r of recents) {
        const row = panelRow(typeIcon('board'), r.title || t('untitled'));
        if (r.icon) {
          const ic = row.querySelector('.sp-ricon') as HTMLElement | null;
          if (ic) {
            ic.textContent = '';
            mountBoardIcon(ic, r.icon, r.title);
          }
        }
        row.classList.add('sp-hit');
        row.addEventListener('click', () => opts.onJump({ boardId: r.boardId, icon: '', snippet: '', modifiedAt: 0 }));
        results.appendChild(row);
      }
      return;
    }
    const cacheKey = `${scope.value}|${q}`;
    if (cacheKey !== cacheQ) {
      cacheQ = cacheKey;
      cacheHits = opts.search(q, scope.value as SearchScope);
    }
    const hits = sortHits(cacheHits, sort.value as SearchSort, opts.recentIds());
    if (!hits.length) {
      results.appendChild(panelEmpty(t('searchEmpty')));
      return;
    }
    const count = document.createElement('div');
    count.className = 'sp-group';
    count.textContent = hits.length === 1 ? t('matchOne') : t('matchCount').replace('{n}', String(hits.length));
    results.appendChild(count);
    for (const h of hits) {
      const where = h.unsorted ? t('unsortedTitle') : (h.boardTitle ?? '');
      const row = panelRow(h.icon, h.snippet, where || undefined);
      row.classList.add('sp-hit');
      row.addEventListener('click', () => opts.onJump({ ...h, query: input.value.trim() }));
      results.appendChild(row);
    }
  };

  // Board search scans every element: debounce the re-scan per
  // keystroke; sort flips re-render instantly against cached hits.
  const DEBOUNCE_MS = 120;
  let timer = 0;
  const innerClose = handle.close;
  handle.close = () => {
    window.clearTimeout(timer);
    innerClose();
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, DEBOUNCE_MS);
  });
  const nav = (dir: 1 | -1) => {
    const rows = [...results.querySelectorAll<HTMLElement>('.sp-hit')];
    if (!rows.length) return;
    navIdx = (navIdx + dir + rows.length) % rows.length;
    rows.forEach((r, i) => {
      r.classList.toggle('nav', i === navIdx);
    });
    rows[navIdx]!.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      handle.close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nav(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      nav(-1);
      return;
    }
    if (e.key === 'Enter') {
      const rows = results.querySelectorAll<HTMLElement>('.sp-hit');
      (rows[Math.max(0, navIdx)] ?? rows[0])?.click();
    }
  });
  sort.addEventListener('change', render);
  scope.addEventListener('change', render);
  render();
  input.focus();
  return handle;
}
