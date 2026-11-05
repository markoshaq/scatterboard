import type { Element, TableDoc } from '../../state/schema';
import type { CardCtx } from '../factory';

// What the grip layer reads or mutates on the card.
export interface GripHost {
  id: string;
  editing: boolean;
  ctx: CardCtx;
  gridEl: HTMLElement;
  cellEls: HTMLElement[][];
  content(): TableDoc | null;
  renderedW(el: Element): number;
  setColWidth(ci: number, w: number): void;
  moveRow(src: number, dst: number): void;
  moveColumn(src: number, dst: number): void;
}

// Column edge resize + header-strip reorder grips, mounted only while
// editing. Positions come from the first-row cell offsets.
export class TableGrips {
  private grips: HTMLElement | null = null;
  private gripDrag = false;
  private gripSig = '';

  constructor(private host: GripHost) {}

  // buildGrid wipes the grid (grip element with it); the sig survives
  // since the structure change already invalidates it.
  reset() {
    this.grips = null;
  }

  sync(force = false) {
    // A resize/reorder drag owns the grips: rebuilding mid-gesture would
    // remove the captured element and kill the in-flight pointer stream.
    if (this.gripDrag) return;
    if (!this.host.editing) {
      this.grips?.remove();
      this.grips = null;
      return;
    }
    const c = this.host.content();
    const cols = c?.cells[0]?.length ?? 0;
    const row0 = this.host.cellEls[0];
    if (!c || !cols || !row0?.length) {
      this.grips?.remove();
      this.grips = null;
      return;
    }
    // Grips rebind per rebuild and read cell offsets, so they only
    // rebuild when geometry can have moved: structure, widths, card
    // width or the zoom bucket (edge offsets counter-scale). Row moves
    // and buildGrid call with force since they keep the same sig.
    const el = this.host.ctx.doc.elements[this.host.id];
    const zb = Math.round((this.host.ctx.zoom?.() ?? 1) * 50);
    const sig = `${c.cells.length}|${cols}|${(c.widths ?? []).join(',')}|${el ? this.host.renderedW(el) : 0}|${zb}`;
    if (!force && this.grips && sig === this.gripSig) return;
    this.gripSig = sig;
    if (!this.grips) {
      this.grips = document.createElement('div');
      this.grips.className = 'tb-grips';
      this.grips.dataset.noclick = '1';
      this.host.gridEl.appendChild(this.grips);
    }
    this.grips.textContent = '';
    const h = this.host.gridEl.offsetHeight;
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
    for (let ri = 0; ri < this.host.cellEls.length; ri++) {
      const cell = this.host.cellEls[ri]?.[0];
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
      const pid = e.pointerId;
      const centers = this.host.cellEls.map((row) => {
        const r = row[0]!.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      let dst = ri;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        moved = true;
        const raw = centers.findIndex((cy) => ev.clientY < cy);
        dst = raw < 0 ? centers.length - 1 : raw;
        const cell = this.host.cellEls[dst]?.[0];
        if (cell) this.gripMark('h', raw < 0 ? cell.offsetTop + cell.offsetHeight : cell.offsetTop);
        grip.classList.add('tb-grip-drag');
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        grip.classList.remove('tb-grip-drag');
        this.gripDrag = false;
        if (ev.type === 'pointerup' && moved && Math.abs(ev.clientY - e.clientY) > 4) this.host.moveRow(ri, dst);
        this.sync(true);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private bindColResize(edge: HTMLElement, ci: number, w0: number) {
    edge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const x0 = e.clientX;
      edge.setPointerCapture(e.pointerId);
      this.gripDrag = true;
      const pid = e.pointerId;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        this.host.setColWidth(ci, w0 + (ev.clientX - x0) / this.scale());
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        this.gripDrag = false;
        this.sync(true);
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
      const row0 = this.host.cellEls[0];
      if (!row0) return;
      this.gripDrag = true;
      const pid = e.pointerId;
      const centers = row0.map((cell) => {
        const r = cell.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      let dst = ci;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        moved = true;
        const raw = centers.findIndex((cx) => ev.clientX < cx);
        dst = raw < 0 ? centers.length - 1 : raw;
        const cell = row0[dst];
        if (cell) this.gripMark('v', raw < 0 ? cell.offsetLeft + cell.offsetWidth : cell.offsetLeft);
        grip.classList.add('tb-grip-drag');
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        grip.classList.remove('tb-grip-drag');
        this.gripDrag = false;
        if (ev.type === 'pointerup' && moved && Math.abs(ev.clientX - e.clientX) > 4) this.host.moveColumn(ci, dst);
        this.sync(true);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private scale(): number {
    const gridEl = this.host.gridEl;
    const r = gridEl.getBoundingClientRect();
    return r.width > 0 && gridEl.offsetWidth > 0 ? r.width / gridEl.offsetWidth : 1;
  }
}
