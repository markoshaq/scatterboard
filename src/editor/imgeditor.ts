import type { Element, ImageDoc, Stroke } from '../state/schema';
import { imageDoc, uid } from '../state/schema';
import { DrawPad } from '../draw/pad';
import { openScrim } from './shell';
import type { EditorHandle } from './doceditor';
import { ICONS } from '../ui/icons';
import { t } from '../strings';
import { getBlob, putBlob } from '../persist/blobs';
import { toast } from '../ui/toast';
import { canvasBlob, cropImage, oriented, removeBackground, type CropRect } from '../canvas/imgops';

export type ImgMode = 'draw' | 'edit' | 'bg';

// Route params: ?editing-drawing, ?editing,
// ?editing-background. A bare #/e/<id> on an image opens Edit.
export function imgModeFromHash(): ImgMode {
  const q = location.hash.split('?')[1] ?? '';
  if (q.includes('editing-drawing')) return 'draw';
  if (q.includes('editing-background')) return 'bg';
  return 'edit';
}

export function imgModeParam(m: ImgMode): string {
  return m === 'draw' ? '?editing-drawing' : m === 'bg' ? '?editing-background' : '?editing';
}

interface ImgEditorCtx {
  doc(): ImageDoc | null;
  patch(doc: ImageDoc): void;
  // Swap modes: sets the hash; hashchange drives setMode on this overlay.
  nav(mode: ImgMode): void;
  exit(): void;
  ink?: boolean | undefined;
}

export interface ImgEditorHandle extends EditorHandle {
  setMode(m: ImgMode): void;
}

