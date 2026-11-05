import type { Doc, Element, ID } from '../state/schema';
import type { Rect } from '../canvas/viewport';

export interface ChipsEvents {
  onChip(id: ID, kind: 'label' | 'reaction', chip: HTMLElement): void;
}

// Label + reaction chips rendered under each card in a single overlay
// host. Only the chips themselves take pointer events, so the row and
// host never block input.
export class ChipsLayer {
  node: HTMLElement;
  private doc: Doc;
  private rows = new Map<ID, HTMLElement>();

  constructor(doc: Doc, private events: ChipsEvents) {
    this.doc = doc;
    this.node = document.createElement('div');
    this.node.className = 'card-chips';
  }

  // `seatOf` resolves the card's mounted node so the row can sit right
  // after it in the layer's z-sorted DOM: chips of covered cards get
  // covered too. Cards without a mounted view fall back to the host.
  sync(items: { el: Element; rect: Rect; dim?: boolean }[], seatOf?: (id: ID) => HTMLElement | null) {
    const seen = new Set<ID>();
    for (const { el, rect, dim } of items) {
      const labels = (el.labels ?? []).map((id) => this.doc.labels[id]).filter((l) => l !== undefined);
      const reactions = el.reactions ?? [];
      if (!labels.length && !reactions.length) continue;
      seen.add(el.id);
      let row = this.rows.get(el.id);
      if (!row) {
        row = document.createElement('div');
        row.className = 'chip-row';
        // Chips sit in .cards next to the card node: swallow the
        // pointerdown so a chip click never starts a board gesture.
        row.addEventListener('pointerdown', (e) => e.stopPropagation());
        row.addEventListener('click', (e) => {
          const chip = e.target as HTMLElement;
          const kind = chip.closest('.chip-label') ? 'label' : chip.closest('.chip-react') ? 'reaction' : null;
          if (kind && row!.dataset.id) this.events.onChip(row!.dataset.id, kind, chip);
        });
        this.rows.set(el.id, row);
      }
      row.dataset.id = el.id;
      const seat = seatOf?.(el.id);
      if (seat) {
        if (row.previousSibling !== seat) seat.after(row);
      } else if (row.parentNode !== this.node) {
        this.node.appendChild(row);
      }
      row.style.left = `${rect.x}px`;
      row.style.top = `${rect.y + rect.h + 6}px`;
      // Wrap at the card's own width: chips go vertical only when they
      // would outgrow the card they belong to.
      row.style.maxWidth = `${Math.max(rect.w, 160)}px`;
      row.classList.toggle('present-dim', !!dim);
      const key = `${labels.map((l) => `${l.id}:${l.name}:${l.color}`).join(',')}|${reactions.join(',')}`;
      if (row.dataset.key === key) continue;
      row.dataset.key = key;
      row.textContent = '';
      for (const l of labels) {
        const pill = document.createElement('span');
        pill.className = 'chip-label';
        pill.style.background = l.color;
        pill.textContent = l.name;
        row.appendChild(pill);
      }
      for (const r of reactions) {
        const em = document.createElement('span');
        em.className = 'chip-react';
        em.textContent = r;
        row.appendChild(em);
      }
    }
    for (const [id, row] of this.rows) {
      if (!seen.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
  }
}
