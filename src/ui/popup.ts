import { mobileShell } from './util';

export interface ToolPopup {
  node: HTMLElement;
  close(): void;
}

// Keyboard-navigable children of a popup/panel: real controls and
// editable surfaces, not the containers around them.
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, [contenteditable=""], [contenteditable="true"], [tabindex]')].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

// Arrow keys, Home/End and Tab cycle through a surface's controls.
// Shared by tool popups and side panels; Esc stays on the dismiss stack.
export function cycleKeys(e: KeyboardEvent, root: HTMLElement) {
  // A focused <select> owns ArrowUp/Down for stepping its options;
  // cycling focus instead would make it unoperable by keyboard.
  const ae = document.activeElement as HTMLElement | null;
  if (ae?.tagName === 'SELECT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
  const items = focusables(root);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = i < 0 ? 0 : (i + 1) % items.length;
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = i <= 0 ? items.length - 1 : i - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next === -1) return;
  e.preventDefault();
  e.stopPropagation();
  items[next]!.focus();
}

// Move focus into a freshly opened surface, unless a caller already
// placed it or a text surface holds it (stealing focus from an edit
// session would collapse the selection the popup acts on).
export function focusInto(root: HTMLElement) {
  const ae = document.activeElement as HTMLElement | null;
  if (root.contains(ae)) return;
  if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;
  focusables(root)[0]?.focus({ preventScroll: true });
}

// Hand focus back to the element that opened a surface, when it is
// still on the page and focus has not already moved elsewhere.
export function focusBack(root: HTMLElement, opener: HTMLElement | null) {
  if (root.contains(document.activeElement) && opener?.isConnected) opener.focus();
}

// Popup semantics live with the builder that knows the surface's role;
// openToolPopup then mirrors aria-expanded on marked anchors for free.
export function haspopup(anchor: HTMLElement | DOMRect, kind: 'menu' | 'listbox' | 'dialog' | 'grid') {
  if (anchor instanceof HTMLElement) anchor.setAttribute('aria-haspopup', kind);
}

// Shared surface exit: stamp .out, drop pointer events, and remove the
// node once its closing animation lands. The timer is the bound when
// reduced motion flattens the animation to ~0ms; a child's own
// animationend must not trigger removal early, so only the node's own
// event counts.
export function outro(node: HTMLElement, ms = 220) {
  if (!node.isConnected || node.classList.contains('out')) {
    node.remove();
    return;
  }
  node.classList.add('out');
  node.style.pointerEvents = 'none';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    node.remove();
  };
  node.addEventListener('animationend', (e) => {
    if (e.target === node) finish();
  });
  setTimeout(finish, ms);
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

export function dismissDepth() {
  return dismissStack.length;
}

export function pushDismiss(s: { close(): void }) {
  dismissStack.push(s);
  // Bubble, not capture: surfaces' own Esc handlers (rename cancel,
  // result nav) run first and can stopPropagation to claim the key.
  if (dismissStack.length === 1) window.addEventListener('keydown', onDismissKey);
}

export function popDismiss(s: { close(): void }) {
  const i = dismissStack.indexOf(s);
  if (i !== -1) dismissStack.splice(i, 1);
  if (!dismissStack.length) window.removeEventListener('keydown', onDismissKey);
}

function onDismissKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const top = dismissStack[dismissStack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  top.close();
}

// Mirror the visual viewport height into --vvh: popups cap their height
// to what remains when the on-screen keyboard shrinks the visible area.
// Bound lazily so this module stays importable without a DOM.
let vvhBound = false;
export function bindVvh() {
  if (vvhBound) return;
  vvhBound = true;
  const set = () => document.body.style.setProperty('--vvh', `${window.visualViewport?.height ?? innerHeight}px`);
  window.visualViewport?.addEventListener('resize', set);
  window.addEventListener('resize', set);
  set();
}

