let host: HTMLElement | null = null;

export function toast(msg: string) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 1400);
  setTimeout(() => el.remove(), 1900);
}

// Sticky toast with one action button plus dismiss; used for the
// "keep in sync?" and helper offers. onDone fires on any exit.
export function choice(msg: string, actionLabel: string, onAction: () => void, onDone?: () => void) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast sticky';
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
  el.append(span, act, x);
  host.appendChild(el);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    onDone?.();
  };
  act.addEventListener('click', () => {
    if (done) return;
    done = true;
    el.remove();
    onAction();
  });
  x.addEventListener('click', finish);
  setTimeout(finish, 9000);
}

export function hint(msg: string, onDone: () => void) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast sticky';
  const span = document.createElement('span');
  span.textContent = msg;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-x';
  x.textContent = '\u00d7';
  el.append(span, x);
  host.appendChild(el);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    onDone();
  };
  x.addEventListener('click', finish);
  setTimeout(finish, 14000);
}
