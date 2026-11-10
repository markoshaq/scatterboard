import type { App } from '../app';
import { headingDoc, type Element, type ID } from '../state/schema';
import type { Action, ElementPatch } from '../state/actions';
import { getClipboard, setClipboard } from '../state/clipboard';
import { remapElements } from '../state/clone';
import { copyTextToClipboard } from '../persist/blobs';
import { elementsToPlain } from '../export/linear';
import { resolveLine } from '../canvas/lines';

export class Clipboard {
  constructor(private a: App) {}

  copySet(): Element[] {
    const out = new Map<ID, Element>();
    // Members come along transitively: a column can sit inside a column.
    const collect = (el: Element) => {
      if (out.has(el.id)) return;
      out.set(el.id, el);
      if (el.type === 'column') for (const m of this.a.layer.members(el.id)) collect(m);
    };
    for (const el of this.a.selectedEls()) collect(el);
    return [...out.values()];
  }


  copySelection() {
    const set = this.copySet();
    if (!set.length) return;
    setClipboard(set);
    // Mirror the pick as plain text on the OS clipboard so it pastes
    // into other apps; the internal snapshot still wins on our paste.
    const text = elementsToPlain(this.a.doc, set);
    if (text) void copyTextToClipboard(text).catch(() => {});
  }


  cutSelection() {
    if (this.a.lockedView()) return;
    this.copySelection();
    this.a.deletion.deleteSelection();
  }


  duplicateSelection() {
    if (this.a.lockedView()) return;
    const src = this.copySet();
    if (!src.length) return;
    const { clones, idMap } = this.cloneElements(src, 24, 24);
    this.a.store.dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
    const top = clones.filter((c) => c.parentId === null);
    this.a.setSelection((top.length ? top : clones).map((c) => c.id));
    this.a.editing.offerSyncCopies(
      src.map((s) => ({ src: s, clone: this.a.doc.elements[idMap.get(s.id)!]! })).filter((p) => !!p.clone),
    );
  }


  // Shared clone path for paste, Opt+drag and duplicate: new ids/z, column
  // members re-file to their cloned column, line endpoints re-attach only
  // when the card came along, comments drop a stale anchor.
  private cloneElements(els: Element[], dx: number, dy: number): { clones: Element[]; idMap: Map<ID, ID> } {
    const rectOf = (t: Element) => this.a.layer.rectOf(t);
    // Members cloned without their column unfile at their rendered
    // slot: the stored x/y is a stale pre-filing position.
    const srcIds = new Set(els.map((e) => e.id));
    els = els.map((e) => {
      if (e.parentId === null || srcIds.has(e.parentId)) return e;
      const r = this.a.layer.rectOf(e);
      return { ...e, x: Math.round(r.x), y: Math.round(r.y) };
    });
    return remapElements(this.a.doc, els, (e) => this.a.boardId ?? e.boardId, dx, dy, {
      resolveEnd: (e, which) => {
        const l = resolveLine(e, this.a.doc, rectOf);
        if (!l) return null;
        return which === 'from' ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 };
      },
    });
  }


  paste() {
    const src = getClipboard();
    if (!src?.length || !this.a.boardId || this.a.lockedView()) return;
    const { clones, idMap } = this.cloneElements(src, 24, 24);
    this.a.store.dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
    const top = clones.filter((c) => c.parentId === null);
    this.a.setSelection((top.length ? top : clones).map((c) => c.id));
    this.a.editing.offerSyncCopies(
      src.map((s) => ({ src: s, clone: this.a.doc.elements[idMap.get(s.id)!]! })).filter((p) => !!p.clone),
    );
  }


  // Paste styles: colour/labels/reactions/heading level from the first
  // copied card onto the selection. Content untouched.
  pasteStyles() {
    const src = getClipboard()?.[0];
    if (!src || !this.a.sel.size || this.a.lockedView()) return;
    const labels = src.labels.filter((l) => this.a.doc.labels[l]?.boardId === this.a.boardId);
    const srcHeading = headingDoc(src);
    const actions: Action[] = this.a.selectedEls().map((e) => {
      const patch: ElementPatch = {
        color: src.color,
        // Line labels render nowhere; don't write dead data.
        labels: e.type === 'line' ? e.labels : [...labels],
        reactions: src.reactions ? [...src.reactions] : undefined,
      };
      const c = headingDoc(e);
      if (c && srcHeading) patch.content = { heading: { ...c, level: srcHeading.level } };
      return { type: 'element.patch' as const, id: e.id, patch };
    });
    this.a.store.dispatch({ type: 'batch', actions });
  }


  // Opt+drag: clone the dragged set in place (inside the move group), then
  // drag the clones. Returns the new drag ids and their drag origins.
  cloneForDrag(ids: ID[]): { ids: ID[]; origins: Map<ID, { x: number; y: number }> } | null {
    if (this.a.lockedView()) return null;
    const src = new Map<ID, Element>();
    for (const id of ids) {
      const el = this.a.doc.elements[id];
      if (!el) continue;
      src.set(id, el);
      if (el.type === 'column') for (const m of this.a.layer.members(id)) src.set(m.id, m);
    }
    if (!src.size) return null;
    // Column members being cloned out get their rendered position as x/y.
    const els = [...src.values()].map((e) => {
      if (e.parentId === null || src.has(e.parentId)) return e;
      const r = this.a.layer.rectOf(e);
      return { ...e, x: Math.round(r.x), y: Math.round(r.y) };
    });
    const { clones, idMap } = this.cloneElements(els, 0, 0);
    this.a.store.dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
    const newIds = ids.map((id) => idMap.get(id)).filter((id): id is ID => !!id);
    const origins = new Map<ID, { x: number; y: number }>();
    for (const id of newIds) {
      // cardOrigin resolves members to their rendered slot, so a
      // member clone does not jump to its stale stored x/y mid-drag.
      origins.set(id, this.a.cardOrigin(id));
    }
    this.a.setSelection(newIds);
    return { ids: newIds, origins };
  }
}
