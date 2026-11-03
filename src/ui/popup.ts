export interface ToolPopup {
  node: HTMLElement;
  close(): void;
}

let current: ToolPopup | null = null;
let currentAnchor: HTMLElement | null = null;
let currentBoardAnchored = false;

export function closeToolPopup() {
  current?.close();
}

// Popups with their own chrome (the due picker) still register as the
// current tool popup so board switches and editor mounts can close them.
export function claimToolPopup(pop: ToolPopup, boardAnchored = false) {
  closeToolPopup();
  current = pop;
  currentAnchor = null;
  currentBoardAnchored = boardAnchored;
}

export function releaseToolPopup(pop: ToolPopup) {
  if (current === pop) {
    current = null;
    currentAnchor = null;
    currentBoardAnchored = false;
  }
}

// Closes only popups anchored to board space (pins, chips, DOMRect
// anchors): a viewport move would detach them. Chrome-anchored popups
// (rail, topbar) stay open.
export function closeBoardPopup() {
  if (currentBoardAnchored) current?.close();
}

// Esc closes only the topmost anchored surface (stopPropagation does
// not reach sibling listeners on the same target). Every dismissable
// surface registers its closer here and unregisters in its close().
const dismissStack: { close(): void }[] = [];

export function pushDismiss(s: { close(): void }) {
  dismissStack.push(s);
  if (dismissStack.length === 1) window.addEventListener('keydown', onDismissKey, true);
}

export function popDismiss(s: { close(): void }) {
  const i = dismissStack.indexOf(s);
  if (i !== -1) dismissStack.splice(i, 1);
  if (!dismissStack.length) window.removeEventListener('keydown', onDismissKey, true);
}

function onDismissKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const top = dismissStack[dismissStack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  top.close();
}

// Anchored popup in screen space. One at a time; Esc and outside
// pointerdown close it (same dismiss pattern as the due popup).
// `below` drops the popup under the anchor instead of level with it,
// so topbar menus do not cover the buttons that opened them.
export function openToolPopup(anchor: HTMLElement | DOMRect, content: HTMLElement, below = false): ToolPopup {
  // Re-clicking the element that opened the live popup toggles it shut:
  // onDocDown leaves it up for the anchor, so the anchor's click handler
  // lands back here and gets an already-closed stub.
  const retoggle = anchor instanceof HTMLElement && anchor === currentAnchor;
  closeToolPopup();
  if (retoggle) return { node: content, close() {} };
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const boardAnchored = !(anchor instanceof HTMLElement) || !!anchor.closest('.doc');
  const node = document.createElement('div');
  node.className = 'tool-pop';
  node.appendChild(content);
  node.addEventListener('pointerdown', (e) => e.stopPropagation());

  const pop: ToolPopup = {
    node,
    close() {
      if (current === pop) {
        current = null;
        currentAnchor = null;
        currentBoardAnchored = false;
      }
      releaseToolPopup(pop);
      popDismiss(pop);
      window.removeEventListener('pointerdown', onDocDown, true);
      node.remove();
    },
  };

  function onDocDown(e: PointerEvent) {
    // The opening anchor is a toggle, not an outside click.
    if (anchor instanceof HTMLElement && anchor.contains(e.target as Node)) return;
    if (!node.contains(e.target as Node)) pop.close();
  }

  const place = () => {
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    node.style.left = `${Math.max(8, Math.min(rect.right + 8, innerWidth - w - 8))}px`;
    const top = below ? rect.bottom + 6 : rect.top;
    node.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;
  };
  document.body.appendChild(node);
  place();
  // Callers fill `content` after openToolPopup returns: re-measure before
  // paint so the clamp sees the real size, not the empty box.
  queueMicrotask(place);
  window.addEventListener('pointerdown', onDocDown, true);
  pushDismiss(pop);
  current = pop;
  currentAnchor = anchor instanceof HTMLElement ? anchor : null;
  currentBoardAnchored = boardAnchored;
  return pop;
}
