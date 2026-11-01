import type { Currency, Lang } from '../persist/storage';
import { LANGS, t } from '../strings';
import { ICONS } from './icons';
import { openToolPopup, type ToolPopup } from './popup';

export interface SettingsApi {
  theme(): 'light' | 'dark';
  onTheme(mode: 'light' | 'dark'): void;
  scale(): number;
  onScale(s: number): void;
  // Async storage figures: {doc bytes, blob bytes} or null while loading.
  storage(): Promise<{ doc: number; blobs: number }>;
  lang(): Lang;
  onLang(l: Lang): void;
  browserLang(): boolean;
  onBrowserLang(v: boolean): void;
  currency(): Currency;
  onCurrency(c: Currency): void;
  flag(key: 'noOverlap' | 'ink' | 'undoArrows' | 'unfurl'): boolean;
  onFlag(key: 'noOverlap' | 'ink' | 'undoArrows' | 'unfurl', v: boolean): void;
  // Alignment-guide opacity: 1 full, 0.5 faint, 0 hidden.
  guideAlpha(): number;
  onGuideAlpha(v: number): void;
  onTemplates(): void;
  // Toolbar palette editor: ordered keys with hidden flags, moves and
  // a reset back to the default order.
  railItems(): { key: string; label: string; hidden: boolean }[];
  onRailMove(key: string, dir: -1 | 1): void;
  onRailHide(key: string, hidden: boolean): void;
  onRailReset(): void;
}

export const SCALE_STEPS = [0.85, 1, 1.15];
const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

function head(label: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'ts-head';
  h.textContent = label;
  return h;
}

function radioRow(label: string, checked: () => boolean, pick: () => void, exclusive?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pop-row';
  const lab = document.createElement('span');
  lab.className = 'pop-label';
  lab.textContent = label;
  const ck = document.createElement('span');
  ck.className = 'pop-check';
  ck.innerHTML = ICONS.check;
  const sync = () => {
    ck.style.visibility = checked() ? 'visible' : 'hidden';
  };
  sync();
  b.append(lab, ck);
  b.addEventListener('click', () => {
    pick();
    if (exclusive) exclusive();
    else sync();
  });
  (b as HTMLButtonElement & { syncCheck?: () => void }).syncCheck = sync;
  return b;
}

// Create-palette editor: reorder with up/down arrows, hide per row,
// Reset restores the default order. One row per create type.
function openToolbarEditor(anchor: HTMLElement, api: SettingsApi) {
  const node = document.createElement('div');
  node.className = 'menu-body tbe-body';
  const pop = openToolPopup(anchor, node);

  const render = () => {
    node.textContent = '';
    const items = api.railItems();
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'tbe-row';
      const lab = document.createElement('span');
      lab.className = 'tbe-label';
      lab.textContent = it.label;
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'tbe-mini';
      up.textContent = '↑';
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        api.onRailMove(it.key, -1);
        render();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'tbe-mini';
      down.textContent = '↓';
      down.disabled = i === items.length - 1;
      down.addEventListener('click', () => {
        api.onRailMove(it.key, 1);
        render();
      });
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'tbe-mini tbe-hide';
      hide.innerHTML = ICONS.close;
      hide.title = t('deleteLabel');
      hide.addEventListener('click', () => {
        api.onRailHide(it.key, !it.hidden);
        render();
      });
      row.append(lab, up, down, hide);
      row.classList.toggle('tbe-off', it.hidden);
      node.appendChild(row);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'pop-row';
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = t('toolbarReset');
    reset.appendChild(lab);
    reset.addEventListener('click', () => {
      api.onRailReset();
      render();
    });
    node.appendChild(reset);
  };
  render();
  return pop;
}

