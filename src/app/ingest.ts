import type { App } from '../app';
import { createLink, imageDoc, linkDoc, uid, GRID, IMAGE_W, type Element, type ElementType, type ID, type ImageDoc } from '../state/schema';
import type { ElementPatch } from '../state/actions';
import { putBlob } from '../persist/blobs';
import { ingestFiles, ingestPaste, prepareImage, type IngestApi } from '../ingest/files';
import { embedSrc, hostOf, urlTitle } from '../net/embeds';
import { pointInRect } from '../canvas/hit';
import { t } from '../strings';
import { toast } from '../ui/toast';
import { DROP_EXCLUDE } from '../ui/util';
import { getClipboard } from '../state/clipboard';

export class Ingest {
  constructor(private a: App) {}

  private pastePoint() {
    return this.a.pointer ?? this.a.viewCenter();
  }


  // Palette drags share the card-drag drop ring so a new card can be seen
  // filing into the column under the pointer. updateDropTarget runs with
  // no dragged ids to exclude (the ghost is not an element); lines never
  // file, and rail chrome is not a target, matching the drop-time guard.
  paletteDropHint(ev: PointerEvent | null, type: ElementType) {
    const over = ev ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
    const ok = !!ev && type !== 'line' && !this.a.lockedView() && !over?.closest(DROP_EXCLUDE);
    this.a.gestures.updateDropTarget(ok ? this.a.boardPoint(ev) : null, []);
  }


  // Topmost canvas card under a board point, if it is a column. File and
  // rail drops onto a column join it; same rule as updateDropTarget, so a
  // column covered by another card cannot be the target.
  columnAt(pt: { x: number; y: number }): ID | null {
    let top: Element | null = null;
    for (const e of this.a.layer.elements()) {
      if (e.type === 'line' || e.type === 'annotation') continue;
      if (e.type === 'comment' && e.anchorId !== undefined) continue;
      if (!pointInRect(pt.x, pt.y, this.a.layer.rectOf(e))) continue;
      if (!top || e.z > top.z) top = e;
    }
    return top?.type === 'column' ? top.id : null;
  }


  private ingestApi(): IngestApi {
    const boardId = this.a.boardId!;
    return {
      doc: this.a.doc,
      boardId,
      dispatch: (a) => this.a.store.dispatch(a),
      // Async ingest resolves after the user may have switched boards:
      // only select when still on the board the files landed on.
      select: (ids) => {
        if (this.a.boardId === boardId) this.a.setSelection(ids);
      },
      parentFor: (pt) => this.columnAt(pt),
    };
  }


  ingestFileList(files: File[], pt: { x: number; y: number }) {
    if (!this.a.boardId || this.a.lockedView()) return;
    void ingestFiles(files, pt, this.ingestApi());
  }


  pickFiles(accept: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'file-upload';
    input.accept = accept;
    input.multiple = true;
    input.addEventListener('change', () => {
      if (input.files?.length) this.ingestFileList([...input.files], this.a.viewCenter());
    });
    input.click();
  }


