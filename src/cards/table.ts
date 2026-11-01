import type { CellType, Element, TableCell, TableDoc } from '../state/schema';
import { tableDoc } from '../state/schema';
import { t } from '../strings';
import { evalFormula, isFormula, remapCells, FORMULA_NAMES } from './formula';
import { openToolPopup, type ToolPopup } from '../ui/popup';
import { ensureBlockChildren, isBlankSurface, richKeydown } from '../ui/richtext';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';
import { fmtCurrency, fmtDate, fmtNumber } from '../ui/locale';

// Display text for a non-editing cell: formulas evaluate, typed cells
// format their stored text, auto/text render raw. Number/currency/date
// formats honour the locale + currency settings via locale.ts.
function displayOf(cell: TableCell, cells: TableCell[][]): string {
  const raw = cell.text;
  if (isFormula(raw)) return evalFormula(raw, cells) ?? raw;
  const n = parseFloat(raw.trim());
  const num = Number.isFinite(n) && raw.trim() !== '';
  switch (cell.type ?? 'auto') {
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

// Table card: title row, CSS grid of rich-text cells, caption row.
// Cell focus lives in the view: a click focuses a cell (cell rail),
// dbl-click or typing enters text edit on it. The whole card is one
// undo-group edit session, like the todo card.
export class TableCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private titleEl: HTMLElement;
  private gridEl: HTMLElement;
  private capEl: HTMLElement;
  private handle: HTMLElement;
  private ro: ResizeObserver;
  private cellEls: HTMLElement[][] = [];
  private focus: { r: number; c: number } | null = null;
  private editingCell = false;
  private fieldEl: HTMLElement | null = null;
  private wantDomFocus = false;
  private fx: { pop: ToolPopup; node: HTMLElement } | null = null;
  private lastTitle = '';
  private lastCap = '';
  private downAt = { x: 0, y: 0 };
  private grips: HTMLElement | null = null;
  private gripDrag = false;
  private colSig = '';

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card table';
    this.node.dataset.id = el.id;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'tb-title';
    this.titleEl.dataset.ph = t('addTitle');
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'tb-grid';
    this.capEl = document.createElement('div');
    this.capEl.className = 'tb-cap';
    this.capEl.dataset.ph = t('captionPlaceholder');
    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    this.node.append(this.titleEl, this.gridEl, this.capEl, this.handle);

    this.node.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    // While a session is open, clicks on the grid and fields stay inside
    // the card: focus moves instead of ending the session or dragging.
    this.gridEl.addEventListener('pointerdown', (e) => {
      if (this.editing) e.stopPropagation();
    });
    this.gridEl.addEventListener('click', (e) => {
      if (!this.editing) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
      const cellEl = (e.target as HTMLElement).closest('.tb-cell') as HTMLElement | null;
      if (!cellEl || (e.target as HTMLElement).closest('[data-noclick]')) return;
      this.focusCell(+cellEl.dataset.r!, +cellEl.dataset.c!, false);
    });
    this.gridEl.addEventListener('dblclick', (e) => {
      if (!this.editing) return;
      e.stopPropagation();
      const cellEl = (e.target as HTMLElement).closest('.tb-cell') as HTMLElement | null;
      if (cellEl) this.focusCell(+cellEl.dataset.r!, +cellEl.dataset.c!, true);
    });
    this.gridEl.addEventListener('keydown', (e) => this.onCellKeydown(e));
    this.gridEl.addEventListener('input', (e) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement) return;
      const cellEl = target.closest('.tb-cell') as HTMLElement | null;
      if (cellEl) this.pushCell(cellEl);
    });
    this.gridEl.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const cellEl = input.closest('.tb-cell') as HTMLElement | null;
      if (input.type === 'checkbox' && cellEl) {
        this.setCellText(+cellEl.dataset.r!, +cellEl.dataset.c!, input.checked ? '1' : '0');
        if (this.editing) this.focusCell(+cellEl.dataset.r!, +cellEl.dataset.c!, false);
      }
    });

    const fieldDown = (field: 'title' | 'caption', el: HTMLElement) => {
      el.addEventListener('pointerdown', (e) => {
        if (!this.editing || this.fieldEl === el) return;
        e.stopPropagation();
        this.focusField(field);
      });
    };
    fieldDown('title', this.titleEl);
    fieldDown('caption', this.capEl);
    this.titleEl.addEventListener('input', () => this.pushField('title'));
    this.capEl.addEventListener('input', () => this.pushField('caption'));
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.focusCell(0, 0, false);
      }
    });
    this.capEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.ctx.events.onEditEnd(this.id);
      }
    });
    for (const f of [this.titleEl, this.capEl]) {
      f.addEventListener('blur', (e) => {
        if (!this.editing) return;
        const rel = (e as FocusEvent).relatedTarget as Node | null;
        if (rel && this.node.contains(rel)) return;
        this.ctx.events.onEditEnd(this.id);
      });
    }

    this.ro = new ResizeObserver(() => {
      this.ctx.events.onMeasure(this.id, this.node.offsetHeight);
    });
    this.ro.observe(this.node);
    this.update(el);
  }

  private content(): TableDoc | null {
    const el = this.ctx.doc.elements[this.id];
    return el ? tableDoc(el) : null;
  }

  private dispatch(table: TableDoc) {
    this.ctx.events.onContent(this.id, { table });
  }

  private cellAt(r: number, c: number): TableCell | null {
    return this.content()?.cells[r]?.[c] ?? null;
  }

  // --- focus ---

  cellFocused(): boolean {
    return this.focus !== null;
  }

  focusedCell(): { r: number; c: number } | null {
    return this.focus;
  }

  focusedCellData(): TableCell | null {
    return this.focus ? this.cellAt(this.focus.r, this.focus.c) : null;
  }

  private focusCell(r: number, c: number, edit: boolean) {
    this.fieldEl = null;
    this.titleEl.contentEditable = 'false';
    this.capEl.contentEditable = 'false';
    this.editingCell = edit;
    this.focus = { r, c };
    this.wantDomFocus = true;
    this.syncFocusDom();
    this.ctx.events.onCellFocus?.(this.id);
  }

  startCellEdit() {
    const f = this.focus ?? { r: 0, c: 0 };
    this.focusCell(f.r, f.c, true);
  }

  private focusField(field: 'title' | 'caption') {
    this.focus = null;
    this.editingCell = false;
    this.fieldEl = field === 'title' ? this.titleEl : this.capEl;
    this.titleEl.contentEditable = field === 'title' ? 'true' : 'false';
    this.capEl.contentEditable = field === 'caption' ? 'true' : 'false';
    for (const row of this.cellEls) {
      for (const el of row) el.classList.remove('focused');
    }
    this.fieldEl.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(this.fieldEl);
    sel.collapseToEnd();
    this.ctx.events.onCellFocus?.(this.id);
  }

  private syncFocusDom() {
    for (let r = 0; r < this.cellEls.length; r++) {
      for (let c = 0; c < this.cellEls[r]!.length; c++) {
        const el = this.cellEls[r]![c]!;
        const on = !!this.focus && this.focus.r === r && this.focus.c === c;
        el.classList.toggle('focused', on);
        if (on && this.editingCell) this.makeEditable(el);
      }
    }
    if (this.focus && this.wantDomFocus) {
      this.wantDomFocus = false;
      const el = this.cellEls[this.focus.r]?.[this.focus.c];
      if (el) {
        el.focus();
        if (this.editingCell) {
          const sel = getSelection()!;
          sel.selectAllChildren(el);
          sel.collapseToEnd();
        }
      }
    }
  }

  // Swap the display render for the raw editable text/html.
  private makeEditable(el: HTMLElement) {
    if (el.contentEditable === 'true') return;
    const cell = this.cellAt(+el.dataset.r!, +el.dataset.c!);
    if (!cell) return;
    // Clearing the children drops a checkbox input; reset kind so
    // syncCell rebuilds it when the text edit ends.
    el.dataset.kind = '';
    el.textContent = '';
    if (cell.html && !isFormula(cell.text)) el.innerHTML = cell.html;
    else el.textContent = cell.text;
    el.contentEditable = 'true';
    ensureBlockChildren(el);
  }

  // --- keys ---

  private onCellKeydown(e: KeyboardEvent) {
    const cellEl = (e.target as HTMLElement).closest('.tb-cell') as HTMLElement | null;
    if (!cellEl || !this.focus) return;
    const editingThis = this.editingCell && +cellEl.dataset.r! === this.focus.r && +cellEl.dataset.c! === this.focus.c;
    const meta = e.metaKey || e.ctrlKey;
    if (e.altKey && !meta && e.key.startsWith('Arrow')) {
      e.preventDefault();
      e.stopPropagation();
      this.arrowOp(e.key);
      return;
    }
    if (editingThis) {
      this.editKeydown(e, cellEl);
    } else {
      this.focusKeydown(e, +cellEl.dataset.r!, +cellEl.dataset.c!);
    }
  }

  private arrowOp(key: string) {
    const f = this.focus;
    if (!f) return;
    if (key === 'ArrowUp') this.insertRow(f.r);
    else if (key === 'ArrowDown') this.insertRow(f.r + 1);
    else if (key === 'ArrowLeft') this.insertColumn(f.c);
    else if (key === 'ArrowRight') this.insertColumn(f.c + 1);
  }

  // Navigation/commit keys while a cell is text-editing. Escape bubbles
  // to the app and ends the session.
  private editKeydown(e: KeyboardEvent, cellEl: HTMLElement) {
    const meta = e.metaKey || e.ctrlKey;
    if (this.fx && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const first = this.fx.node.querySelector<HTMLElement>('.pop-row');
      first?.click();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !meta) {
      e.preventDefault();
      e.stopPropagation();
      this.moveFocus(1, 0);
      return;
    }
    if (e.key === 'Tab' && !meta) {
      e.preventDefault();
      e.stopPropagation();
      this.moveFocus(0, e.shiftKey ? -1 : 1);
      return;
    }
    if (richKeydown(cellEl, e, { openLink: () => this.ctx.events.onLinkPopup(this.id) })) {
      e.stopPropagation();
    }
  }

  // Keys on a focused (not text-editing) cell. Everything handled is
  // stopped so global shortcuts (nudge, delete, single-letter) stay out.
  private focusKeydown(e: KeyboardEvent, r: number, c: number) {
    const meta = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.ctx.events.onEditEnd(this.id);
        return;
      case 'Enter':
        if (!meta) {
          e.preventDefault();
          e.stopPropagation();
          this.moveFocus(1, 0);
        }
        return;
      case 'Tab':
        if (!meta) {
          e.preventDefault();
          e.stopPropagation();
          this.moveFocus(0, e.shiftKey ? -1 : 1);
        }
        return;
      case 'Backspace':
      case 'Delete':
        if (!meta) {
          e.preventDefault();
          e.stopPropagation();
          this.clearCell(r, c);
        }
        return;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(-1, 0);
        return;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(1, 0);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(0, -1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(0, 1);
        return;
    }
    if (e.key.length === 1 && !meta && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      this.focusCell(r, c, true);
      const el = this.cellEls[r]?.[c];
      if (el) document.execCommand('insertText', false, e.key);
    }
  }

  private moveFocus(dr: number, dc: number) {
    const c = this.content();
    const f = this.focus;
    if (!c || !f) return;
    const rows = c.cells.length;
    const cols = c.cells[0]?.length ?? 0;
    let r = f.r;
    let col = f.c + dc;
    if (dc !== 0) {
      if (col >= cols) {
        col = 0;
        r += 1;
      } else if (col < 0) {
        col = cols - 1;
        r -= 1;
      }
    }
    r = Math.max(0, Math.min(rows - 1, r + dr));
    col = Math.max(0, Math.min(cols - 1, col));
    this.focusCell(r, col, false);
  }

  // --- content pushes (all inside the app's edit-session group) ---

  private pushCell(cellEl: HTMLElement) {
    const c = this.content();
    if (!c) return;
    const r = +cellEl.dataset.r!;
    const col = +cellEl.dataset.c!;
    const cell = c.cells[r]?.[col];
    if (!cell) return;
    if (isBlankSurface(cellEl)) cellEl.innerHTML = '';
    const text = cellEl.innerText.replace(/\n$/, '');
    const html = cellEl.innerHTML;
    if (cell.text === text && cell.html === html) return;
    const cells = c.cells.map((row) => row.slice());
    cells[r]![col] = { ...cell, text, html };
    this.dispatch({ ...c, cells });
    if (/^=[A-Za-z]*$/.test(text)) this.openFx(cellEl);
    else this.closeFx();
  }

  private setCellText(r: number, c: number, text: string) {
    const doc = this.content();
    const cell = doc?.cells[r]?.[c];
    if (!doc || !cell) return;
    const cells = doc.cells.map((row) => row.slice());
    const next: TableCell = { ...cell, text };
    delete next.html;
    cells[r]![c] = next;
    this.dispatch({ ...doc, cells });
  }

  private pushField(field: 'title' | 'caption') {
    const c = this.content();
    if (!c) return;
    const text = (field === 'title' ? this.titleEl : this.capEl).innerText.replace(/\n/g, '');
    if (field === 'title' && text !== c.title) this.dispatch({ ...c, title: text });
    if (field === 'caption' && text !== c.caption) this.dispatch({ ...c, caption: text });
  }

  // --- cell + structure ops (rail + Opt+arrows share these) ---

  // Undefined values clear the key (ElementPatch semantics).
  patchFocused(patch: { [K in keyof TableCell]?: TableCell[K] | undefined }) {
    const c = this.content();
    const f = this.focus;
    if (!c || !f) return;
    const cell = c.cells[f.r]?.[f.c];
    if (!cell) return;
    const next: TableCell = { ...cell };
    for (const [k, v] of Object.entries(patch) as [keyof TableCell, unknown][]) {
      if (v === undefined) delete next[k];
      else (next as unknown as Record<string, unknown>)[k] = v;
    }
    const cells = c.cells.map((row) => row.slice());
    cells[f.r]![f.c] = next;
    this.dispatch({ ...c, cells });
  }

  setCellType(type: CellType | undefined) {
    this.patchFocused({ type });
  }

  clearCell(r: number, c: number) {
    const doc = this.content();
    if (!doc?.cells[r]?.[c]) return;
    const cells = doc.cells.map((row) => row.slice());
    cells[r]![c] = { text: '' };
    this.dispatch({ ...doc, cells });
  }

  clearFocusedCell() {
    if (this.focus) this.clearCell(this.focus.r, this.focus.c);
  }

  insertRow(at: number) {
    const c = this.content();
    const f = this.focus;
    if (!c || !f) return;
    const cols = c.cells[0]?.length ?? 0;
    const cells = c.cells.map((row) => row.slice());
    cells.splice(at, 0, Array.from({ length: cols }, () => ({ text: '' })));
    this.editingCell = false;
    if (at <= f.r) f.r += 1;
    this.wantDomFocus = true;
    this.dispatch({ ...c, cells: remapCells(cells, (r, cc) => ({ r: r >= at ? r + 1 : r, c: cc })) });
  }

  insertColumn(at: number) {
    const c = this.content();
    const f = this.focus;
    if (!c || !f) return;
    const cells = c.cells.map((row) => {
      const next = row.slice();
      next.splice(at, 0, { text: '' });
      return next;
    });
    this.editingCell = false;
    if (at <= f.c) f.c += 1;
    this.wantDomFocus = true;
    const next: TableDoc = { ...c, cells: remapCells(cells, (r, cc) => ({ r, c: cc >= at ? cc + 1 : cc })) };
    if (c.widths) {
      const widths = c.widths.slice();
      widths.splice(at, 0, widths[at - 1] ?? 64);
      next.widths = widths;
    }
    this.dispatch(next);
  }

  deleteFocusedRow() {
    const c = this.content();
    const f = this.focus;
    if (!c || !f || c.cells.length <= 1) return;
    const cells = c.cells.map((row) => row.slice());
    cells.splice(f.r, 1);
    this.editingCell = false;
    f.r = Math.min(f.r, cells.length - 1);
    this.wantDomFocus = true;
    this.dispatch({ ...c, cells: remapCells(cells, (r, cc) => ({ r: r > f.r ? r - 1 : r, c: cc })) });
  }

  deleteFocusedColumn() {
    const c = this.content();
    const f = this.focus;
    if (!c || !f || (c.cells[0]?.length ?? 0) <= 1) return;
    const cells = c.cells.map((row) => {
      const next = row.slice();
      next.splice(f.c, 1);
      return next;
    });
    this.editingCell = false;
    f.c = Math.min(f.c, cells[0]!.length - 1);
    this.wantDomFocus = true;
    const next: TableDoc = { ...c, cells: remapCells(cells, (r, cc) => ({ r, c: cc > f.c ? cc - 1 : cc })) };
    if (c.widths) {
      const widths = c.widths.slice();
      widths.splice(f.c, 1);
      next.widths = widths;
    }
    this.dispatch(next);
  }

  // Column reorder from the top grip strip: move src col to index dst,
  // cells and widths splice together so layouts stay in sync.
  private moveColumn(src: number, dst: number) {
    const c = this.content();
    if (!c || src === dst) return;
    const cells = c.cells.map((row) => {
      const next = row.slice();
      next.splice(dst, 0, next.splice(src, 1)[0]!);
      return next;
    });
    const next: TableDoc = {
      ...c,
      cells: remapCells(cells, (r, cc) => ({
        r,
        c: cc === src ? dst : src < dst ? (cc > src && cc <= dst ? cc - 1 : cc) : cc >= dst && cc < src ? cc + 1 : cc,
      })),
    };
    if (c.widths) {
      const widths = c.widths.slice();
      widths.splice(dst, 0, widths.splice(src, 1)[0]!);
      next.widths = widths;
    }
    const f = this.focus;
    if (f) {
      if (f.c === src) f.c = dst;
      else if (src < f.c && dst >= f.c) f.c -= 1;
      else if (src > f.c && dst <= f.c) f.c += 1;
      this.wantDomFocus = true;
    }
    this.dispatch(next);
  }

  // Fill widths with rendered column px on first resize/reorder touch
  // so a single drag never jumps the other columns.
  private materializeWidths(): number[] {
    const c = this.content();
    const cols = c?.cells[0]?.length ?? 0;
    const cur = c?.widths ?? [];
    const out: number[] = [];
    for (let i = 0; i < cols; i++) {
      out.push(cur[i] ?? Math.round(this.cellEls[0]?.[i]?.offsetWidth ?? 64));
    }
    return out;
  }

  private setColWidth(ci: number, w: number) {
    const c = this.content();
    if (!c) return;
    const widths = this.materializeWidths();
    widths[ci] = Math.max(40, Math.round(w));
    this.dispatch({ ...c, widths });
  }

  // Column edge resize + header-strip reorder grips, mounted only while
  // editing. Positions come from the first-row cell offsets.
  private syncGrips() {
    // A resize/reorder drag owns the grips: rebuilding mid-gesture would
    // remove the captured element and kill the in-flight pointer stream.
    if (this.gripDrag) return;
    if (!this.editing) {
      this.grips?.remove();
      this.grips = null;
      return;
    }
    const c = this.content();
    const cols = c?.cells[0]?.length ?? 0;
    const row0 = this.cellEls[0];
    if (!c || !cols || !row0?.length) {
      this.grips?.remove();
      this.grips = null;
      return;
    }
    if (!this.grips) {
      this.grips = document.createElement('div');
      this.grips.className = 'tb-grips';
      this.grips.dataset.noclick = '1';
      this.gridEl.appendChild(this.grips);
    }
    this.grips.textContent = '';
    const h = this.gridEl.offsetHeight;
    for (let ci = 0; ci < cols; ci++) {
      const cell = row0[ci]!;
      const x = cell.offsetLeft;
      const w = cell.offsetWidth;

      const grip = document.createElement('div');
      grip.className = 'tb-grip';
      grip.style.left = `${x}px`;
      grip.style.width = `${w}px`;
      grip.dataset.noclick = '1';
      this.bindColDrag(grip, ci);
      this.grips.appendChild(grip);

      if (ci < cols) {
        const edge = document.createElement('div');
        edge.className = 'tb-edge';
        // Grip widths counter-scale with zoom, so the offset does too.
        edge.style.left = `${x + w - 3 / this.scale()}px`;
        edge.style.height = `${h}px`;
        edge.dataset.noclick = '1';
        this.bindColResize(edge, ci, w);
        this.grips.appendChild(edge);
      }
    }
    // Row grips mirror the column grips on the left edge.
    for (let ri = 0; ri < this.cellEls.length; ri++) {
      const cell = this.cellEls[ri]![0];
      if (!cell) continue;
      const grip = document.createElement('div');
      grip.className = 'tb-rgrip';
      grip.style.top = `${cell.offsetTop}px`;
      grip.style.height = `${cell.offsetHeight}px`;
      grip.dataset.noclick = '1';
      this.bindRowDrag(grip, ri);
      this.grips.appendChild(grip);
    }
  }

  // Accent insertion line shown at the row/column boundary a grip drag
  // would drop onto (same idea as .drop-hint on columns).
  private gripMark(axis: 'h' | 'v', at: number) {
    if (!this.grips) return;
    let m = this.grips.querySelector<HTMLElement>('.tb-mark');
    if (!m) {
      m = document.createElement('div');
      this.grips.appendChild(m);
    }
    m.className = `tb-mark ${axis}`;
    if (axis === 'h') m.style.top = `${at}px`;
    else m.style.left = `${at}px`;
  }

  private bindRowDrag(grip: HTMLElement, ri: number) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      this.gripDrag = true;
      const centers = this.cellEls.map((row) => {
        const r = row[0]!.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      let dst = ri;
      let moved = false;
      const move = (ev: PointerEvent) => {
        moved = true;
        const raw = centers.findIndex((cy) => ev.clientY < cy);
        dst = raw < 0 ? centers.length - 1 : raw;
        const cell = this.cellEls[dst]?.[0];
        if (cell) this.gripMark('h', raw < 0 ? cell.offsetTop + cell.offsetHeight : cell.offsetTop);
        grip.classList.add('tb-grip-drag');
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        grip.classList.remove('tb-grip-drag');
        this.gripDrag = false;
        if (ev.type === 'pointerup' && moved && Math.abs(ev.clientY - e.clientY) > 4) this.moveRow(ri, dst);
        this.syncGrips();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private moveRow(src: number, dst: number) {
    const c = this.content();
    if (!c || src === dst) return;
    const cells = c.cells.slice();
    cells.splice(dst, 0, cells.splice(src, 1)[0]!);
    const f = this.focus;
    if (f) {
      if (f.r === src) f.r = dst;
      else if (src < f.r && dst >= f.r) f.r -= 1;
      else if (src > f.r && dst <= f.r) f.r += 1;
      this.wantDomFocus = true;
    }
    this.dispatch({
      ...c,
      cells: remapCells(cells, (r, cc) => ({
        r: r === src ? dst : src < dst ? (r > src && r <= dst ? r - 1 : r) : r >= dst && r < src ? r + 1 : r,
        c: cc,
      })),
    });
  }

  private bindColResize(edge: HTMLElement, ci: number, w0: number) {
    edge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const x0 = e.clientX;
      edge.setPointerCapture(e.pointerId);
      this.gripDrag = true;
      const move = (ev: PointerEvent) => {
        this.setColWidth(ci, w0 + (ev.clientX - x0) / this.scale());
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        this.gripDrag = false;
        this.syncGrips();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private bindColDrag(grip: HTMLElement, ci: number) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const row0 = this.cellEls[0];
      if (!row0) return;
      this.gripDrag = true;
      const centers = row0.map((cell) => {
        const r = cell.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      let dst = ci;
      let moved = false;
      const move = (ev: PointerEvent) => {
        moved = true;
        const raw = centers.findIndex((cx) => ev.clientX < cx);
        dst = raw < 0 ? centers.length - 1 : raw;
        const cell = row0[dst];
        if (cell) this.gripMark('v', raw < 0 ? cell.offsetLeft + cell.offsetWidth : cell.offsetLeft);
        grip.classList.add('tb-grip-drag');
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        grip.classList.remove('tb-grip-drag');
        this.gripDrag = false;
        if (ev.type === 'pointerup' && moved && Math.abs(ev.clientX - e.clientX) > 4) this.moveColumn(ci, dst);
        this.syncGrips();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private scale(): number {
    const r = this.gridEl.getBoundingClientRect();
    return r.width > 0 && this.gridEl.offsetWidth > 0 ? r.width / this.gridEl.offsetWidth : 1;
  }

  // Rail Formula tool: focus a cell, make sure it starts with '=' and
  // open the function autocomplete.
  insertFormula() {
    const f = this.focus ?? { r: 0, c: 0 };
    this.focusCell(f.r, f.c, true);
    const el = this.cellEls[f.r]?.[f.c];
    if (!el) return;
    const text = this.cellAt(f.r, f.c)?.text ?? '';
    if (!isFormula(text)) {
      el.textContent = `=${text}`;
      this.pushCell(el);
      const sel = getSelection()!;
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    this.openFx(el);
  }

  // --- formula autocomplete ---

  private fxFilter(cellEl: HTMLElement): string {
    const m = /^=([A-Za-z]*)/.exec(cellEl.innerText.replace(/\n$/, ''));
    return (m?.[1] ?? '').toUpperCase();
  }

  private openFx(cellEl: HTMLElement) {
    if (this.fx) {
      this.renderFx(cellEl);
      return;
    }
    const node = document.createElement('div');
    node.className = 'menu-body';
    node.addEventListener('pointerdown', (e) => e.preventDefault());
    const pop = openToolPopup(cellEl.getBoundingClientRect(), node);
    this.fx = { pop, node };
    this.renderFx(cellEl);
  }

  private renderFx(cellEl: HTMLElement) {
    if (!this.fx) return;
    const filter = this.fxFilter(cellEl);
    const names = FORMULA_NAMES.filter((n) => n.startsWith(filter));
    if (!names.length) {
      this.closeFx();
      return;
    }
    this.fx.node.textContent = '';
    for (const name of names) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pop-row';
      const lab = document.createElement('span');
      lab.className = 'pop-label';
      lab.textContent = name;
      row.appendChild(lab);
      row.addEventListener('click', () => this.pickFx(name));
      this.fx.node.appendChild(row);
    }
  }

  private pickFx(name: string) {
    const f = this.focus;
    const el = f ? this.cellEls[f.r]?.[f.c] : null;
    this.closeFx();
    if (!el) return;
    el.textContent = `=${name}(`;
    this.pushCell(el);
    el.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(el);
    sel.collapseToEnd();
  }

  private closeFx() {
    this.fx?.pop.close();
    this.fx = null;
  }

  // --- card view ---

  editSurface(): HTMLElement | null {
    return this.editingCell && this.focus ? (this.cellEls[this.focus.r]?.[this.focus.c] ?? null) : null;
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 300}px`;
    s.background = cardBg(el.color);
    const c = tableDoc(el);
    if (!c) return;
    this.node.classList.toggle('has-title', !!c.title);
    this.node.classList.toggle('has-cap', !!c.caption);
    if (this.fieldEl !== this.titleEl && c.title !== this.lastTitle) {
      this.titleEl.textContent = c.title;
      this.lastTitle = c.title;
    }
    if (this.fieldEl !== this.capEl && c.caption !== this.lastCap) {
      this.capEl.textContent = c.caption;
      this.lastCap = c.caption;
    }
    const rows = c.cells.length;
    const cols = c.cells[0]?.length ?? 0;
    if (rows !== this.cellEls.length || cols !== (this.cellEls[0]?.length ?? 0)) {
      this.buildGrid(rows, cols);
    }
    const csig = `${cols}:${(c.widths ?? []).join(',')}`;
    if (csig !== this.colSig) {
      this.colSig = csig;
      this.gridEl.style.gridTemplateColumns = c.widths
        ? c.widths.map((w) => `${w}px`).join(' ')
        : `repeat(${cols}, 1fr)`;
    }
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) this.syncCell(r, col, c);
    }
    this.syncFocusDom();
    this.syncGrips();
  }

  private buildGrid(rows: number, cols: number) {
    this.gridEl.textContent = '';
    this.grips = null;
    this.colSig = '';
    this.cellEls = [];
    for (let r = 0; r < rows; r++) {
      const row: HTMLElement[] = [];
      for (let c = 0; c < cols; c++) {
        const el = document.createElement('div');
        el.className = 'tb-cell';
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.tabIndex = -1;
        row.push(el);
        this.gridEl.appendChild(el);
      }
      this.cellEls.push(row);
    }
  }

  private syncCell(r: number, c: number, doc: TableDoc) {
    const cell = doc.cells[r]?.[c];
    const el = this.cellEls[r]?.[c];
    if (!cell || !el) return;
    const type = cell.type ?? 'auto';
    el.classList.toggle('tb-empty', cell.text === '' && type !== 'checkbox');
    el.style.background = cell.color ?? '';
    el.dataset.h = cell.alignH ?? 'left';
    el.dataset.v = cell.alignV ?? 'top';
    if (this.editingCell && this.focus?.r === r && this.focus?.c === c) return;
    el.contentEditable = 'false';
    if (type === 'checkbox') {
      if (el.dataset.kind !== 'checkbox') {
        el.dataset.kind = 'checkbox';
        el.textContent = '';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'cell-checkbox';
        input.dataset.noclick = '1';
        el.appendChild(input);
      }
      (el.firstChild as HTMLInputElement).checked = cell.text === '1';
      return;
    }
    if (el.dataset.kind === 'checkbox') {
      el.dataset.kind = '';
      el.textContent = '';
    }
    const rich = !isFormula(cell.text) && (type === 'auto' || type === 'text') && cell.html;
    if (rich) {
      if (el.innerHTML !== cell.html) el.innerHTML = cell.html!;
    } else {
      const shown = displayOf(cell, doc.cells);
      if (el.innerText !== shown) el.textContent = shown;
    }
  }

  setSelected(on: boolean) {
    this.node.classList.toggle('selected', on);
  }

  setHandle(on: boolean) {
    this.node.classList.toggle('handle', on);
  }

  beginEdit(pos?: { x: number; y: number }, field?: string) {
    this.editing = true;
    this.node.classList.add('editing');
    if (field === 'title' || field === 'caption') {
      this.focusField(field);
      return;
    }
    if (field === 'cell') {
      const f = this.focus ?? { r: 0, c: 0 };
      this.focusCell(f.r, f.c, false);
      return;
    }
    const target = pos ? document.elementFromPoint(pos.x, pos.y) : null;
    if (target && this.titleEl.contains(target)) {
      this.focusField('title');
      return;
    }
    if (target && this.capEl.contains(target)) {
      this.focusField('caption');
      return;
    }
    const cellEl = target instanceof HTMLElement ? (target.closest('.tb-cell') as HTMLElement | null) : null;
    if (cellEl && this.gridEl.contains(cellEl)) {
      this.focusCell(+cellEl.dataset.r!, +cellEl.dataset.c!, field === 'cell-edit');
      return;
    }
    const f = this.focus ?? { r: 0, c: 0 };
    this.focusCell(f.r, f.c, field === 'cell-edit');
  }

  endEdit(): string {
    this.editing = false;
    this.editingCell = false;
    this.focus = null;
    this.fieldEl = null;
    this.wantDomFocus = false;
    this.closeFx();
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
    this.capEl.contentEditable = 'false';
    for (const row of this.cellEls) {
      for (const el of row) {
        el.contentEditable = 'false';
        el.classList.remove('focused');
      }
    }
    if (this.node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    getSelection()?.removeAllRanges();
    return '';
  }

  destroy() {
    this.closeFx();
    this.ro.disconnect();
    this.node.remove();
  }
}
