import type { App } from '../app';
import { commentDoc, uid, type ID } from '../state/schema';
import { openThreadPopup } from '../cards/comment';

// Comment thread mutation surface: the pin/card popup plus the
// per-element add/edit/delete patches and the unread-seen bookkeeping.
export class Comments {
  constructor(private a: App) {}

  openThread(id: ID, anchor: HTMLElement | DOMRect) {
    const el = this.a.doc.elements[id];
    if (el?.type !== 'comment') return;
    // Opening the thread marks it read for the pin unread badge.
    const commentOf = () => {
      const e = this.a.doc.elements[id];
      return e ? (commentDoc(e) ?? null) : null;
    };
    const markSeen = () => {
      const n = commentOf()?.items.length ?? 0;
      // Dead keys accumulate forever otherwise: drop ids the doc no
      // longer holds while writing this one.
      const seen = { ...(this.a.prefs.commentSeen ?? {}) };
      for (const k of Object.keys(seen)) if (!this.a.doc.elements[k]) delete seen[k];
      seen[id] = n;
      this.a.prefs.commentSeen = seen;
      this.a.scheduleSave();
      this.a.overlays.syncPins();
    };
    const items = () => commentOf()?.items ?? [];
    markSeen();
    const pop = openThreadPopup(anchor, items, {
      onAdd: (text) => {
        if (this.a.lockedView()) return;
        const c = commentOf();
        if (!c) return;
        this.a.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { comment: { items: [...c.items, { id: uid(), text, createdAt: Date.now() }] } } },
        });
        markSeen();
      },
      onEdit: (iid, text) => {
        if (this.a.lockedView()) return;
        const c = commentOf();
        if (!c) return;
        this.a.store.dispatch({
          type: 'element.patch',
          id,
          patch: {
            content: {
              comment: { items: c.items.map((i) => (i.id === iid ? { ...i, text, editedAt: Date.now() } : i)) },
            },
          },
        });
      },
      onDelete: (iid) => {
        if (this.a.lockedView()) return;
        const c = commentOf();
        if (!c) return;
        this.a.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { comment: { items: c.items.filter((i) => i.id !== iid) } } },
        });
      },
    });
    // Anchored comments with no items would linger as blank pins; when
    // the popup closes empty, the element goes with it.
    const close = pop.close.bind(pop);
    pop.close = () => {
      close();
      const el = this.a.doc.elements[id];
      if (el?.anchorId !== undefined && !items().length && !this.a.lockedView()) {
        this.a.store.dispatch({ type: 'element.delete', el });
      }
      if (this.a.sel.delete(id)) this.a.requestRender();
    };
  }
}
