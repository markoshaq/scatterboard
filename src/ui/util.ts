export const DRAG_SLOP = 4;

// Shared pointer-drag with a floating ghost chip. onUp receives the release
// event whether or not the pointer moved; moved tells a click from a drag.
// onMove fires per pointermove past the slop and once with null when the
// gesture ends (up or cancel) so callers can clear hover affordances.
export function dragGhost(
  e: PointerEvent,
  makeGhost: () => HTMLElement,
  onUp: (ev: PointerEvent, moved: boolean) => void,
  onMove?: (ev: PointerEvent | null) => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  let ghost: HTMLElement | null = null;
  let moved = false;
  const move = (ev: PointerEvent) => {
    // The pointer may leave the window before releasing: no pointerup,
    // just a move with no buttons. Treat it as a cancel.
    if (ev.buttons === 0) {
      cancel();
      return;
    }
    if (!ghost) {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_SLOP) return;
      ghost = makeGhost();
      ghost.classList.add('rail-ghost');
      document.body.appendChild(ghost);
      moved = true;
    }
    ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY + 12}px)`;
    onMove?.(ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    ghost?.remove();
    onMove?.(null);
    onUp(ev, moved);
  };
  const cancel = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    ghost?.remove();
    onMove?.(null);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
