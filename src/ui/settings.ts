import type { Currency, Lang } from '../persist/storage';
import { LANGS, t } from '../strings';
import { fmtSize } from './files';
import { ICONS } from './icons';
import { haspopup, openToolPopup, type ToolPopup } from './popup';
import { isIos, inStandalone } from './install';

interface SettingsApi {
  // 'system' = no saved pref, follows prefers-color-scheme.
  theme(): 'light' | 'dark' | 'system';
  onTheme(mode: 'light' | 'dark' | 'system'): void;
  scale(): number;
  onScale(s: number): void;
  // null = no saved pref, follows the browser's language list.
  lang(): Lang | null;
  onLang(l: Lang | null): void;
  browserLang(): boolean;
  onBrowserLang(v: boolean): void;
  currency(): Currency | null;
  onCurrency(c: Currency | null): void;
  flag(key: 'noOverlap' | 'ink' | 'undoArrows' | 'autoEdit' | 'unfurl' | 'agent'): boolean;
  onFlag(key: 'noOverlap' | 'ink' | 'undoArrows' | 'autoEdit' | 'unfurl' | 'agent', v: boolean): void;
  // Whether the agent bridge socket is live right now.
  agentStatus(): boolean;
  // Stored bridge credentials exist (paired via an ?agent= link once).
  agentPaired(): boolean;
  // Alignment-guide opacity: 1 full, 0.5 faint, 0 hidden.
  guideAlpha(): number;
  onGuideAlpha(v: number): void;
  onTemplates(): void;
  onReset(): void;
  // Toolbar palette editor: ordered keys with hidden flags, moves and
  // a reset back to the default order.
  railItems(): { key: string; label: string; hidden: boolean }[];
  onRailMove(key: string, dir: -1 | 1): void;
  onRailHide(key: string, hidden: boolean): void;
  onRailReset(): void;
}

export const SCALE_STEPS = [0.85, 1, 1.15];
const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];

// The agent bridge socket lives in the lazy agent chunk; it posts this
// event on connect/drop so an open settings popup can refresh the
// status row without importing the chunk.
let agentStatusRow: HTMLElement | null = null;
let agentStatusSync: (() => void) | null = null;
window.addEventListener('sb-agent-status', () => {
  if (agentStatusRow && !agentStatusRow.isConnected) {
    agentStatusRow = null;
    agentStatusSync = null;
  }
  agentStatusSync?.();
});

function head(label: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'ts-head';
  h.textContent = label;
  return h;
}

// Topbar agent menu (robot icon): the local-agent status row and its
// setup hint live here, away from the general settings list.
interface AgentMenuApi {
  flag(key: 'agent'): boolean;
  onFlag(key: 'agent', v: boolean): void;
  agentStatus(): boolean;
  agentPaired(): boolean;
}

export function openAgentPopup(anchor: HTMLElement, api: AgentMenuApi): ToolPopup {
  haspopup(anchor, 'dialog');
  const node = document.createElement('div');
  node.className = 'stp-body';
  const pop = openToolPopup(anchor, node, true);
  // Drop the module-level agent status refs when the popup closes so a
  // detached row and its api closure are not retained.
  const innerClose = pop.close;
  pop.close = () => {
    agentStatusRow = null;
    agentStatusSync = null;
    innerClose();
  };
  // Local agent status row. Pairing only happens through an ?agent=
  // link; this row reports the socket state and offers connect/
  // disconnect once bridge credentials are stored.
  agentStatusRow = document.createElement('div');
  agentStatusRow.className = 'agent-row';
  const agentSetup = document.createElement('div');
  const agentHow = document.createElement('div');
  agentHow.className = 'ts-head agent-how';
  agentHow.textContent = t('agentHow');
  const agentPrompt = document.createElement('button');
  agentPrompt.type = 'button';
  agentPrompt.className = 'agent-prompt';
  const promptText = document.createElement('span');
  promptText.className = 'agent-prompt-text';
  promptText.textContent = t('agentSetupPrompt');
  const promptIcon = document.createElement('span');
  promptIcon.className = 'agent-prompt-icon';
  promptIcon.innerHTML = ICONS.copy;
  agentPrompt.append(promptText, promptIcon);
  agentPrompt.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(t('agentSetupPrompt'))
      .then(() => {
        promptIcon.innerHTML = ICONS.check;
        setTimeout(() => (promptIcon.innerHTML = ICONS.copy), 1500);
      })
      .catch(() => {});
  });
  agentSetup.append(agentHow, agentPrompt);
  const syncAgent = () => {
    const paired = api.agentPaired();
    const enabled = api.flag('agent');
    const on = api.agentStatus();
    agentStatusRow!.textContent = '';
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = t('setAgent');
    const dot = document.createElement('span');
    dot.className = `agent-dot ${on ? 'on' : enabled ? 'wait' : 'off'}`;
    const state = document.createElement('span');
    state.className = 'agent-state';
    state.textContent = on
      ? t('agentStatusOn')
      : enabled
        ? t('agentWaiting')
        : paired
          ? t('agentPaired')
          : t('agentOff');
    agentStatusRow!.append(lab, dot, state);
    if (on || enabled || paired) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'agent-btn';
      btn.textContent = on ? t('agentDisconnect') : enabled ? t('agentTurnOff') : t('agentPairConnect');
      btn.addEventListener('click', () => {
        api.onFlag('agent', !enabled);
        syncAgent();
      });
      agentStatusRow!.appendChild(btn);
    }
    agentSetup.style.display = paired ? 'none' : '';
  };
  agentStatusSync = syncAgent;
  syncAgent();
  node.append(agentStatusRow, agentSetup);
  return pop;
}

