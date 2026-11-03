import type { Element, ID } from '../state/schema';
import { columnMembers, columnTitle, lineDoc } from '../state/schema';
import { memberCount, t } from '../strings';
import type { CardView } from './note';
import { createCard, type CardCtx } from './factory';
import { cardBg, canvasColors } from '../ui/theme';
import { COL_CHIPS, memberChipPad } from './measure';
import { clipSeg, pointInRect } from '../canvas/hit';
import { LINE_W, type SceneLine } from '../canvas/renderer';
import type { Rect } from '../canvas/viewport';

export class ColumnCard implements CardView {
  id: ID;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private titleEl: HTMLElement;
  private countEl: HTMLElement;
  private body: HTMLElement;
  private members = new Map<ID, CardView>();
  private insertEl: HTMLElement | null = null;
  private topOff = -1;
  private lastTitle = '';
  private lineSvg: SVGSVGElement;
  private spanKey = '';

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.node = document.createElement('div');
    this.node.className = 'card column';
    this.node.dataset.id = el.id;

    const head = document.createElement('div');
    head.className = 'col-head';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'col-title';
    this.titleEl.dataset.ph = t('addTitle');
    this.countEl = document.createElement('div');
    this.countEl.className = 'col-count';
    head.append(this.titleEl, this.countEl);
    this.body = document.createElement('div');
    this.body.className = 'col-body';
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    // Lines attached to members draw between the column surface and the
    // member stack: the canvas stroke hides under the column's opaque
    // body, and chrome can't honour el.z.
    this.lineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lineSvg.setAttribute('class', 'col-lines');
    this.node.append(head, this.lineSvg, this.body, handle);

