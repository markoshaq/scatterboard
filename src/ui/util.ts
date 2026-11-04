export const DRAG_SLOP = 4;

// Shared pointer-drag with a floating ghost chip. onUp receives the release
// event whether or not the pointer moved; moved tells a click from a drag.
// onMove fires per pointermove past the slop and once with null when the
// gesture ends (up or cancel) so callers can clear hover affordances.
// Chrome that is never a drop target: a release over it cancels the
// drop instead of placing a card hidden behind the surface.
export const DROP_EXCLUDE = '.rail, .rail-trash, .side-panel, .ed-scrim';

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
  let outside = false;
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    document.removeEventListener('pointerout', out);
  };
  const move = (ev: PointerEvent) => {
    if (ev.buttons === 0) {
      // Released outside the window: no pointerup arrives, only
      // no-button moves. That is a cancel — but only after the pointer
      // really left the window mid-drag, or a stray zero-button move
      // inside (trackpad tap-drag, pen proximity) kills the gesture.
      if (ghost && outside) cancel();
      return;
    }
    // A pressed move inside clears the left-window flag: the pointer
    // came back still held, so a later no-button move is not a cancel.
    outside = false;
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
  const out = (ev: PointerEvent) => {
    if (!ev.relatedTarget) outside = true;
  };
  const up = (ev: PointerEvent) => {
    cleanup();
    ghost?.remove();
    onMove?.(null);
    onUp(ev, moved);
  };
  const cancel = () => {
    cleanup();
    ghost?.remove();
    onMove?.(null);
  };
  document.addEventListener('pointerout', out);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
