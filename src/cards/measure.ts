import {
  annotationDoc,
  columnTitle,
  commentDoc,
  defaultWidth,
  documentDoc,
  embedDoc,
  headingDoc,
  imageDoc,
  linkDoc,
  noteText,
  strokesBBoxCached,
  tableDoc,
  todoDoc,
  type Element as El,
  type ID,
} from '../state/schema';

// Column member geometry mirrors .card.column/.col-body in style.css:
// 10px card padding, a head row (title + member count), an 8px body
// top margin, then members stacked with 8px gaps.
export const COL_PAD = 10;
export const COL_GAP = 8;
// Chip rows (labels/reactions) render 6px under a member and ~18 tall;
// members with chips get this much extra room below them so the row
// lands in the gap instead of on the next card.
export const COL_CHIPS = 20;
const COL_COUNT_H = 18;
const COL_BODY_TOP = 8;
const COL_TITLE_MIN = 20;
const COL_TITLE_LH = 20.3;

export function memberChipPad(el: El): number {
  return el.labels.length || el.reactions?.length ? COL_CHIPS : 0;
}

export function colHeadH(el: El, w = el.w ?? defaultWidth(el)): number {
  const title = columnTitle(el);
  const cpl = Math.max(8, Math.floor((w - COL_PAD * 2) / 7.4));
  const lines = title.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
  return Math.max(COL_TITLE_MIN, lines * COL_TITLE_LH) + COL_COUNT_H;
}

// Column-space y where the member stack starts.
export function colBodyTop(el: El, w = el.w ?? defaultWidth(el)): number {
  return COL_PAD + colHeadH(el, w) + COL_BODY_TOP;
}

// Pre-mount height estimate per card type. The ResizeObserver's real
// measurement replaces it once a view mounts, so each formula only has
// to track its card's DOM/CSS closely enough for viewport culling -
// keep them beside the card files they mirror. `heightOf` recurses for
// column members; `members` supplies the column's member list. `w` is
// the width the card renders at: column members ignore el.w and take
// the column's inner width.
export function fallbackHeight(
  el: El,
  heightOf: (el: El, w?: number) => number,
  members: (id: ID) => El[],
  w = el.w ?? defaultWidth(el),
): number {
  if (el.type === 'board') return 64;
  if (el.type === 'swatch') return 176;
  if (el.type === 'todo') {
    const c = todoDoc(el);
    const items = c?.items.length ?? 1;
    return 20 + (c?.showTitle ? 26 : 0) + items * 27;
  }
  if (el.type === 'heading') {
    const c = headingDoc(el);
    const lh = c?.level === 2 ? 24 : 32;
    const cpl = Math.max(6, Math.floor((w - 20) / (c?.level === 2 ? 8 : 11)));
    const lines = (c?.text ?? '')
      .split('\n')
      .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
    return 10 + Math.max(1, lines) * lh;
  }
  if (el.type === 'comment') {
    const c = commentDoc(el);
    return 56 + (c?.items.length ?? 0) * 46;
  }
  if (el.type === 'link' || el.type === 'embed') {
    const c = linkDoc(el) ?? embedDoc(el);
    if (!c?.url) return 54;
    const hero = c.showPreview ? Math.round((w * 9) / 16) : 0;
    return hero + 62 + (c.caption ? 20 : 0);
  }
  if (el.type === 'image') {
    const c = imageDoc(el);
    const aspect = c?.aspect && c.aspect > 0 ? c.aspect : 1;
    return Math.round(w / aspect) + (c?.caption ? 26 : 14);
  }
  if (el.type === 'file') return 62;
  if (el.type === 'document') {
    const c = documentDoc(el);
    if (c?.displayMode !== 'detail') return 64;
    const cpl = Math.max(8, Math.floor((w - 28) / 7.4));
    const lines = (c?.text ?? '')
      .split('\n')
      .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
    return 74 + Math.min(320, lines * 20) + (c?.caption ? 22 : 0);
  }
  if (el.type === 'sketch') return Math.round(w * 0.75) + 16;
  if (el.type === 'table') {
    const c = tableDoc(el);
    const rows = c?.cells.length ?? 4;
    return 16 + rows * 34 + (c?.title ? 26 : 0) + (c?.caption ? 22 : 0);
  }
  if (el.type === 'annotation') {
    const c = annotationDoc(el);
    return c ? Math.max(1, Math.round(strokesBBoxCached(c.strokes).h)) : 0;
  }
  if (el.type === 'column') {
    const memberW = w - COL_PAD * 2;
    let h = colBodyTop(el, w) + COL_PAD;
    for (const m of members(el.id)) {
      if (m.type === 'line' || m.type === 'annotation') continue;
      h += heightOf(m, memberW) + COL_GAP + memberChipPad(m);
    }
    return h;
  }
  const text = noteText(el);
  const cpl = Math.max(8, Math.floor((w - 28) / 7.4));
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);
  return Math.round(26 + lines * 20.3);
}