// A real grab strip behind the pill visual: pull it down past a
// thumb's reach to dismiss (the handle is otherwise decorative).
// touch-action: none on .sheet-grab keeps the drag in JS instead of
// scrolling the sheet. Shared by openToolPopup and the due picker.
export function sheetGrab(node: HTMLElement, onDismiss: () => void) {
  const grab = document.createElement('div');
  grab.className = 'sheet-grab';
  node.prepend(grab);
  let gpid: number | null = null;
  let gy = 0;
  grab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // A second finger must not overwrite gpid: the first gesture's
    // window listeners would leak permanently.
    if (gpid !== null) return;
    gpid = e.pointerId;
    gy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== gpid) return;
      node.style.transform = `translateY(${Math.max(0, ev.clientY - gy)}px)`;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== gpid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      gpid = null;
      const dy = Math.max(0, ev.clientY - gy);
      node.style.transform = '';
      if (dy > 72) onDismiss();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// Anchored popup in screen space. One at a time; Esc and outside
// pointerdown close it (same dismiss pattern as the due popup).
// `below` drops the popup under the anchor instead of level with it,
// so topbar menus do not cover the buttons that opened them.
export function openToolPopup(anchor: HTMLElement | DOMRect, content: HTMLElement, below = false): ToolPopup {
  bindVvh();
  // Re-clicking the element that opened the live popup toggles it shut:
  // onDocDown leaves it up for the anchor, so the anchor's click handler
  // lands back here and gets an already-closed stub.
  const retoggle = anchor instanceof HTMLElement && anchor === currentAnchor;
  closeToolPopup();
  if (retoggle) return { node: content, close() {} };
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const boardAnchored = !(anchor instanceof HTMLElement) || !!anchor.closest('.doc');
  // Phones dock every popup as a bottom sheet: full width, thumb-high,
  // and never clipped by an anchor sitting near a screen edge.
  const sheet = mobileShell();
  const node = document.createElement('div');
  node.className = sheet ? 'tool-pop sheet' : 'tool-pop';
  node.setAttribute('role', 'dialog');
  node.appendChild(content);
  if (sheet) sheetGrab(node, () => closePop(false));
  node.addEventListener('pointerdown', (e) => e.stopPropagation());
  node.addEventListener('keydown', (e) => cycleKeys(e, node));
  const opener = anchor instanceof HTMLElement ? anchor : (document.activeElement as HTMLElement | null);
  if (anchor instanceof HTMLElement && anchor.hasAttribute('aria-haspopup')) {
    anchor.setAttribute('aria-expanded', 'true');
  }

  function closePop(restoreFocus: boolean) {
    if (current === pop) {
      current = null;
      currentAnchor = null;
      currentBoardAnchored = false;
    }
    releaseToolPopup(pop);
    popDismiss(pop);
    window.removeEventListener('pointerdown', onDocDown, true);
    window.visualViewport?.removeEventListener('resize', place);
    if (anchor instanceof HTMLElement && anchor.hasAttribute('aria-haspopup')) {
      anchor.setAttribute('aria-expanded', 'false');
    }
    // Outside-pointerdown closes leave focus where the pointer lands;
    // Esc/programmatic closes hand it back to the opener.
    if (restoreFocus) focusBack(node, opener);
    outro(node);
  }

  const pop: ToolPopup = {
    node,
    close() {
      closePop(true);
    },
  };

  function onDocDown(e: PointerEvent) {
    // The opening anchor is a toggle, not an outside click.
    if (anchor instanceof HTMLElement && anchor.contains(e.target as Node)) return;
    if (!node.contains(e.target as Node)) closePop(false);
  }

  const place = () => {
    if (sheet) return;
    const vw = window.visualViewport?.width ?? innerWidth;
    const vh = window.visualViewport?.height ?? innerHeight;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : rect;
    node.style.left = `${Math.max(8, Math.min(r.right + 8, vw - w - 8))}px`;
    const top = below ? r.bottom + 6 : r.top;
    node.style.top = `${Math.max(8, Math.min(top, vh - h - 8))}px`;
  };
  document.body.appendChild(node);
  place();
  // Callers fill `content` after openToolPopup returns: re-measure before
  // paint so the clamp sees the real size, not the empty box, then move
  // focus inside once the controls exist.
  queueMicrotask(() => {
    place();
    if (node.isConnected) focusInto(node);
  });
  window.addEventListener('pointerdown', onDocDown, true);
  // Rotation and the keyboard both move the anchor and the clamp bounds.
  window.visualViewport?.addEventListener('resize', place);
  pushDismiss(pop);
  current = pop;
  currentAnchor = anchor instanceof HTMLElement ? anchor : null;
  currentBoardAnchored = boardAnchored;
  return pop;
}
