export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_Z = 0.1;
const MAX_Z = 4;

export class Viewport {
  x = 0;
  y = 0;
  z = 1;
  vw = 0;
  vh = 0;
  onchange: (() => void) | null = null;

  setSize(w: number, h: number) {
    this.vw = w;
    this.vh = h;
    this.changed();
  }

  changed() {
    this.onchange?.();
  }

  toBoard(sx: number, sy: number) {
    return { x: (sx - this.x) / this.z, y: (sy - this.y) / this.z };
  }

  toScreen(bx: number, by: number) {
    return { x: bx * this.z + this.x, y: by * this.z + this.y };
  }

  panBy(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    this.changed();
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const z = Math.min(MAX_Z, Math.max(MIN_Z, this.z * factor));
    if (z === this.z) return;
    const b = this.toBoard(sx, sy);
    this.z = z;
    this.x = sx - b.x * z;
    this.y = sy - b.y * z;
    this.changed();
  }

  zoomStep(dir: 1 | -1) {
    this.zoomAt(dir > 0 ? 1.25 : 0.8, this.vw / 2, this.vh / 2);
  }

  reset() {
    const z = 1;
    const b = this.toBoard(this.vw / 2, this.vh / 2);
    this.z = z;
    this.x = this.vw / 2 - b.x * z;
    this.y = this.vh / 2 - b.y * z;
    this.changed();
  }

  fit(r: Rect | null, pad = 80) {
    if (!r || r.w <= 0 || r.h <= 0) {
      this.reset();
      return;
    }
    const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((this.vw - pad * 2) / r.w, (this.vh - pad * 2) / r.h)));
    this.z = z;
    this.x = this.vw / 2 - (r.x + r.w / 2) * z;
    this.y = this.vh / 2 - (r.y + r.h / 2) * z;
    this.changed();
  }

  viewRect(margin = 0): Rect {
    const a = this.toBoard(-margin, -margin);
    const b = this.toBoard(this.vw + margin, this.vh + margin);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  restore(p: { x: number; y: number; z: number } | undefined) {
    if (p) {
      this.x = p.x;
      this.y = p.y;
      this.z = Math.min(MAX_Z, Math.max(MIN_Z, p.z));
    } else {
      this.x = this.vw / 2;
      this.y = this.vh / 2;
      this.z = 1;
    }
    this.changed();
  }

  snapshot() {
    return { x: this.x, y: this.y, z: this.z };
  }
}
