// Shared hover tooltip for icon-only chrome: a delayed label chip
// anchored under the element. Mouse/pen only; touch and keyboard keep
// the aria-label path (tip() sets it, so callers skip title).
let live: HTMLElement | null = null;
let owner: HTMLElement | null = null;
let timer = 0;
let watch = 0;

function hide() {
  window.clearInterval(watch);
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
  // The owner can leave the DOM while the tip is up (a rail rebuild on
  // selection change): without a sweep the label sticks forever.
  window.clearInterval(watch);
  watch = window.setInterval(() => {
    if (!owner?.isConnected) hide();
  }, 250);
}

export function tip(el: HTMLElement, label: string) {
  el.setAttribute('aria-label', label);
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    window.clearTimeout(timer);
    // A detached anchor reports a (0,0) rect: never show on it.
    timer = window.setTimeout(() => {
      if (el.isConnected) show(el, label);
    }, 420);
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
