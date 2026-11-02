import { ICONS } from './icons';
import { popDismiss, pushDismiss } from './popup';
import { t } from '../strings';

export interface PanelHandle {
  node: HTMLElement;
  body: HTMLElement;
  close(): void;
  onClose?: () => void;
}

interface PanelOpts {
  title: string;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
}

// Left slide-over panel shared by Unsorted, Trash and Search.
export function openPanel(opts: PanelOpts): PanelHandle {
  const node = document.createElement('div');
  node.className = 'side-panel';
  const head = document.createElement('div');
  head.className = 'sp-head';
  const title = document.createElement('span');
  title.className = 'sp-title';
  title.textContent = opts.title;
  head.appendChild(title);
  if (opts.actionLabel && opts.onAction) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'sp-action';
    action.textContent = opts.actionLabel;
    action.addEventListener('click', opts.onAction);
    head.appendChild(action);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sp-close';
  closeBtn.innerHTML = ICONS.close;
  head.appendChild(closeBtn);
  node.appendChild(head);
  if (opts.helper) {
    const help = document.createElement('div');
    help.className = 'sp-helper';
    help.textContent = opts.helper;
    node.appendChild(help);
  }
  const body = document.createElement('div');
  body.className = 'sp-body';
  node.appendChild(body);

  const handle: PanelHandle = {
    node,
    body,
    close() {
      if (node.classList.contains('out')) return;
      popDismiss(handle);
      node.classList.add('out');
      node.remove();
      handle.onClose?.();
    },
  };
  closeBtn.addEventListener('click', () => handle.close());
  node.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(node);
  pushDismiss(handle);
  return handle;
}

export function panelRow(icon: string, snippet: string, extra?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sp-row';
  const ic = document.createElement('span');
  ic.className = 'sp-ricon';
  ic.innerHTML = icon;
  const text = document.createElement('span');
  text.className = 'sp-rtext';
  text.textContent = snippet;
  row.append(ic, text);
  if (extra) {
    const ex = document.createElement('span');
    ex.className = 'sp-rextra';
    ex.textContent = extra;
    row.appendChild(ex);
  }
  return row;
}

export function panelEmpty(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'sp-empty';
  el.textContent = text;
  return el;
}

export function dayGroupLabel(ts: number): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(new Date(ts))) / 86400000);
  if (diff === 0) return t('today');
  if (diff === 1) return t('yesterday');
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
