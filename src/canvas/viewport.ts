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

  // rAF handle of a running button/shortcut zoom tween. Continuous
  // input (wheel, pinch, drag pan) cancels it so the pointer always
  // wins over a settling animation.
  private anim: number | null = null;

  setSize(w: number, h: number) {
    this.vw = w;
    this.vh = h;
    this.changed();
  }

  changed() {
    this.onchange?.();
  }

  private cancelAnim() {
    if (this.anim !== null) {
      cancelAnimationFrame(this.anim);
      this.anim = null;
    }
  }

  toBoard(sx: number, sy: number) {
    return { x: (sx - this.x) / this.z, y: (sy - this.y) / this.z };
  }

  toScreen(bx: number, by: number) {
    return { x: bx * this.z + this.x, y: by * this.z + this.y };
  }

  panBy(dx: number, dy: number) {
    this.cancelAnim();
    this.x += dx;
    this.y += dy;
    this.changed();
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const z = Math.min(MAX_Z, Math.max(MIN_Z, this.z * factor));
    if (z === this.z) return;
    this.cancelAnim();
    const b = this.toBoard(sx, sy);
    this.z = z;
    this.x = sx - b.x * z;
    this.y = sy - b.y * z;
    this.changed();
  }

  // Ease-out cubic tween to a target transform; reduced-motion snaps
  // straight to the target. Each tick goes through changed(), so the
  // canvas grid, lines and DOM cards stay in lockstep.
  private animateTo(t: { x: number; y: number; z: number }, ms = 190) {
    this.cancelAnim();
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.snapTo(t);
      return;
    }
    const sx = this.x;
    const sy = this.y;
    const sz = this.z;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - p) ** 3;
      this.x = sx + (t.x - sx) * e;
      this.y = sy + (t.y - sy) * e;
      this.z = sz + (t.z - sz) * e;
      this.changed();
      this.anim = p < 1 ? requestAnimationFrame(tick) : null;
    };
    this.anim = requestAnimationFrame(tick);
  }

  // Instant jump for paths that cannot wait a frame (print fit).
  snapTo(t: { x: number; y: number; z: number }) {
    this.cancelAnim();
    this.x = t.x;
    this.y = t.y;
    this.z = t.z;
    this.changed();
  }

  zoomStep(dir: 1 | -1) {
    this.animateTo(this.zoomStepTarget(dir));
  }

  zoomStepTarget(dir: 1 | -1) {
    const factor = dir > 0 ? 1.25 : 0.8;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, this.z * factor));
    const b = this.toBoard(this.vw / 2, this.vh / 2);
    return { x: this.vw / 2 - b.x * z, y: this.vh / 2 - b.y * z, z };
  }

  reset() {
    this.animateTo(this.resetTarget());
  }

  // Tween to an absolute zoom level, anchored at the view centre.
  zoomTo(z: number) {
    z = Math.min(MAX_Z, Math.max(MIN_Z, z));
    const b = this.toBoard(this.vw / 2, this.vh / 2);
    this.animateTo({ x: this.vw / 2 - b.x * z, y: this.vh / 2 - b.y * z, z });
  }

  resetTarget() {
    const b = this.toBoard(this.vw / 2, this.vh / 2);
    return { x: this.vw / 2 - b.x, y: this.vh / 2 - b.y, z: 1 };
  }

  // Fit inside the usable box (viewport minus chrome insets): centered
  // horizontally, top-anchored so wide boards hug the topbar instead of
  // floating mid-screen.
  fit(r: Rect | null, ins = { l: 80, t: 80, r: 80, b: 80 }) {
    const t = this.fitTarget(r, ins);
    if (t) this.animateTo(t);
    else this.reset();
  }

  fitTarget(r: Rect | null, ins = { l: 80, t: 80, r: 80, b: 80 }): { x: number; y: number; z: number } | null {
    if (!r || r.w <= 0 || r.h <= 0) return null;
    const uw = this.vw - ins.l - ins.r;
    const uh = this.vh - ins.t - ins.b;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min(uw / r.w, uh / r.h)));
    return { x: ins.l + (uw - r.w * z) / 2 - r.x * z, y: ins.t - r.y * z, z };
  }

  viewRect(margin = 0): Rect {
    const a = this.toBoard(-margin, -margin);
    const b = this.toBoard(this.vw + margin, this.vh + margin);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  restore(p: { x: number; y: number; z: number } | undefined) {
    this.cancelAnim();
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
