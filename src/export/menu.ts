import { t } from '../strings';
import { ICONS } from '../ui/icons';
import { haspopup, openToolPopup, type ToolPopup } from '../ui/popup';

interface ExportMenuApi {
  hasMedia(): boolean;
  subs(): boolean;
  onToggleSubs(): void;
  onPng(): void;
  onPdf(hi: boolean): void;
  onDoc(kind: 'doc' | 'md' | 'txt'): void;
  onFiles(): void;
  onJson(): void;
  onImport(): void;
}

// Topbar Export menu: sectioned popup matching the View menu's shape.
// The sub-boards toggle stays open; action rows close it.
export function openExportMenu(anchor: HTMLElement, api: ExportMenuApi): ToolPopup {
  haspopup(anchor, 'menu');
  const node = document.createElement('div');
  node.className = 'menu-body';
  node.setAttribute('role', 'menu');
  const pop = openToolPopup(anchor, node, true);

  const head = (text: string) => {
    const h = document.createElement('div');
    h.className = 'ts-head';
    h.setAttribute('role', 'presentation');
    h.textContent = text;
    node.appendChild(h);
  };
  const row = (label: string, icon: string, onPick: () => void, disabled = false) => {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'pop-row';
    r.setAttribute('role', 'menuitem');
    r.disabled = disabled;
    const ic = document.createElement('span');
    ic.className = 'pop-icon';
    ic.innerHTML = icon;
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = label;
    r.append(ic, lab);
    r.addEventListener('click', () => {
      pop.close();
      onPick();
    });
    node.appendChild(r);
  };

  head(t('exImgHead'));
  row(t('exPng'), ICONS.image, api.onPng);
  row(t('exPdfStd'), ICONS.file, () => api.onPdf(false));
  row(t('exPdfHi'), ICONS.file, () => api.onPdf(true));

  head(t('exDocHead'));
  row(t('exWord'), ICONS.document, () => api.onDoc('doc'));
  row(t('exMd'), ICONS.txCode, () => api.onDoc('md'));
  row(t('exTxt'), ICONS.title, () => api.onDoc('txt'));
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pop-row';
  toggle.setAttribute('role', 'menuitemcheckbox');
  const tic = document.createElement('span');
  tic.className = 'pop-icon';
  tic.innerHTML = ICONS.board;
  const tl = document.createElement('span');
  tl.className = 'pop-label';
  tl.textContent = t('exSubs');
  const ck = document.createElement('span');
  ck.className = 'pop-check';
  ck.innerHTML = ICONS.check;
  const sync = () => {
    const on = api.subs();
    ck.style.visibility = on ? 'visible' : 'hidden';
    toggle.setAttribute('aria-checked', String(on));
  };
  sync();
  toggle.append(tic, tl, ck);
  toggle.addEventListener('click', () => {
    api.onToggleSubs();
    sync();
  });
  node.appendChild(toggle);

  head(t('exDataHead'));
  row(t('exFiles'), ICONS.download, api.onFiles, !api.hasMedia());
  row(t('exJson'), ICONS.txCode, api.onJson);
  row(t('exImport'), ICONS.upload, api.onImport);
  return pop;
}
