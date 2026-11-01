import type { ID } from '../state/schema';
import type { Rect } from '../canvas/viewport';
import { ICONS } from './icons';
import { cardBg } from './theme';

// Anchored comment pins: a badge at the anchor card's top-right corner.
// Lives in the same transformed docEl space as cards, so pins follow drags.
export class CommentPins {
  node: HTMLElement;
  private pins = new Map<ID, HTMLElement>();
  private onPin: (id: ID, pinEl: HTMLElement) => void;

  constructor(onPin: (id: ID, pinEl: HTMLElement) => void) {
    this.onPin = onPin;
    this.node = document.createElement('div');
    this.node.className = 'comment-pins';
  }

  sync(
    items: {
      id: ID;
      rect: Rect;
      count: number;
      selected: boolean;
      unread?: number;
      color: string | undefined;
      seat?: HTMLElement | null;
    }[],
  ) {
    const seen = new Set<ID>();
    for (const { id, rect, count, selected, unread, color, seat } of items) {
      seen.add(id);
      let pin = this.pins.get(id);
      if (!pin) {
        pin = document.createElement('div');
        pin.className = 'comment-pin';
        const cid = id;
        pin.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onPin(cid, pin!);
        });
        pin.addEventListener('dblclick', (e) => e.stopPropagation());
        this.pins.set(id, pin);
        this.node.appendChild(pin);
      }
      pin.dataset.id = id;
      // Seat right after the anchor card so covering cards hide the pin;
      // null keeps it in the overlay host (member anchors).
      if (seat) {
        if (pin.previousSibling !== seat) seat.after(pin);
      } else if (pin.parentNode !== this.node) {
        this.node.appendChild(pin);
      }
      pin.style.left = `${rect.x + rect.w}px`;
      pin.style.top = `${rect.y}px`;
      pin.style.background = cardBg(color);
      pin.classList.toggle('selected', selected);
      const label = count > 1 ? String(count) : '';
      const badge = unread && unread > 0 ? String(unread) : '';
      const sig = `${label}|${badge}`;
      if (pin.dataset.sig !== sig) {
        pin.dataset.sig = sig;
        pin.innerHTML = `${ICONS.comment}<span class="cp-count">${label}</span>${badge ? `<span class="cp-unread">${badge}</span>` : ''}`;
      }
    }
    for (const [id, pin] of this.pins) {
      if (!seen.has(id)) {
        pin.remove();
        this.pins.delete(id);
      }
    }
  }
}
