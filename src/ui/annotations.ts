import type { Element, ID, Stroke } from '../state/schema';
import { annotationDoc, strokesBBox } from '../state/schema';
import { strokePathEl } from '../draw/strokes';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Board-level saved drawings: one svg per annotation element inside a
// docEl overlay host (board space, scales with zoom). Paths take
// pointer-events: stroke so a stroke click selects the element; the
// element itself is not pointer-draggable.
export class AnnotationLayer {
  node: HTMLElement;
  private svgs = new Map<ID, SVGSVGElement>();
  private sigs = new Map<ID, Stroke[]>();
  private onPick: (id: ID, e: PointerEvent) => void;

  constructor(onPick: (id: ID, e: PointerEvent) => void) {
    this.onPick = onPick;
    this.node = document.createElement('div');
    this.node.className = 'anno-layer';
  }

  // `seatBefore` returns the card node the svg should paint before so
  // ink honours el.z; null keeps it in the host (above all cards).
  sync(
    items: { el: Element; selected: boolean; dim?: boolean }[],
    seatBefore?: (el: Element) => HTMLElement | null,
  ) {
    const seen = new Set<ID>();
    for (const { el, selected, dim } of items) {
      const c = annotationDoc(el);
      if (!c) continue;
      seen.add(el.id);
      let svg = this.svgs.get(el.id);
      if (!svg) {
        svg = document.createElementNS(SVG_NS, 'svg');
        svg.classList.add('anno');
        const id = el.id;
        svg.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.onPick(id, e);
        });
        this.svgs.set(el.id, svg);
        this.node.appendChild(svg);
      }
      svg.dataset.id = el.id;
      const ref = seatBefore?.(el);
      if (ref) {
        if (svg.nextSibling !== ref) ref.before(svg);
      } else if (svg.parentNode !== this.node) {
        this.node.appendChild(svg);
      }
      const box = strokesBBox(c.strokes);
      const w = Math.max(1, box.w);
      const h = Math.max(1, box.h);
      svg.style.left = `${el.x + box.x}px`;
      svg.style.top = `${el.y + box.y}px`;
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
      svg.setAttribute('viewBox', `${box.x} ${box.y} ${w} ${h}`);
      svg.classList.toggle('selected', selected);
      svg.classList.toggle('present-dim', !!dim);
      // Strokes are replaced wholesale on content patches, so identity
      // is the rebuild sig: x/y moves no longer rebuild every path.
      if (this.sigs.get(el.id) !== c.strokes) {
        this.sigs.set(el.id, c.strokes);
        svg.textContent = '';
        for (const st of c.strokes) {
          const p = strokePathEl(st);
          p.classList.add('anno-path');
          svg.appendChild(p);
        }
      }
    }
    for (const [id, svg] of this.svgs) {
      if (!seen.has(id)) {
        svg.remove();
        this.svgs.delete(id);
        this.sigs.delete(id);
      }
    }
  }
}