// Create-palette editor: reorder with up/down arrows, hide per row,
// Reset restores the default order. One row per create type.
function openToolbarEditor(anchor: HTMLElement, api: SettingsApi) {
  haspopup(anchor, 'dialog');
  const node = document.createElement('div');
  node.className = 'menu-body tbe-body';
  const pop = openToolPopup(anchor, node, true);

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
      up.title = t('moveUp');
      up.setAttribute('aria-label', t('moveUp'));
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        api.onRailMove(it.key, -1);
        render();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'tbe-mini';
      down.textContent = '↓';
      down.title = t('moveDown');
      down.setAttribute('aria-label', t('moveDown'));
      down.disabled = i === items.length - 1;
      down.addEventListener('click', () => {
        api.onRailMove(it.key, 1);
        render();
      });
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'tbe-mini tbe-hide';
      hide.innerHTML = ICONS.close;
      const hideLbl = it.hidden ? t('toolShow') : t('toolHide');
      hide.title = hideLbl;      hide.setAttribute('aria-label', hideLbl);
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
  haspopup(anchor, 'dialog');
  const node = document.createElement('div');
  node.className = 'stp-body';
  const pop = openToolPopup(anchor, node, true);

  const headRow = document.createElement('div');
  headRow.className = 'stp-head';
  const headTitle = document.createElement('span');
  headTitle.className = 'sp-title';
  headTitle.textContent = t('settingsTitle');
  const headClose = document.createElement('button');
  headClose.type = 'button';
  headClose.className = 'sp-close';
  headClose.innerHTML = ICONS.close;
  headClose.setAttribute('aria-label', t('close'));
  headClose.addEventListener('click', () => pop.close());
  headRow.append(headTitle, headClose);
  node.appendChild(headRow);

  const group = (label: string) => node.appendChild(head(label));

  const radios: (HTMLButtonElement & { syncCheck?: () => void })[] = [];
  const syncAll = () =>
    radios.forEach((b) => {
      b.syncCheck?.();
    });
  // Toggle rows lead with a checkbox square: the trailing check is
  // reserved for single-choice radios so the two read differently.
  const toggle = (label: string, checked: () => boolean, pick: (v: boolean) => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pop-row';
    b.setAttribute('role', 'checkbox');
    const box = document.createElement('span');
    box.className = 'set-box';
    box.innerHTML = ICONS.check;
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = label;
    b.append(box, lab);
    const sync = () => {
      const on = checked();
      box.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    };
    sync();
    b.addEventListener('click', () => {
      pick(!checked());
      syncAll();
    });
    (b as HTMLButtonElement & { syncCheck?: () => void }).syncCheck = sync;
    radios.push(b as HTMLButtonElement & { syncCheck?: () => void });
    node.appendChild(b);
  };
  // Segmented row: one line for a small single-choice set.
  const seg = (options: { label: string; on: () => boolean; pick: () => void }[], label: string) => {
    const row = document.createElement('div');
    row.className = 'seg';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', label);
    const btns: [HTMLButtonElement, (typeof options)[number]][] = options.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.setAttribute('role', 'radio');
      b.textContent = o.label;
      b.addEventListener('click', () => {
        o.pick();
        sync();
      });
      row.appendChild(b);
      return [b, o];
    });
    const sync = () => {
      for (const [b, o] of btns) {
        const on = o.on();
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
    };
    sync();
    node.appendChild(row);
  };

  group(t('setTheme'));
  seg([
    { label: t('setSystem'), on: () => api.theme() === 'system', pick: () => api.onTheme('system') },
    { label: t('setLight'), on: () => api.theme() === 'light', pick: () => api.onTheme('light') },
    { label: t('setDark'), on: () => api.theme() === 'dark', pick: () => api.onTheme('dark') },
  ], t('setTheme'));

  group(t('setLanguage'));
  const langWrap = document.createElement('div');
  langWrap.className = 'set-select';
  const langSel = document.createElement('select');
  const opt = (value: string, label: string) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    langSel.appendChild(o);
  };
  opt('', t('setAuto'));
  for (const l of LANGS) opt(l.id, l.label);
  langSel.value = api.lang() ?? '';
  langSel.addEventListener('change', () =>
    api.onLang(langSel.value === '' ? null : (langSel.value as Lang)),
  );
  const langChev = document.createElement('span');
  langChev.className = 'set-chev';
  langChev.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  langWrap.append(langSel, langChev);
  node.appendChild(langWrap);

  group(t('setScale'));
  seg([
    { label: t('scaleSmaller'), on: () => api.scale() === SCALE_STEPS[0], pick: () => api.onScale(SCALE_STEPS[0]!) },
    { label: t('scaleDefault'), on: () => api.scale() === SCALE_STEPS[1], pick: () => api.onScale(SCALE_STEPS[1]!) },
    { label: t('scaleLarger'), on: () => api.scale() === SCALE_STEPS[2], pick: () => api.onScale(SCALE_STEPS[2]!) },
  ], t('setScale'));

  group(t('setFormat'));
  toggle(t('setBrowserLang'), api.browserLang, api.onBrowserLang);
  node.appendChild(head(t('setCurrency')));
  seg([
    { label: t('setAuto'), on: () => api.currency() === null, pick: () => api.onCurrency(null) },
    ...CURRENCIES.map((c) => ({ label: c, on: () => api.currency() === c, pick: () => api.onCurrency(c) })),
  ], t('setCurrency'));

  group(t('setCanvas'));
  toggle(t('setNoOverlap'), () => api.flag('noOverlap'), (v) => api.onFlag('noOverlap', v));
  toggle(t('setInk'), () => api.flag('ink'), (v) => api.onFlag('ink', v));
  toggle(t('setUndoArrows'), () => api.flag('undoArrows'), (v) => api.onFlag('undoArrows', v));
  toggle(t('setAutoEdit'), () => api.flag('autoEdit'), (v) => api.onFlag('autoEdit', v));
  node.appendChild(head(t('setGuides')));
  seg([
    { label: t('guideFull'), on: () => api.guideAlpha() === 1, pick: () => api.onGuideAlpha(1) },
    { label: t('guideFaint'), on: () => api.guideAlpha() === 0.5, pick: () => api.onGuideAlpha(0.5) },
    { label: t('guideHidden'), on: () => api.guideAlpha() === 0, pick: () => api.onGuideAlpha(0) },
  ], t('setGuides'));

  group(t('setOnline'));
  toggle(t('setUnfurl'), () => api.flag('unfurl'), (v) => api.onFlag('unfurl', v));
  const unfurlHow = document.createElement('div');
  unfurlHow.className = 'ts-head agent-how';
  unfurlHow.textContent = t('unfurlHow');
  node.appendChild(unfurlHow);

  // Actions sit apart from the option groups, separated so they do not
  // read as more toggle rows.
  const sep = document.createElement('div');
  sep.className = 'pop-sep';
  node.appendChild(sep);

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

  const resetRow = document.createElement('button');
  resetRow.type = 'button';
  resetRow.className = 'pop-row stp-danger';
  const resetLab = document.createElement('span');
  resetLab.className = 'pop-label';
  resetLab.textContent = t('setReset');
  resetRow.appendChild(resetLab);
  resetRow.addEventListener('click', () => {
    pop.close();
    api.onReset();
  });
  node.appendChild(resetRow);

  return pop;
}

