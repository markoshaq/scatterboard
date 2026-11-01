import type { Element, SketchDoc, Stroke } from '../state/schema';
import { sketchDoc, SKETCH_PAD_H, SKETCH_PAD_W } from '../state/schema';
import { DrawPad } from '../draw/pad';
import { openScrim } from './shell';
import type { EditorHandle } from './doceditor';
import type { Viewport } from '../canvas/viewport';

export interface SketchEditorCtx {
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
  stage.style.width = `${SKETCH_PAD_W}px`;
  stage.style.height = `${SKETCH_PAD_H}px`;
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
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    tol: 6,
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

export interface BoardDrawCtx {
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
      pad.destroy();
      veil.remove();
    },
  };
}
