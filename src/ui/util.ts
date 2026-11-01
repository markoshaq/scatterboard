export const DRAG_SLOP = 4;

// Shared pointer-drag with a floating ghost chip. onUp receives the release
// event whether or not the pointer moved; moved tells a click from a drag.
export function dragGhost(
  e: PointerEvent,
  makeGhost: () => HTMLElement,
  onUp: (ev: PointerEvent, moved: boolean) => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  let ghost: HTMLElement | null = null;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_SLOP) return;
      ghost = makeGhost();
      ghost.classList.add('rail-ghost');
      document.body.appendChild(ghost);
      moved = true;
    }
    ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY + 12}px)`;
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ghost?.remove();
    onUp(ev, moved);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
