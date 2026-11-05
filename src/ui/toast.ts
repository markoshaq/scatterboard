import { t } from '../strings';

let host: HTMLElement | null = null;

// The container is the live region: it must exist before any toast
// lands inside it or screen readers miss the announcement.
function toastHost(): HTMLElement {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

// Shared dismissal: the .out fade in chrome.css runs, then the node
// leaves. The answer is given up front: after() runs now, and the
// controls drop out so the fading shell is inert.
function dismissEl(el: HTMLElement, after?: () => void) {
  if (!el.isConnected) {
    after?.();
    return;
  }
  el.classList.add('out');
  el.style.pointerEvents = 'none';
  for (const b of el.querySelectorAll('button')) b.remove();
  setTimeout(() => el.remove(), 420);
  after?.();
}

// tone marks the accent edge: 'ok' confirmations, 'warn' degraded
// states, 'err' failures (which also upgrade the live region to alert).
export function toast(msg: string, tone?: 'ok' | 'warn' | 'err') {
  const el = document.createElement('div');
  el.className = `toast${tone ? ` ${tone}` : ''}`;
  if (tone === 'err') el.setAttribute('role', 'alert');
  el.textContent = msg;
  toastHost().appendChild(el);
  setTimeout(() => el.classList.add('out'), 1400);
  setTimeout(() => el.remove(), 1900);
}

// Sticky spinner toast for async work (exports, imports). The returned
// function dismisses it; callers must invoke it on every exit path.
export function busy(msg: string): () => void {
  const el = document.createElement('div');
  el.className = 'toast sticky busy';
  el.setAttribute('role', 'status');
  const spin = document.createElement('span');
  spin.className = 'toast-spin';
  const span = document.createElement('span');
  span.textContent = msg;
  el.append(spin, span);
  toastHost().appendChild(el);
  return () => dismissEl(el);
}

// Sticky toast with one action button plus dismiss; used for the
// "keep in sync?" and helper offers. onDone fires only when the toast
// exits without the action being taken. timeoutMs 0 keeps it up until
// answered (security prompts should not vanish).
export function choice(msg: string, actionLabel: string, onAction: () => void, onDone?: () => void, timeoutMs = 9000) {
  const el = document.createElement('div');
  el.className = 'toast sticky';
  el.setAttribute('role', 'alert');
  const span = document.createElement('span');
  span.textContent = msg;
  const act = document.createElement('button');
  act.type = 'button';
  act.className = 'toast-act';
  act.textContent = actionLabel;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-x';
  x.textContent = '×';
  x.setAttribute('aria-label', t('close'));
  el.append(span, act, x);
  toastHost().appendChild(el);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    dismissEl(el, onDone);
  };
  act.addEventListener('click', () => {
    if (done) return;
    done = true;
    dismissEl(el, onAction);
  });
  x.addEventListener('click', finish);
  if (timeoutMs > 0) setTimeout(finish, timeoutMs);
}

export function hint(msg: string, onDone: () => void) {
  const el = document.createElement('div');
  el.className = 'toast sticky';
  const span = document.createElement('span');
  span.textContent = msg;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-x';
  x.textContent = '×';
  x.setAttribute('aria-label', t('close'));
  el.append(span, x);
  toastHost().appendChild(el);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    dismissEl(el, onDone);
  };
  x.addEventListener('click', finish);
  setTimeout(finish, 14000);
}
