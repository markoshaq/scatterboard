import type { Element, SketchDoc, Stroke } from '../state/schema';
import { sketchDoc, SKETCH_PAD_H, SKETCH_PAD_W } from '../state/schema';
import { DrawPad } from '../draw/pad';
import { openScrim } from './shell';
import type { EditorHandle } from './doceditor';
import type { Viewport } from '../canvas/viewport';

interface SketchEditorCtx {
  patch(doc: SketchDoc): void;
  exit(): void;
  ink?: boolean | undefined;
}

// Sketch card editor at #/e/<id>: fixed 600x450 pad centered over the
// dimmed board, shared draw toolbar. Save commits one content patch.
export function openSketchEditor(el: Element, ctx: SketchEditorCtx): EditorHandle {
  const scrim = openScrim('ed-skwrap');
  const card = document.createElement('div');
  card.className = 'ed-sk-card';
  const stage = document.createElement('div');
  stage.className = 'sk-pad';
  // Strokes stay in 600x450 pad space; on small screens the stage just
  // renders that space smaller (svg viewBox + scaled projection, same
  // as the image editor's draw-on mode).
  const fit = Math.min(1, (innerWidth - 48) / SKETCH_PAD_W, (innerHeight - 180) / SKETCH_PAD_H);
  stage.style.width = `${SKETCH_PAD_W * fit}px`;
  stage.style.height = `${SKETCH_PAD_H * fit}px`;
  card.appendChild(stage);
  scrim.node.appendChild(card);

  const pad = new DrawPad({
    initial: sketchDoc(el)?.strokes ?? [],
    ink: ctx.ink,
    onSave: (strokes: Stroke[]) => {
      ctx.patch({ strokes });
      ctx.exit();
    },
    onCancel: () => ctx.exit(),
  });
  pad.mount({
    surface: stage,
    svgParent: stage,
    project: (e) => {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left) / fit, y: (e.clientY - r.top) / fit };
    },
    tol: 6 / fit,
    viewBox: `0 0 ${SKETCH_PAD_W} ${SKETCH_PAD_H}`,
  });
  // Floating toolbar centered above the pad.
  scrim.node.appendChild(pad.tools);

  return {
    close() {
      pad.destroy();
      scrim.close();
    },
  };
}

interface BoardDrawCtx {
  vp: Viewport;
  ink?: boolean | undefined;
  onSave(strokes: Stroke[]): void;
  onCancel(): void;
}

// Board-level draw mode (rail Draw / Shift+D): veil dims the board and
// captures strokes in board coords; the live svg rides the same
// transform as docEl so strokes stay crisp under the dim.
export function openBoardDraw(ctx: BoardDrawCtx): EditorHandle {
  const veil = document.createElement('div');
  veil.className = 'draw-veil';
  const svgWrap = document.createElement('div');
  svgWrap.className = 'draw-wrap';
  svgWrap.style.transform = `translate(${ctx.vp.x}px, ${ctx.vp.y}px) scale(${ctx.vp.z})`;
  veil.appendChild(svgWrap);
  document.body.appendChild(veil);
  // An in-flight zoom tween at entry keeps mutating vp while project()
  // reads it live: track the transform or early strokes land offset.
  let raf = 0;
  let lx = NaN, ly = NaN, lz = NaN;
  const follow = () => {
    const { x, y, z } = ctx.vp;
    if (x !== lx || y !== ly || z !== lz) {
      lx = x; ly = y; lz = z;
      svgWrap.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    }
    raf = requestAnimationFrame(follow);
  };
  raf = requestAnimationFrame(follow);

  const pad = new DrawPad({ ink: ctx.ink, onSave: ctx.onSave, onCancel: ctx.onCancel });
  pad.mount({
    surface: veil,
    svgParent: svgWrap,
    project: (e) => ctx.vp.toBoard(e.clientX, e.clientY),
    tol: 6 / ctx.vp.z,
  });
  veil.appendChild(pad.tools);

  return {
    close() {
      cancelAnimationFrame(raf);
      pad.destroy();
      veil.remove();
    },
  };
}
