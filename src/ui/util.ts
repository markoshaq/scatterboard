const DRAG_SLOP = 4;

// Shared pointer-drag with a floating ghost chip. onUp receives the release
// event whether or not the pointer moved; moved tells a click from a drag.
// onMove fires per pointermove past the slop and once with null when the
// gesture ends (up or cancel) so callers can clear hover affordances.
// Chrome that is never a drop target: a release over it cancels the
// drop instead of placing a card hidden behind the surface.
export const DROP_EXCLUDE = '.rail, .rail-trash, .side-panel, .ed-scrim';

// The phone breakpoint shared by chrome layout and JS-side presentation
// choices: bottom bar, sheet popups, fit insets.
export function mobileShell(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;
}

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
    document.body.classList.remove('ghost-drag');
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
      document.body.classList.add('ghost-drag');
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

// Missed-release guard for window-tracked pointer gestures: a release
// outside the browser window delivers no pointerup, and the next move
// for that pointer arrives with buttons 0. After the gesture's pointer
// leaves mid-gesture, the first buttons-0 move calls onLost once (treat
// as cancel). Call lost() inside the pointermove filter and dispose()
// in the gesture's own cleanup.
export function releaseGuard(pid: number, onLost: (ev: PointerEvent) => void) {
  let outside = false;
  let done = false;
  const out = (ev: PointerEvent) => {
    if (ev.pointerId === pid && !ev.relatedTarget) outside = true;
  };
  document.addEventListener('pointerout', out);
  const dispose = () => {
    document.removeEventListener('pointerout', out);
  };
  const lost = (ev: PointerEvent) => {
    if (done) return true;
    if (ev.buttons !== 0) {
      outside = false;
      return false;
    }
    if (!outside) return false;
    done = true;
    dispose();
    onLost(ev);
    return true;
  };
  return { lost, dispose };
}