  // Image More > Replace Image: swap the blob, keep caption and position.
  // Strokes drop with the old natural space.
  async replaceImage(el: Element) {
    const c = imageDoc(el);
    if (!c) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'image-replace';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const { blob, aspect, natW, natH } = await prepareImage(file);
          const ref = uid();
          await putBlob(ref, blob);
          // The card may be gone after the async work (delete/undo).
          const curEl = this.a.doc.elements[el.id];
          const cur = curEl ? imageDoc(curEl) : null;
          if (!cur || this.a.lockedView()) return;
          const next = { ...cur, blobRef: ref, name: file.name || cur.name, aspect, natW, natH };
          delete next.strokes;
          this.a.store.dispatch({
            type: 'element.patch',
            id: el.id,
            patch: { content: { image: next } },
          });
        } catch {
          toast(t('imageMissing'), 'err');
        }
      })();
    });
    input.click();
  }


  // Image More > Crop Image to Fit Dot Grid: snap the card rect to the
  // dot grid, then centre-crop the bitmap so its aspect exactly fills
  // the snapped card (no CSS cover crop remains). Interpretation:
  // width AND rendered height land on grid multiples.
  async cropImageToGrid(el: Element) {
    const c = imageDoc(el);
    if (!c) return;
    const w = Math.max(GRID, Math.round((el.w ?? IMAGE_W) / GRID) * GRID);
    const h = Math.max(GRID, Math.round(w / c.aspect / GRID) * GRID);
    const aspect = w / h;
    let crop: { ref: string; w: number; h: number } | undefined;
    if (Math.abs(aspect - c.aspect) > 0.001) {
      try {
        const { loadBitmap, cropImage, canvasBlob } = await import('../editor/imgops');
        const bmp = await loadBitmap(c.blobRef);
        if (!bmp) {
          toast(t('imageMissing'), 'err');
          return;
        }
        const srcA = bmp.width / bmp.height;
        const cw = srcA > aspect ? Math.round(bmp.height * aspect) : bmp.width;
        const ch = srcA > aspect ? bmp.height : Math.round(bmp.width / aspect);
        const out = cropImage(bmp, { x: (bmp.width - cw) / 2, y: (bmp.height - ch) / 2, w: cw, h: ch });
        const blob = await canvasBlob(out, true);
        if (!blob) return;
        const ref = uid();
        await putBlob(ref, blob);
        crop = { ref, w: cw, h: ch };
      } catch {
        toast(t('imageMissing'), 'err');
        return;
      }
    }
    // Re-read the element after the async work: the card may have been
    // deleted, moved or edited, and the grid snap applies to where it
    // is now. The image patch merges onto the fresh doc so caption,
    // alt or name edits made during the crop are not clobbered.
    const curEl = this.a.doc.elements[el.id];
    const cur = curEl ? imageDoc(curEl) : null;
    if (!curEl || !cur || this.a.lockedView()) return;
    let content: { image: ImageDoc } | undefined;
    if (crop) {
      const next = { ...cur, blobRef: crop.ref, aspect, natW: crop.w, natH: crop.h };
      delete next.strokes;
      content = { image: next };
    }
    const patch: ElementPatch = {
      x: Math.round(curEl.x / GRID) * GRID,
      y: Math.round(curEl.y / GRID) * GRID,
      w: Math.max(GRID, Math.round((curEl.w ?? IMAGE_W) / GRID) * GRID),
      ...(content ? { content } : {}),
    };
    this.a.store.dispatch({ type: 'element.patch', id: el.id, patch });
  }


  // OS-clipboard paste: internal element clipboard wins, then files,
  // then URL text -> link card. Text fields keep native paste.
  pasteExternal(e: ClipboardEvent) {
    if (this.a.isTextTarget(e) || !this.a.boardId || this.a.lockedView()) return;
    e.preventDefault();
    if (getClipboard()?.length) {
      this.a.clipboard.paste();
      return;
    }
    const { files, url } = ingestPaste(e);
    const pt = this.pastePoint();
    if (files.length) {
      this.ingestFileList(files, pt);
      return;
    }
    if (url && !this.repointSelectedLink(url)) this.createLinkAt(pt, url);
  }


  // Paste a URL while a single link/embed card is selected: re-point
  // the card instead of dropping a new one.
  private repointSelectedLink(url: string): boolean {
    if (this.a.sel.size !== 1) return false;
    const el = this.a.doc.elements[[...this.a.sel][0]!];
    const c = el?.content;
    if (!el || !c) return false;
    if ('link' in c) {
      // Rebuild rather than spread-patching so the old url's unfurled
      // fields (desc/image) do not linger under exactOptionalPropertyTypes.
      this.a.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: {
          content: {
            link: { url, title: urlTitle(url) ?? hostOf(url), caption: c.link.caption, showPreview: c.link.showPreview },
          },
        },
      });
      this.a.editing.enrichLink(el.id, url);
    } else if ('embed' in c) {
      // A url that no longer parses for this provider would leave a
      // dead player: fall back to a fresh link card instead.
      if (!embedSrc(c.embed.kind, url)) return false;
      this.a.store.dispatch({
        type: 'element.patch',
        id: el.id,
        patch: {
          content: {
            embed: { kind: c.embed.kind, url, title: urlTitle(url) ?? hostOf(url), caption: c.embed.caption, showPreview: c.embed.showPreview },
          },
        },
      });
      this.a.editing.enrichEmbed(el.id, url);
    } else {
      return false;
    }
    toast(t('linkUpdated'), 'ok');
    return true;
  }


  private createLinkAt(pt: { x: number; y: number }, url: string) {
    if (!this.a.boardId) return;
    const el = createLink(this.a.doc, this.a.boardId, Math.round(pt.x), Math.round(pt.y));
    const c = linkDoc(el)!;
    el.content = { link: { ...c, url, title: urlTitle(url) ?? hostOf(url) } };
    this.a.stampBoardColor(el);
    this.a.store.dispatch({ type: 'element.create', el });
    this.a.setSelection([el.id]);
    this.a.editing.enrichLink(el.id, url);
  }
}
