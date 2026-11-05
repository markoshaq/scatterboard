import type { App } from '../app';
import { boardRefOf, columnTitle, embedDoc, headingDoc, linkDoc, swatchDoc, todoDoc, uid, type Element, type ID, type TodoDoc, type TypeContent } from '../state/schema';
import type { Action } from '../state/actions';
import { TableCard } from '../cards/table';
import { editRailType } from '../ui/rail';
import { t } from '../strings';
import { choice } from '../ui/toast';
import { fetchLinkPreview } from '../ui/unfurl';
import { hostOf, urlTitle } from '../net/embeds';
import { openLinkPopup } from '../ui/toolpopups';
import { applyLink, selectionInRoot, selectionRange } from '../ui/richtext';
import { sanitizeHtml, scrubContent } from '../ui/sanitize';
export class Editing {
  constructor(private a: App) {}


  // --- edit-mode rail ---

  editingEl(): Element | null {
    const el = this.a.editingId ? this.a.doc.elements[this.a.editingId] : undefined;
    if (!el || !editRailType(el.type)) return null;
    // A table only has an edit rail while one of its cells is focused;
    // title/caption field edits fall back to the selected rail.
    if (el.type === 'table') {
      const v = this.a.layer.view(el.id);
      if (!(v instanceof TableCard) || !v.cellFocused()) return null;
    }
    return el;
  }


  editSurface(): HTMLElement | null {
    if (!this.a.editingId) return null;
    return this.a.layer.view(this.a.editingId)?.editSurface?.() ?? null;
  }


  // Link/Comment in the note + heading edit rail need live text selection.
  refreshEditGate() {
    const el = this.editingEl();
    if (!el || (el.type !== 'note' && el.type !== 'heading')) {
      this.a.rail.setDisabled([]);
      return;
    }
    const surface = this.editSurface();
    const hasSel = !!surface && selectionInRoot(surface);
    this.a.rail.setDisabled(hasSel ? [] : ['tx-link', 'comment']);
  }


  openLinkPopupFor(id: ID) {
    if (this.a.editingId !== id) return;
    const surface = this.editSurface();
    const range = surface ? selectionRange(surface) : null;
    if (!surface || !range) return;
    openLinkPopup(range.getBoundingClientRect(), (url) => applyLink(surface, url, range));
  }


  // --- editing ---

  beginEdit(id: ID, pos?: { x: number; y: number }, field?: string) {
    if (this.a.lockedView()) return;
    if (this.a.editingId === id) {
      // Already editing: a field request just refocuses the surface.
      this.a.layer.view(id)?.beginEdit(pos, field);
      return;
    }
    this.endEdit();
    this.a.editingId = id;
    if (!this.a.sel.has(id)) this.a.selectOnly(id);
    this.a.store.beginGroup();
    try {
      // Render first so an offscreen card mounts before beginEdit runs.
      this.a.render();
      this.a.layer.view(id)?.beginEdit(pos, field);
      this.a.render();
    } catch (err) {
      // A thrown mount must not leak the group: later dispatches would
      // be silently absorbed into it and undo would stop working.
      this.a.editingId = null;
      this.a.store.endGroup();
      throw err;
    }
  }


  endEdit() {
    if (!this.a.editingId) return;
    const id = this.a.editingId;
    const view = this.a.layer.view(id);
    const el = this.a.doc.elements[id];
    if (view?.editing) {
      const text = view.endEdit();
      const html = view.readHtml?.();
      if (el) this.commitEditText(el, text, html);
    }
    this.a.editingId = null;
    this.a.store.endGroup('edit');
    this.a.requestRender();
  }


