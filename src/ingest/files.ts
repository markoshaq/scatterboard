import type { Action } from '../state/actions';
import { createFile, createImage, uid, type Doc, type Element, type ID } from '../state/schema';
import { putBlob } from '../persist/blobs';
import { t } from '../strings';
import { toast } from '../ui/toast';

export interface IngestApi {
  doc: Doc;
  boardId: ID;
  dispatch(a: Action): void;
  select(ids: ID[]): void;
  // Column drop-target wins: drop a file onto a column and it joins it.
  parentFor(pt: { x: number; y: number }): ID | null;
}

const MAX_EDGE = 1600;
const JPEG_Q = 0.85;

// Source types that can carry transparency: JPEG would flatten their
// alpha to black, so the PNG encode wins for these regardless of size.
const ALPHA_TYPES = new Set(['image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

export function parseUrlText(text: string): string | null {
  const v = text.trim();
  if (!v || v.length > 2048 || /\s/.test(v)) return null;
  // An explicit scheme (mailto:, tel:, even javascript:) goes straight
  // to the protocol check; bare hosts get https:// when they look like
  // a domain (has a dot) or localhost[:port].
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)
    ? v
    : /\./.test(v) || /^localhost(:\d+)?([/?#]|$)/i.test(v)
      ? `https://${v}`
      : v;
  try {
    const u = new URL(candidate);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

interface PreparedImage {
  blob: Blob;
  aspect: number;
  natW: number;
  natH: number;
}

function toBlob(cv: HTMLCanvasElement, type: string, q?: number): Promise<Blob | null> {
  return new Promise((res) => cv.toBlob((b) => res(b), type, q));
}

// Downscale on ingest: cap the long edge, JPEG q0.85; keep PNG only when
// it ends up smaller (screenshots, flat art).
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  // Safari accepts createImageBitmap(blob) but not the options dict.
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
    createImageBitmap(file),
  );
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const jpeg = await toBlob(cv, 'image/jpeg', JPEG_Q);
    let best = jpeg;
    if (ALPHA_TYPES.has(file.type)) {
      const png = await toBlob(cv, 'image/png');
      if (png) best = png;
    }
    if (!best) return { blob: file, aspect: bmp.width / bmp.height, natW: bmp.width, natH: bmp.height };
    return { blob: best, aspect: bmp.width / bmp.height, natW: w, natH: h };
  } finally {
    bmp.close();
  }
}

// Files become image cards (image/*) or generic file cards. Element
// creation is one action batch; blob writes and image decode happen first
// so cards land with their real aspect.
export async function ingestFiles(files: Iterable<File>, at: { x: number; y: number }, api: IngestApi): Promise<void> {
  const list = [...files];
  if (!list.length) return;
  const jobs = list.map(async (file, i) => {
    const pt = { x: Math.round(at.x + i * 24), y: Math.round(at.y + i * 24) };
    const parentId = api.parentFor(pt);
    if (file.type.startsWith('image/')) {
      try {
        const { blob, aspect, natW, natH } = await prepareImage(file);
        const ref = uid();
        await putBlob(ref, blob);
        const el = createImage(api.doc, api.boardId, pt.x, pt.y, ref, file.name || 'image', aspect, natW, natH);
        el.parentId = parentId;
        return el;
      } catch {
        /* undecodable image falls through to a file card */
      }
    }
    const ref = uid();
    try {
      await putBlob(ref, file);
    } catch {
      // Skip the file rather than land a card with a dead blobRef.
      toast(t('imageMissing'), 'err');
      return null;
    }
    const el = createFile(api.doc, api.boardId, pt.x, pt.y, ref, file.name || 'file', file.size, file.type);
    el.parentId = parentId;
    return el;
  });
  const els = (await Promise.all(jobs)).filter((e): e is Element => !!e);
  if (!els.length) return;
  api.dispatch({ type: 'batch', actions: els.map((el) => ({ type: 'element.create' as const, el })) });
  api.select(els.map((e) => e.id));
}

export function ingestPaste(e: ClipboardEvent): { files: File[]; url: string | null } {
  const data = e.clipboardData;
  const files = data?.files?.length ? [...data.files] : [];
  const url = files.length ? null : parseUrlText(data?.getData('text/plain') ?? '');
  return { files, url };
}