// Help > About: version, storage usage and the source link.
export function openAboutPopup(
  anchor: HTMLElement,
  api: { storage(): Promise<{ doc: number; blobs: number; persisted: boolean }> },
): ToolPopup {
  const node = document.createElement('div');
  node.className = 'stp-body';
  const title = document.createElement('div');
  title.className = 'about-title';
  const name = document.createElement('span');
  name.textContent = t('appName');
  const ver = document.createElement('span');
  ver.className = 'about-ver';
  ver.textContent = `v${__APP_VERSION__}`;
  title.append(name, ver);
  node.appendChild(title);
  node.appendChild(head(t('setStorage')));
  const meter = document.createElement('div');
  meter.className = 'stp-meter';
  meter.textContent = t('storageLoading');
  node.appendChild(meter);
  void api
    .storage()
    .then(({ doc, blobs, persisted }) => {
      if (meter.isConnected) {
        meter.textContent = `${t('storageLine').replace('{doc}', fmtSize(doc)).replace('{media}', fmtSize(blobs))} (${t(persisted ? 'persistYes' : 'persistNo')})`;
      }
    })
    .catch(() => {
      meter.textContent = '';
    });
  const ghRow = document.createElement('button');
  ghRow.type = 'button';
  ghRow.className = 'pop-row';
  const ghIc = document.createElement('span');
  ghIc.className = 'pop-icon';
  ghIc.innerHTML = ICONS.ext;
  const ghLab = document.createElement('span');
  ghLab.className = 'pop-label';
  ghLab.textContent = t('aboutSource');
  ghRow.append(ghIc, ghLab);
  ghRow.addEventListener('click', () =>
    window.open('https://github.com/markoshaq/scatterboard', '_blank', 'noopener'),
  );
  node.appendChild(ghRow);
  // iOS never fires beforeinstallprompt: the only install path is the
  // Share menu, so spell it out where users look for it.
  if (isIos() && !inStandalone()) {
    const hint = document.createElement('div');
    hint.className = 'about-install';
    hint.textContent = t('installIosHint');
    node.appendChild(hint);
  }
  haspopup(anchor, 'dialog');
  return openToolPopup(anchor, node, true);
}