  commitEditText(el: Element, text: string, html?: string) {
    // Stored html renders via innerHTML, so anything richer than what
    // the editor emits (pasted markup) is stripped before persisting.
    html = html === undefined ? undefined : sanitizeHtml(html);
    if (el.type === 'note') {
      const cur = 'note' in el.content ? el.content.note : null;
      if (cur && (cur.text !== text || (html !== undefined && cur.html !== html))) {
        const note = html !== undefined ? { text, html } : { text };
        this.a.store.dispatch({
          type: 'batch',
          actions: [
            { type: 'element.patch', id: el.id, patch: { content: { note } } },
            ...this.syncGroupActions(el, note),
          ],
        });
      }
      this.maybeOfferDocument(el);
    } else if (el.type === 'column') {
      if (columnTitle(el) !== text) {
        this.a.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { column: { title: text } } } });
      }
    } else if (el.type === 'heading') {
      const c = headingDoc(el);
      if (c && (c.text !== text || (html !== undefined && c.html !== html))) {
        this.a.store.dispatch({
          type: 'element.patch',
          id: el.id,
          patch: { content: { heading: html !== undefined ? { text, level: c.level, html } : { text, level: c.level } } },
        });
      }
    } else if (el.type === 'swatch') {
      const c = swatchDoc(el);
      if (c && c.caption !== text) {
        this.a.store.dispatch({ type: 'element.patch', id: el.id, patch: { content: { swatch: { ...c, caption: text } } } });
      }
    } else if (el.type === 'board') {
      const ref = boardRefOf(el);
      const b = ref ? this.a.doc.boards[ref] : undefined;
      if (b && b.title !== text) {
        this.a.store.dispatch({ type: 'board.patch', id: b.id, patch: { title: text } });
      }
    }
  }


  onTextInput(id: ID, text: string, html?: string) {
    if (this.a.lockedView()) return;
    const el = this.a.doc.elements[id];
    if (!el) return;
    html = html === undefined ? undefined : sanitizeHtml(html);
    if (el.type === 'board') {
      const ref = boardRefOf(el);
      const b = ref ? this.a.doc.boards[ref] : undefined;
      if (b) this.a.store.dispatch({ type: 'board.patch', id: b.id, patch: { title: text } });
      return;
    }
    if (el.type === 'heading') {
      const c = headingDoc(el);
      if (c) {
        this.a.store.dispatch({
          type: 'element.patch',
          id,
          patch: { content: { heading: html !== undefined ? { text, level: c.level, html } : { text, level: c.level } } },
        });
      }
      return;
    }
    if (el.type === 'swatch') {
      const c = swatchDoc(el);
      if (c) {
        this.a.store.dispatch({ type: 'element.patch', id, patch: { content: { swatch: { ...c, caption: text } } } });
      }
      return;
    }
    if (el.type === 'column') {
      this.a.store.dispatch({ type: 'element.patch', id, patch: { content: { column: { title: text } } } });
      return;
    }
    // Every remaining type owns its own content shape; only notes take
    // the plain note write.
    if (el.type !== 'note') return;
    const note = html !== undefined ? { text, html } : { text };
    this.a.store.dispatch({
      type: 'batch',
      actions: [{ type: 'element.patch', id, patch: { content: { note } } }, ...this.syncGroupActions(el, note)],
    });
    this.maybeOfferDocument(el);
  }


  // Synced note copies: a note edit patches every other element in the
  // same syncGroup on this board with the same content.
  syncGroupActions(el: Element, note: { text: string; html?: string }): Action[] {
    if (!el.syncGroup) return [];
    const out: Action[] = [];
    for (const e of Object.values(this.a.doc.elements)) {
      if (e.id === el.id || e.type !== 'note' || e.syncGroup !== el.syncGroup || e.boardId !== el.boardId) continue;
      out.push({ type: 'element.patch', id: e.id, patch: { content: { note } } });
    }
    return out;
  }


  // "Convert to a document?" helper: once a note passes ~400 chars,
  // offer once per note via a dismissible toast.
  maybeOfferDocument(el: Element) {
    const cur = 'note' in el.content ? el.content.note : null;
    if (!cur || cur.text.length < 400 || !this.a.boardId) return;
    const key = `doc:${el.id}`;
    this.a.prefs.helpers = { ...(this.a.prefs.helpers ?? {}) };
    if (this.a.prefs.helpers[key]) return;
    this.a.prefs.helpers[key] = true;
    this.a.scheduleSave();
    choice(t('docOffer'), t('docOfferBtn'), () => {
      if (this.a.lockedView()) return;
      const live = this.a.doc.elements[el.id];
      if (live) this.a.tools.convertToDocument(live);
    });
  }


  // "Add a title?" helper: after three items land on an untitled list,
  // offer the title once per list.
  maybeOfferTodoTitle(el: Element, c: TodoDoc) {
    if (c.showTitle || c.title || !this.a.boardId) return;
    if (c.items.filter((i) => i.text.trim()).length < 3) return;
    const key = `title:${el.id}`;
    this.a.prefs.helpers = { ...(this.a.prefs.helpers ?? {}) };
    if (this.a.prefs.helpers[key]) return;
    this.a.prefs.helpers[key] = true;
    this.a.scheduleSave();
    choice(t('todoTitleOffer'), t('todoTitleBtn'), () => {
      if (this.a.lockedView()) return;
      const live = this.a.doc.elements[el.id];
      const cur = live ? todoDoc(live) : null;
      if (live && cur) {
        this.a.store.dispatch({
          type: 'element.patch',
          id: live.id,
          patch: { content: { todo: { ...cur, showTitle: true } } },
        });
      }
    });
  }


  // Duplicating or pasting notes offers "Keep this copy in sync?": the
  // clone joins the source's syncGroup (or a fresh one). Declining
  // strips the group from the clones.
  offerSyncCopies(pairs: { src: Element; clone: Element }[]) {
    const notes = pairs.filter((p) => p.src.type === 'note' && p.clone.type === 'note');
    if (!notes.length) return;
    const groupFor = new Map<ID, ID>();
    choice(
      t('syncAsk'),
      t('syncKeep'),
      () => {
        if (this.a.lockedView()) return;
        const actions: Action[] = [];
        for (const { src, clone } of notes) {
          let g = this.a.doc.elements[src.id]?.syncGroup;
          if (!g) {
            g = groupFor.get(src.id) ?? uid();
            groupFor.set(src.id, g);
            actions.push({ type: 'element.patch', id: src.id, patch: { syncGroup: g } });
          }
          actions.push({ type: 'element.patch', id: clone.id, patch: { syncGroup: g } });
        }
        if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
      },
      () => {
        if (this.a.lockedView()) return;
        const actions = notes
          .filter(({ clone }) => clone.syncGroup)
          .map(({ clone }) => ({ type: 'element.patch' as const, id: clone.id, patch: { syncGroup: undefined } }));
        if (actions.length) this.a.store.dispatch({ type: 'batch', actions });
      },
    );
  }


  onContent(id: ID, content: TypeContent) {
    if (this.a.lockedView()) return;
    const el = this.a.doc.elements[id];
    if (!el) return;
    // Table cells and any other html-bearing content fields get the
    // same scrub as the import path.
    scrubContent(content);
    this.a.store.dispatch({ type: 'element.patch', id, patch: { content } });
    if ('todo' in content) {
      this.maybeOfferTodoTitle(el, content.todo);
    }
    if ('link' in content && content.link.url) this.enrichLink(el.id, content.link.url);
    if ('embed' in content && content.embed.url) this.enrichEmbed(el.id, content.embed.url);
  }


  // URL unfurl (online extra, on by default): pull og tags through a
  // CORS proxy and back-fill title/desc/image on the link card. The
  // title is only replaced while it still holds an auto value (empty,
  // the url's host or a url-derived name), never user-typed text.
  enrichLink(id: ID, url: string) {
    if (this.a.prefs.unfurl === false || !navigator.onLine) return;
    const el0 = this.a.doc.elements[id];
    const cur0 = el0 ? linkDoc(el0) : null;
    if (!el0 || !cur0 || cur0.url !== url) return;
    if (!autoTitled(cur0.title, url) && cur0.desc !== undefined && cur0.image !== undefined) return;
    void fetchLinkPreview(url).then((res) => {
      if (!res || this.a.lockedView()) return;
      const el = this.a.doc.elements[id];
      const cur = el ? linkDoc(el) : null;
      if (!el || !cur || cur.url !== url) return;
      this.a.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: {
          content: {
            link: {
              ...cur,
              title: autoTitled(cur.title, url) ? (res.title ?? cur.title) : cur.title,
              // Fetched fields only fill empty slots: a user edit made
              // while the request was in flight must not be clobbered.
              ...(res.desc !== undefined && cur.desc === undefined ? { desc: res.desc } : {}),
              ...(res.image !== undefined && cur.image === undefined ? { image: res.image } : {}),
            },
          },
        },
      });
    });
  }

  // Embed cards get their title enriched without the unfurl pref:
  // creating an embed is already opting into that provider's network.
  enrichEmbed(id: ID, url: string) {
    if (!navigator.onLine) return;
    const auto = () => {
      const el = this.a.doc.elements[id];
      const cur = el ? embedDoc(el) : null;
      return cur && cur.url === url && autoTitled(cur.title, url) ? cur : null;
    };
    if (!auto()) return;
    void fetchLinkPreview(url).then((res) => {
      if (!res?.title || this.a.lockedView()) return;
      const cur = auto();
      if (!cur) return;
      this.a.store.dispatch({
        type: 'element.patch',
        id,
        patch: { content: { embed: { ...cur, title: res.title } } },
      });
    });
  }

}

// Whether a card title is still an auto value (empty, the url's host
// or a url-derived name) and may be replaced by a fetched one.
export function autoTitled(title: string, url: string): boolean {
  return !title || title === hostOf(url) || title === urlTitle(url);
}
