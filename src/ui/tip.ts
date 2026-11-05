// Shared hover tooltip for icon-only chrome: a delayed label chip
// anchored under the element. Mouse/pen only; touch and keyboard keep
// the aria-label path (tip() sets it, so callers skip title).
let live: HTMLElement | null = null;
let owner: HTMLElement | null = null;
let timer = 0;

function hide() {
  live?.remove();
  live = null;
  owner = null;
}

function show(el: HTMLElement, label: string) {
  hide();
  const node = document.createElement('div');
  node.className = 'tip';
  node.textContent = label;
  node.setAttribute('role', 'tooltip');
  document.body.appendChild(node);
  const r = el.getBoundingClientRect();
  const vw = window.visualViewport?.width ?? innerWidth;
  const w = node.offsetWidth;
  node.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, vw - w - 6))}px`;
  node.style.top = `${Math.min(r.bottom + 6, (window.visualViewport?.height ?? innerHeight) - node.offsetHeight - 6)}px`;
  live = node;
  owner = el;
}

export function tip(el: HTMLElement, label: string) {
  el.setAttribute('aria-label', label);
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(el, label), 420);
  });
  el.addEventListener('pointerleave', () => {
    window.clearTimeout(timer);
    if (owner === el) hide();
  });
  el.addEventListener('pointerdown', () => {
    window.clearTimeout(timer);
    hide();
  });
}
