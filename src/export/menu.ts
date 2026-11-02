import { t } from '../strings';
import { ICONS } from '../ui/icons';
import { openToolPopup, type ToolPopup } from '../ui/popup';

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
  const node = document.createElement('div');
  node.className = 'menu-body';
  const pop = openToolPopup(anchor, node, true);

  const head = (text: string) => {
    const h = document.createElement('div');
    h.className = 'ts-head';
    h.textContent = text;
    node.appendChild(h);
  };
  const row = (label: string, onPick: () => void, disabled = false) => {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'pop-row';
    r.disabled = disabled;
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = label;
    r.appendChild(lab);
    r.addEventListener('click', () => {
      pop.close();
      onPick();
    });
    node.appendChild(r);
  };

  head(t('exImgHead'));
  row(t('exPng'), api.onPng);
  row(t('exPdfStd'), () => api.onPdf(false));
  row(t('exPdfHi'), () => api.onPdf(true));

  head(t('exDocHead'));
  row(t('exWord'), () => api.onDoc('doc'));
  row(t('exMd'), () => api.onDoc('md'));
  row(t('exTxt'), () => api.onDoc('txt'));
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pop-row';
  const tl = document.createElement('span');
  tl.className = 'pop-label';
  tl.textContent = t('exSubs');
  const ck = document.createElement('span');
  ck.className = 'pop-check';
  ck.innerHTML = ICONS.check;
  const sync = () => {
    ck.style.visibility = api.subs() ? 'visible' : 'hidden';
  };
  sync();
  toggle.append(tl, ck);
  toggle.addEventListener('click', () => {
    api.onToggleSubs();
    sync();
  });
  node.appendChild(toggle);

  head(t('exDataHead'));
  row(t('exFiles'), api.onFiles, !api.hasMedia());
  row(t('exJson'), api.onJson);
  row(t('exImport'), api.onImport);
  return pop;
}