    this.titleEl.addEventListener('input', () => {
      this.lastTitle = this.readTitle();
      this.ctx.events.onTextInput(this.id, this.lastTitle);
    });
    this.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.ctx.events.onEditEnd(this.id);
      }
    });
    this.titleEl.addEventListener('blur', () => {
      if (this.editing) this.ctx.events.onEditEnd(this.id);
    });
    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private readTitle(): string {
    return this.titleEl.innerText.replace(/\n/g, '');
  }

  // Reorder-drag indicator: a bar seated as a flex child before the
  // member `beforeId` (or at the end) so the stack opens a visible
  // slot. It is not a member, so update() leaves it in place.
  showInsert(beforeId: ID | null) {
    if (!this.insertEl) {
      this.insertEl = document.createElement('div');
      this.insertEl.className = 'col-insert';
    }
    const el = this.insertEl;
    const ref = beforeId ? (this.members.get(beforeId)?.node ?? null) : null;
    if (el.parentNode !== this.body || el.nextSibling !== ref) this.body.insertBefore(el, ref);
  }

  hideInsert() {
    this.insertEl?.remove();
    this.insertEl = null;
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 280}px`;
    s.background = cardBg(el.color);
    const title = columnTitle(el);
    if (!this.editing && title !== this.lastTitle) {
      this.titleEl.textContent = title;
      this.lastTitle = title;
    }

    const list = (this.ctx.members?.(el.id) ?? columnMembers(this.ctx.doc, el.id)).filter(
      (m) => m.type !== 'line' && m.type !== 'annotation',
    );
    const seen = new Set(list.map((m) => m.id));
    for (const [mid, v] of this.members) {
      if (!seen.has(mid)) {
        this.ctx.unregisterView?.(v);
        v.destroy();
        this.members.delete(mid);
      }
    }
    let prev: Node | null = null;
    for (const m of list) {
      let v = this.members.get(m.id);
      if (!v) {
        v = createCard(m, this.ctx);
        this.members.set(m.id, v);
        this.ctx.registerView?.(v);
      }
      if (v.node.parentNode !== this.body || v.node.previousSibling !== prev) {
        this.body.insertBefore(v.node, prev ? prev.nextSibling : this.body.firstChild);
      }
      prev = v.node;
      v.update(m);
      // update() writes the member's stale pre-filing x/y/w inline;
      // clear them so the .col-body rules (relative, width:100%) apply.
      const ms = v.node.style;
      ms.left = ms.top = ms.width = '';
      ms.marginBottom = memberChipPad(m) ? `${COL_CHIPS}px` : '';
    }
    const docs = list.filter((m) => m.type === 'document').length;
    this.countEl.textContent = memberCount(list.length - docs, docs);
  }

  // Board-space line spans clipped to the column box, re-stroked in
  // card-local coords. Called per render; the rebuild key uses local
  // coords so a whole-column drag (spans ride along unchanged) skips it.
  setLineSpans(rect: Rect, lines: SceneLine[]) {
    const key = [
      `${Math.round(rect.w)},${Math.round(rect.h)}`,
      ...lines.map((l) => {
        const c = lineDoc(l.el);
        const pts = [l.x1 - rect.x, l.y1 - rect.y, l.x2 - rect.x, l.y2 - rect.y].map((v) => Math.round(v));
        return `${l.el.id}:${pts.join(',')}:${l.el.color ?? ''}:${c?.weight}:${c?.dashed ? 1 : 0}:${c?.fromMarker}:${c?.toMarker}:${l.dim ? 1 : 0}`;
      }),
    ].join('|');
    if (key === this.spanKey) return;
    this.spanKey = key;
    this.lineSvg.textContent = '';
    const NS = 'http://www.w3.org/2000/svg';
    const cc = canvasColors();
    const X = (v: number) => v - rect.x;
    const Y = (v: number) => v - rect.y;
    for (const l of lines) {
      const c = lineDoc(l.el);
      if (!c) continue;
      const t = clipSeg(l.x1, l.y1, l.x2, l.y2, rect);
      if (!t) continue;
      const w = LINE_W[c.weight];
      const ink = l.el.color ?? cc.ink;
      const seg = document.createElementNS(NS, 'line');
      seg.setAttribute('x1', `${X(l.x1 + (l.x2 - l.x1) * t[0])}`);
      seg.setAttribute('y1', `${Y(l.y1 + (l.y2 - l.y1) * t[0])}`);
      seg.setAttribute('x2', `${X(l.x1 + (l.x2 - l.x1) * t[1])}`);
      seg.setAttribute('y2', `${Y(l.y1 + (l.y2 - l.y1) * t[1])}`);
      seg.setAttribute('stroke', ink);
      seg.setAttribute('stroke-width', `${w}`);
      if (c.dashed) seg.setAttribute('stroke-dasharray', '5 5');
      if (l.dim) seg.setAttribute('opacity', '0.15');
      this.lineSvg.appendChild(seg);
      const mk = (x: number, y: number, ang: number, m: string) => {
        if (m === 'dot') {
          const d = document.createElementNS(NS, 'circle');
          d.setAttribute('cx', `${x}`);
          d.setAttribute('cy', `${y}`);
          d.setAttribute('r', `${2.2 + w * 0.8}`);
          d.setAttribute('fill', ink);
          this.lineSvg.appendChild(d);
        } else if (m === 'arrow') {
          const sz = 5 + w * 2.2;
          const bx = x - Math.cos(ang) * sz;
          const by = y - Math.sin(ang) * sz;
          const px = -Math.sin(ang) * sz * 0.42;
          const py = Math.cos(ang) * sz * 0.42;
          const p = document.createElementNS(NS, 'polygon');
          p.setAttribute('points', `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`);
          p.setAttribute('fill', ink);
          this.lineSvg.appendChild(p);
        }
      };
      if (pointInRect(l.x1, l.y1, rect))
        mk(X(l.x1), Y(l.y1), Math.atan2(l.y1 - l.y2, l.x1 - l.x2), c.fromMarker);
      if (pointInRect(l.x2, l.y2, rect))
        mk(X(l.x2), Y(l.y2), Math.atan2(l.y2 - l.y1, l.x2 - l.x1), c.toMarker);
    }
  }

  setSelected(on: boolean) {
    this.node.classList.toggle('selected', on);
  }

  setHandle(on: boolean) {
    this.node.classList.toggle('handle', on);
  }

  beginEdit() {
    this.editing = true;
    this.node.classList.add('editing');
    this.titleEl.contentEditable = 'true';
    this.titleEl.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(this.titleEl);
    sel.collapseToEnd();
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
    this.titleEl.blur();
    getSelection()?.removeAllRanges();
    return this.readTitle();
  }

  findView(id: ID): CardView | undefined {
    const v = this.members.get(id);
    if (v) return v;
    for (const mv of this.members.values()) {
      const f = mv.findView?.(id);
      if (f) return f;
    }
    return undefined;
  }

  syncInner(sel: Set<ID>, editingId: ID | null) {
    for (const [mid, v] of this.members) {
      v.setSelected(sel.has(mid));
      v.setHandle(false);
      v.syncInner?.(sel, editingId);
    }
  }

  // Member-stack top in column space (.col-body's offsetTop), measured
  // inside the layer's RO callback where the read is free. -1 until
  // the first measurement; CardsLayer falls back to a head estimate.
  noteBodyTop() {
    this.topOff = this.body.offsetTop;
  }

  bodyTop(): number {
    return this.topOff;
  }

  destroy() {
    for (const v of this.members.values()) {
      this.ctx.unregisterView?.(v);
      v.destroy();
    }
    this.members.clear();
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}
