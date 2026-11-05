import { dayNames, monthName, t } from '../strings';
import { claimToolPopup, closeToolPopup, cycleKeys, focusBack, focusInto, haspopup, outro, popDismiss, pushDismiss, releaseToolPopup } from './popup';

export interface DueValue {
  dueAt?: number;
  hasTime?: boolean;
}

export interface DuePopupHandle {
  node: HTMLElement;
  close(): void;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

interface PopupState {
  day: Date | null;
  hasTime: boolean;
  hour: number;
  minute: number;
  pm: boolean;
  viewY: number;
  viewM: number;
}

export function openDuePopup(opts: {
  anchor: HTMLElement;
  current: DueValue;
  onCommit: (v: DueValue) => void;
}): DuePopupHandle {
  closeToolPopup();
  haspopup(opts.anchor, 'dialog');
  opts.anchor.setAttribute('aria-expanded', 'true');
  const st: PopupState = {
    day: null,
    hasTime: false,
    hour: 9,
    minute: 0,
    pm: false,
    viewY: 0,
    viewM: 0,
  };
  if (opts.current.dueAt !== undefined) {
    const d = new Date(opts.current.dueAt);
    st.day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    st.hasTime = opts.current.hasTime === true;
    const h24 = d.getHours();
    st.hour = h24 % 12 === 0 ? 12 : h24 % 12;
    st.minute = d.getMinutes();
    st.pm = h24 >= 12;
  }
  const base = st.day ?? new Date();
  st.viewY = base.getFullYear();
  st.viewM = base.getMonth();

  const node = document.createElement('div');
  node.className = 'due-pop';
  node.setAttribute('role', 'dialog');
  node.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    cycleKeys(e, node);
  });
  node.addEventListener('pointerdown', (e) => e.stopPropagation());

  const cal = document.createElement('div');
  cal.className = 'dp-cal';
  const foot = document.createElement('div');
  foot.className = 'dp-foot';
  node.append(cal, foot);

  function dueTimestamp(): number | undefined {
    if (!st.day) return undefined;
    let h = st.hour % 12;
    if (st.pm) h += 12;
    return new Date(st.day.getFullYear(), st.day.getMonth(), st.day.getDate(), h, st.minute).getTime();
  }

  function commit() {
    const out: DueValue = {};
    const dueAt = dueTimestamp();
    if (dueAt !== undefined) {
      out.dueAt = dueAt;
      out.hasTime = st.hasTime;
    }
    opts.onCommit(out);
  }

  function sameDay(a: Date, y: number, m: number, d: number) {
    return a.getFullYear() === y && a.getMonth() === m && a.getDate() === d;
  }

  function renderCal() {
    cal.textContent = '';
    const nav = document.createElement('div');
    nav.className = 'dp-nav';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = '‹';
    prev.title = t('prevMonth');
    prev.setAttribute('aria-label', t('prevMonth'));
    prev.addEventListener('click', () => {
      st.viewM -= 1;
      if (st.viewM < 0) {
        st.viewM = 11;
        st.viewY -= 1;
      }
      renderCal();
    });
    const title = document.createElement('span');
    title.className = 'dp-title';
    title.textContent = `${monthName(st.viewM)} ${st.viewY}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '›';
    next.title = t('nextMonth');
    next.setAttribute('aria-label', t('nextMonth'));
    next.addEventListener('click', () => {
      st.viewM += 1;
      if (st.viewM > 11) {
        st.viewM = 0;
        st.viewY += 1;
      }
      renderCal();
    });
    nav.append(prev, title, next);
    cal.appendChild(nav);

    const grid = document.createElement('div');
    grid.className = 'dp-grid';
    for (const d of dayNames()) {
      const h = document.createElement('span');
      h.className = 'dp-dow';
      h.textContent = d;
      grid.appendChild(h);
    }
    const first = new Date(st.viewY, st.viewM, 1);
    const days = new Date(st.viewY, st.viewM + 1, 0).getDate();
    const today = new Date();
    const todayAt = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    for (let i = 0; i < first.getDay(); i++) grid.appendChild(document.createElement('span'));
    for (let d = 1; d <= days; d++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'dp-day';
      cell.textContent = String(d);
      const at = new Date(st.viewY, st.viewM, d).getTime();
      if (at < todayAt) {
        cell.disabled = true;
      } else {
        if (st.day && sameDay(st.day, st.viewY, st.viewM, d)) cell.classList.add('sel');
        cell.addEventListener('click', () => {
          st.day = new Date(st.viewY, st.viewM, d);
          renderCal();
          renderFoot();
          commit();
        });
      }
      grid.appendChild(cell);
    }
    cal.appendChild(grid);
  }

  function timeSelect(values: number[], cur: number, fmt: (v: number) => string, set: (v: number) => void) {
    const sel = document.createElement('select');
    for (const v of values) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = fmt(v);
      if (v === cur) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      set(Number(sel.value));
      commit();
    });
    return sel;
  }

  function renderFoot() {
    foot.textContent = '';
    if (!st.hasTime) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'dp-add-time';
      add.textContent = t('addDueTime');
      add.addEventListener('click', () => {
        st.hasTime = true;
        renderFoot();
        if (st.day) commit();
      });
      foot.appendChild(add);
    } else {
      const row = document.createElement('div');
      row.className = 'dp-time';
      row.appendChild(
        timeSelect(HOURS, st.hour, (v) => String(v).padStart(2, '0'), (v) => (st.hour = v)),
      );
      // A stored off-step minute keeps its exact value as an extra option.
      const mins = MINUTES.includes(st.minute) ? MINUTES : [...MINUTES, st.minute].sort((a, b) => a - b);
      row.appendChild(
        timeSelect(mins, st.minute, (v) => String(v).padStart(2, '0'), (v) => (st.minute = v)),
      );
      const ap = document.createElement('select');
      for (const [v, label] of [
        ['am', 'am'],
        ['pm', 'pm'],
      ] as const) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        if ((v === 'pm') === st.pm) o.selected = true;
        ap.appendChild(o);
      }
      ap.addEventListener('change', () => {
        st.pm = ap.value === 'pm';
        commit();
      });
      row.appendChild(ap);
      foot.appendChild(row);
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'dp-clear';
    clear.textContent = t('clear');
    clear.addEventListener('click', () => {
      st.day = null;
      commit();
      close();
    });
    foot.appendChild(clear);
  }

  function close() {
    closePop(true);
  }

  function closePop(restoreFocus: boolean) {
    releaseToolPopup(handle);
    popDismiss(handle);
    window.removeEventListener('pointerdown', onDocDown, true);
    opts.anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) focusBack(node, opts.anchor);
    outro(node);
  }

  function onDocDown(e: PointerEvent) {
    if (!node.contains(e.target as Node)) closePop(false);
  }

  renderCal();
  renderFoot();

  const r = opts.anchor.getBoundingClientRect();
  const vw = window.visualViewport?.width ?? innerWidth;
  const vh = window.visualViewport?.height ?? innerHeight;
  node.style.left = `${Math.max(8, Math.min(r.left, vw - 260))}px`;
  node.style.top = `${Math.max(8, Math.min(r.bottom + 6, vh - 340))}px`;
  document.body.appendChild(node);
  window.addEventListener('pointerdown', onDocDown, true);

  const handle: DuePopupHandle = { node, close };
  pushDismiss(handle);
  queueMicrotask(() => {
    if (node.isConnected) focusInto(node);
  });
  // Same lifecycle as tool popups: closeToolPopup must reach it on board
  // switches and editor mounts, and a card-anchored picker closes on pan.
  claimToolPopup(handle, !!opts.anchor.closest('.doc'));
  return handle;
}