// One image-editor overlay for the three rail modes: Draw on (annotate
// in natural pixel space), Edit (crop/rotate/flip baked on save) and
// Background (client-side cutout on a transparency checkerboard).
export function openImageEditor(el: Element, mode: ImgMode, ctx: ImgEditorCtx): ImgEditorHandle {
  const scrim = openScrim('ed-imwrap');
  const chips = document.createElement('div');
  chips.className = 'im-chips';
  const chipBtns = new Map<ImgMode, HTMLButtonElement>();
  for (const [m, label] of [
    ['draw', t('imModeDraw')],
    ['edit', t('imModeEdit')],
    ['bg', t('imModeBg')],
  ] as [ImgMode, string][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'im-chip';
    b.textContent = label;
    b.addEventListener('click', () => {
      if (cur === 'draw') commitDraw();
      ctx.nav(m);
    });
    chipBtns.set(m, b);
    chips.appendChild(b);
  }
  const card = document.createElement('div');
  card.className = 'im-stage-card';
  const loading = document.createElement('div');
  loading.className = 'im-loading';
  loading.textContent = t('imLoading');
  card.appendChild(loading);
  scrim.node.append(chips, card);

  let bmp: ImageBitmap | null = null;
  let url: string | null = null;
  let png = true;
  let natW = 0;
  let natH = 0;
  let cur = mode;
  let closed = false;
  let unmount: (() => void) | null = null;
  let toolsEl: HTMLElement | null = null;
  let pad: DrawPad | null = null;

  // The blob loads once; every mode mounts from the same bitmap.
  const c0 = imageDoc(el);
  if (c0) {
    void (async () => {
      const blob = await getBlob(c0.blobRef).catch(() => undefined);
      if (!blob) {
        loading.textContent = t('imageMissing');
        return;
      }
      png = blob.type !== 'image/jpeg';
      try {
        bmp = await createImageBitmap(blob);
      } catch {
        loading.textContent = t('imageMissing');
        return;
      }
      url = URL.createObjectURL(blob);
      natW = c0.natW ?? bmp.width;
      natH = c0.natH ?? bmp.height;
      if (closed) {
        URL.revokeObjectURL(url);
        url = null;
        bmp.close();
        bmp = null;
        return;
      }
      loading.remove();
      mount();
    })();
  }

  function mount() {
    unmount?.();
    unmount = null;
    toolsEl?.remove();
    toolsEl = null;
    card.textContent = '';
    for (const [m, b] of chipBtns) b.classList.toggle('on', m === cur);
    if (!bmp || !url) return;
    if (cur === 'draw') unmount = mountDraw();
    else if (cur === 'edit') unmount = mountEdit();
    else unmount = mountBg();
  }

  // Display scale: fit the natural-size stage into the editor area.
  function fitScale(): number {
    const maxW = Math.min(880, innerWidth - 240);
    const maxH = innerHeight - 220;
    return Math.min(2, Math.min(maxW / natW, maxH / natH));
  }

  function mkBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'draw-tools';
    scrim.node.appendChild(bar);
    toolsEl = bar;
    return bar;
  }

  function mkBtn(bar: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dt-btn';
    b.title = label;
    b.innerHTML = icon;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  }

  function mkAct(bar: HTMLElement, label: string, save: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dt-act${save ? ' dt-save' : ''}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  }

  function mkSep(bar: HTMLElement) {
    const s = document.createElement('span');
    s.className = 'dt-sep';
    bar.appendChild(s);
  }

  // Rasterize `out`, store it and patch the element onto the new blob.
  // Transform saves drop draw-on strokes (they no longer align).
  async function bakeAndPatch(out: HTMLCanvasElement, keepStrokes: boolean, asPng = false) {
    const c = ctx.doc();
    if (!c) {
      ctx.exit();
      return;
    }
    const blob = await canvasBlob(out, asPng || png);
    if (!blob) {
      ctx.exit();
      return;
    }
    const ref = uid();
    try {
      await putBlob(ref, blob);
    } catch {
      toast(t('imageMissing'));
      return;
    }
    const next: ImageDoc = { ...c, blobRef: ref, aspect: out.width / out.height, natW: out.width, natH: out.height };
    if (!keepStrokes) delete next.strokes;
    ctx.patch(next);
    ctx.exit();
  }

  // Draw-on strokes live in the pad until Save; mode chips commit
  // them so switching modes does not drop them.
  function commitDraw() {
    const c = ctx.doc();
    if (!pad || !c) return;
    const strokes = pad.peek();
    const next: ImageDoc = { ...c, natW, natH };
    if (strokes.length) next.strokes = strokes;
    else delete next.strokes;
    ctx.patch(next);
  }

  // Draw on: the image is the pad background, strokes live in the
  // image's natural pixel space (svg viewBox does the scaling).
  function mountDraw(): () => void {
    const s = fitScale();
    const stage = document.createElement('div');
    stage.className = 'im-pad';
    stage.style.width = `${natW * s}px`;
    stage.style.height = `${natH * s}px`;
    const img = document.createElement('img');
    img.src = url!;
    img.draggable = false;
    img.alt = '';
    stage.appendChild(img);
    card.appendChild(stage);
    const p = new DrawPad({
      initial: ctx.doc()?.strokes ?? [],
      ink: ctx.ink,
      onSave: (strokes: Stroke[]) => {
        const c = ctx.doc();
        if (c) ctx.patch({ ...c, strokes, natW, natH });
        ctx.exit();
      },
      onCancel: () => ctx.exit(),
    });
    pad = p;
    p.mount({
      surface: stage,
      svgParent: stage,
      project: (e) => {
        const r = stage.getBoundingClientRect();
        return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
      },
      tol: 7 / s,
      viewBox: `0 0 ${natW} ${natH}`,
    });
    toolsEl = p.tools;
    scrim.node.appendChild(p.tools);
    return () => {
      if (pad === p) pad = null;
      p.destroy();
    };
  }

  // Edit: canvas-backed preview of the oriented image; crop is a rect
  // dragged in stage space, applied (with rot/flip) at Save time.
  function mountEdit(): () => void {
    let rotQ = 0;
    let flipH = false;
    let flipV = false;
    let crop: CropRect | null = null;
    let cropping = false;
    let stage = oriented(bmp!, 0, false, false);

    const wrap = document.createElement('div');
    wrap.className = 'im-edit-stage';
    const cv = document.createElement('canvas');
    const cropEl = document.createElement('div');
    cropEl.className = 'im-crop';
    cropEl.style.display = 'none';
    wrap.append(cv, cropEl);
    card.appendChild(wrap);

    function render() {
      const s = Math.min(2, Math.min(Math.min(880, innerWidth - 240) / stage.width, (innerHeight - 220) / stage.height));
      cv.width = stage.width;
      cv.height = stage.height;
      cv.style.width = `${stage.width * s}px`;
      cv.style.height = `${stage.height * s}px`;
      cv.getContext('2d')!.drawImage(stage, 0, 0);
      if (crop && crop.w >= 4 && crop.h >= 4) {
        cropEl.style.display = '';
        cropEl.style.left = `${crop.x * s}px`;
        cropEl.style.top = `${crop.y * s}px`;
        cropEl.style.width = `${crop.w * s}px`;
        cropEl.style.height = `${crop.h * s}px`;
      } else {
        cropEl.style.display = 'none';
      }
    }

    function rebuild() {
      stage = oriented(bmp!, rotQ, flipH, flipV);
      crop = null;
      render();
    }

    wrap.addEventListener('pointerdown', (e) => {
      if (!cropping || e.button !== 0) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const k = stage.width / Math.max(1, r.width);
      const x0 = Math.max(0, Math.min(stage.width, (e.clientX - r.left) * k));
      const y0 = Math.max(0, Math.min(stage.height, (e.clientY - r.top) * k));
      crop = { x: x0, y: y0, w: 0, h: 0 };
      const move = (ev: PointerEvent) => {
        const x1 = Math.max(0, Math.min(stage.width, (ev.clientX - r.left) * k));
        const y1 = Math.max(0, Math.min(stage.height, (ev.clientY - r.top) * k));
        crop = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
        render();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (crop && (crop.w < 4 || crop.h < 4)) crop = null;
        render();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    const bar = mkBar();
    const cropBtn = mkBtn(bar, ICONS.crop, t('imCrop'), () => {
      cropping = !cropping;
      wrap.classList.toggle('cropping', cropping);
      cropBtn.classList.toggle('on', cropping);
    });
    mkSep(bar);
    mkBtn(bar, ICONS.rotLeft, t('imRotLeft'), () => {
      rotQ = (rotQ + 1) % 4;
      rebuild();
    });
    mkBtn(bar, ICONS.flipH, t('imFlipH'), () => {
      flipH = !flipH;
      rebuild();
    });
    mkBtn(bar, ICONS.flipV, t('imFlipV'), () => {
      flipV = !flipV;
      rebuild();
    });
    mkSep(bar);
    mkAct(bar, t('drawCancel'), false, () => ctx.exit());
    mkAct(bar, t('drawSave'), true, () => {
      // Untouched image: Save exits without a re-encode.
      if (!crop && rotQ === 0 && !flipH && !flipV) {
        ctx.exit();
        return;
      }
      const out = crop && crop.w >= 4 && crop.h >= 4 ? cropImage(stage, crop) : stage;
      void bakeAndPatch(out, false);
    });

    render();
    return () => {};
  }

  // Background: checkerboard preview with a remove-background toggle;
  // the cutout is computed once per session and baked on Save.
  function mountBg(): () => void {
    const s = fitScale();
    const wrap = document.createElement('div');
    wrap.className = 'im-checker';
    const img = document.createElement('img');
    img.src = url!;
    img.draggable = false;
    img.alt = '';
    img.style.width = `${natW * s}px`;
    img.style.height = `${natH * s}px`;
    const outCv = document.createElement('canvas');
    outCv.width = natW;
    outCv.height = natH;
    outCv.style.width = `${natW * s}px`;
    outCv.style.height = `${natH * s}px`;
    outCv.style.display = 'none';
    wrap.append(img, outCv);
    card.appendChild(wrap);

    let cutout: HTMLCanvasElement | null = null;
    let on = false;
    let busy = false;
    const bar = mkBar();
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'im-switch';
    const track = document.createElement('span');
    track.className = 'im-sw';
    const lab = document.createElement('span');
    lab.textContent = t('imRemoveBg');
    sw.append(track, lab);
    sw.addEventListener('click', () => {
      if (busy || !bmp) return;
      if (!cutout) {
        busy = true;
        cutout = removeBackground(bmp);
        outCv.width = cutout.width;
        outCv.height = cutout.height;
        outCv.getContext('2d')!.drawImage(cutout, 0, 0);
        busy = false;
      }
      on = !on;
      sw.classList.toggle('on', on);
      img.style.display = on ? 'none' : '';
      outCv.style.display = on ? '' : 'none';
    });
    bar.appendChild(sw);
    mkSep(bar);
    mkAct(bar, t('drawCancel'), false, () => ctx.exit());
    mkAct(bar, t('drawSave'), true, () => {
      if (!on || !cutout) {
        ctx.exit();
        return;
      }
      void bakeAndPatch(cutout, true, true);
    });
    return () => {};
  }

  // DrawPad owns keys in draw mode; edit/bg Esc exits like Cancel.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || cur === 'draw') return;
    if (document.querySelector('.tool-pop')) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.exit();
  };
  window.addEventListener('keydown', onKey, true);
  for (const [m, b] of chipBtns) b.classList.toggle('on', m === cur);

  return {
    setMode(m: ImgMode) {
      if (m === cur) return;
      cur = m;
      mount();
    },
    close() {
      closed = true;
      window.removeEventListener('keydown', onKey, true);
      unmount?.();
      toolsEl?.remove();
      if (url) URL.revokeObjectURL(url);
      bmp?.close();
      scrim.close();
    },
  };
}
