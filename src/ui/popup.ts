export interface ToolPopup {
  node: HTMLElement;
  close(): void;
}

let current: ToolPopup | null = null;

export function closeToolPopup() {
  current?.close();
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
export function openToolPopup(anchor: HTMLElement | DOMRect, content: HTMLElement): ToolPopup {
  closeToolPopup();
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const node = document.createElement('div');
  node.className = 'tool-pop';
  node.appendChild(content);
  node.addEventListener('pointerdown', (e) => e.stopPropagation());

  const pop: ToolPopup = {
    node,
    close() {
      if (current === pop) current = null;
      popDismiss(pop);
      window.removeEventListener('pointerdown', onDocDown, true);
      node.remove();
    },
  };

  function onDocDown(e: PointerEvent) {
    if (!node.contains(e.target as Node)) pop.close();
  }

  document.body.appendChild(node);
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  node.style.left = `${Math.max(8, Math.min(rect.right + 8, innerWidth - w - 8))}px`;
  node.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - h - 8))}px`;
  window.addEventListener('pointerdown', onDocDown, true);
  pushDismiss(pop);
  current = pop;
  return pop;
}
