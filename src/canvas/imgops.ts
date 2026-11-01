import { getBlob } from '../persist/blobs';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RasterSrc = ImageBitmap | HTMLCanvasElement;

export async function loadBitmap(ref: string): Promise<ImageBitmap | null> {
  const blob = await getBlob(ref).catch(() => undefined);
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

// Rotate CCW in quarter turns + mirror, rasterized at source resolution.
// Mirrors apply in source space before the rotation.
export function oriented(src: RasterSrc, rotQ: number, flipH: boolean, flipV: boolean): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const swap = rotQ % 2 === 1;
  const cv = document.createElement('canvas');
  cv.width = swap ? h : w;
  cv.height = swap ? w : h;
  const ctx = cv.getContext('2d')!;
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate((-rotQ * Math.PI) / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(src, -w / 2, -h / 2);
  return cv;
}

export function cropImage(src: RasterSrc, r: CropRect): HTMLCanvasElement {
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d')!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
  return cv;
}

export function canvasBlob(cv: HTMLCanvasElement, png: boolean): Promise<Blob | null> {
  return new Promise((res) => cv.toBlob(res, png ? 'image/png' : 'image/jpeg', png ? undefined : 0.92));
}

const BG_MAX_EDGE = 512;
const BG_DIST = 36;
const BG_SOFT_A = 150;

// Client-side background cutout: downscale to <=512px, flood fill inward from
// every edge pixel through low-contrast neighbours, then knock the
// marked pixels out at full resolution with a 1px edge soften.
export function removeBackground(src: RasterSrc): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const s = Math.min(1, BG_MAX_EDGE / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * s));
  const sh = Math.max(1, Math.round(h * s));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, sw, sh);
  const px = sctx.getImageData(0, 0, sw, sh).data;

  // Region growing: a neighbour joins the background when it is close
  // to the pixel it grows from AND close to that region's edge seed
  // colour (bounded drift so gradients flood but runaway blends stop).
  const bg = new Uint8Array(sw * sh);
  const seedAt = new Int32Array(sw * sh).fill(-1);
  const queue = new Int32Array(sw * sh);
  let qt = 0;
  const THR2 = BG_DIST * BG_DIST;
  const dist2 = (a: number, b: number) => {
    const dr = px[a]! - px[b]!;
    const dg = px[a + 1]! - px[b + 1]!;
    const db = px[a + 2]! - px[b + 2]!;
    return dr * dr + dg * dg + db * db;
  };
  const grow = (i: number, seed: number) => {
    if (bg[i]) return;
    bg[i] = 1;
    seedAt[i] = seed;
    queue[qt++] = i;
  };
  for (let x = 0; x < sw; x++) {
    grow(x, x);
    grow((sh - 1) * sw + x, (sh - 1) * sw + x);
  }
  for (let y = 0; y < sh; y++) {
    grow(y * sw, y * sw);
    grow(y * sw + sw - 1, y * sw + sw - 1);
  }
  for (let qh = 0; qh < qt; qh++) {
    const i = queue[qh]!;
    const x = i % sw;
    const y = (i / sw) | 0;
    const seed = seedAt[i]! * 4;
    const join = (n: number) => {
      if (bg[n]) return;
      const a = n * 4;
      if (px[a + 3]! < 16 || (dist2(a, i * 4) <= THR2 && dist2(a, seed) <= THR2 * 4)) grow(n, seedAt[i]!);
    };
    if (x > 0) join(i - 1);
    if (x < sw - 1) join(i + 1);
    if (y > 0) join(i - sw);
    if (y + 1 < sh) join(i + sw);
  }

  // Kept pixels touching the cut get partial alpha so edges don't halo.
  const soft = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (bg[i]) continue;
      if ((x > 0 && bg[i - 1]) || (x < sw - 1 && bg[i + 1]) || (y > 0 && bg[i - sw]) || (y + 1 < sh && bg[i + sw])) {
        soft[i] = 1;
      }
    }
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  octx.drawImage(src, 0, 0);
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, (y * s) | 0);
    for (let x = 0; x < w; x++) {
      const m = sy * sw + Math.min(sw - 1, (x * s) | 0);
      const a = (y * w + x) * 4 + 3;
      if (bg[m]) d[a] = 0;
      else if (soft[m]) d[a] = Math.min(d[a]!, BG_SOFT_A);
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