// Topbar settings surface: theme, language, interface scale, canvas
// prefs, formatting, toolbar palette, templates, storage usage.
export function openSettings(anchor: HTMLElement, api: SettingsApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'stp-body';
  const pop = openToolPopup(anchor, node);

  const group = (label: string) => node.appendChild(head(label));

  const radios: (HTMLButtonElement & { syncCheck?: () => void })[] = [];
  const syncAll = () => radios.forEach((b) => b.syncCheck?.());
  const radio = (label: string, checked: () => boolean, pick: () => void) => {
    const b = radioRow(label, checked, pick, syncAll);
    radios.push(b);
    node.appendChild(b);
  };
  // Toggle rows share the radio visual but flip independently.
  const toggle = (label: string, checked: () => boolean, pick: (v: boolean) => void) => {
    const b = radioRow(label, checked, () => pick(!checked()), syncAll);
    radios.push(b);
    node.appendChild(b);
  };

  group(t('setTheme'));
  radio(t('setLight'), () => api.theme() === 'light', () => api.onTheme('light'));
  radio(t('setDark'), () => api.theme() === 'dark', () => api.onTheme('dark'));

  group(t('setLanguage'));
  for (const l of LANGS) radio(l.label, () => api.lang() === l.id, () => api.onLang(l.id));

  group(t('setScale'));
  radio(t('scaleSmaller'), () => api.scale() === SCALE_STEPS[0], () => api.onScale(SCALE_STEPS[0]!));
  radio(t('scaleDefault'), () => api.scale() === SCALE_STEPS[1], () => api.onScale(SCALE_STEPS[1]!));
  radio(t('scaleLarger'), () => api.scale() === SCALE_STEPS[2], () => api.onScale(SCALE_STEPS[2]!));

  group(t('setFormat'));
  toggle(t('setBrowserLang'), api.browserLang, api.onBrowserLang);
  const curHead = head(t('setCurrency'));
  node.appendChild(curHead);
  for (const c of CURRENCIES) radio(c, () => api.currency() === c, () => api.onCurrency(c));

  group(t('setCanvas'));
  toggle(t('setNoOverlap'), () => api.flag('noOverlap'), (v) => api.onFlag('noOverlap', v));
  toggle(t('setInk'), () => api.flag('ink'), (v) => api.onFlag('ink', v));
  toggle(t('setUndoArrows'), () => api.flag('undoArrows'), (v) => api.onFlag('undoArrows', v));
  node.appendChild(head(t('setGuides')));
  radio(t('guideFull'), () => api.guideAlpha() === 1, () => api.onGuideAlpha(1));
  radio(t('guideFaint'), () => api.guideAlpha() === 0.5, () => api.onGuideAlpha(0.5));
  radio(t('guideHidden'), () => api.guideAlpha() === 0, () => api.onGuideAlpha(0));

  group(t('setOnline'));
  toggle(t('setUnfurl'), () => api.flag('unfurl'), (v) => api.onFlag('unfurl', v));

  const tbRow = document.createElement('button');
  tbRow.type = 'button';
  tbRow.className = 'pop-row';
  const tbLab = document.createElement('span');
  tbLab.className = 'pop-label';
  tbLab.textContent = t('setToolbar');
  tbRow.appendChild(tbLab);
  tbRow.addEventListener('click', () => {
    pop.close();
    openToolbarEditor(anchor, api);
  });
  node.appendChild(tbRow);

  const tplRow = document.createElement('button');
  tplRow.type = 'button';
  tplRow.className = 'pop-row';
  const tplLab = document.createElement('span');
  tplLab.className = 'pop-label';
  tplLab.textContent = t('setTemplates');
  tplRow.appendChild(tplLab);
  tplRow.addEventListener('click', () => {
    pop.close();
    api.onTemplates();
  });
  node.appendChild(tplRow);

  group(t('setStorage'));
  const meter = document.createElement('div');
  meter.className = 'stp-meter';
  meter.textContent = t('storageLoading');
  node.appendChild(meter);
  void api.storage().then(({ doc, blobs }) => {
    meter.textContent = t('storageLine').replace('{doc}', fmtBytes(doc)).replace('{media}', fmtBytes(blobs));
  });

  return pop;
}
