import type { ID } from '../state/schema';
import { t } from '../strings';
import { mountBoardIcon } from './boardicons';
import { ICONS } from './icons';
import { haspopup } from './popup';
import { tip } from './tip';

interface TopbarEvents {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  onNavigate: (id: ID) => void;
  onUnsorted: () => void;
  onDue: () => void;
  onView: (anchor: HTMLElement) => void;
  onHelp: (anchor: HTMLElement) => void;
  onExport: (anchor: HTMLElement) => void;
  onSettings: (anchor: HTMLElement) => void;
  onAgent: (anchor: HTMLElement) => void;
  onMore: (anchor: HTMLElement) => void;
  onCrumbIcon: (id: ID, anchor: HTMLElement) => void;
  onCrumbBoards?: (id: ID, anchor: HTMLElement) => void;
  onCrumbRename?: (id: ID, title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export interface Crumb {
  id: ID;
  title: string;
  icon?: string;
}

export class Topbar {
  private titleEl: HTMLElement;
  private chipEl: HTMLElement;
  private unsortedEl: HTMLButtonElement;
  private dueEl: HTMLButtonElement;
  private zoomEl: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private events: TopbarEvents;
  private savedTimer: number | null = null;
  private crumbsSig = '';
  private lastUnsorted = -1;

  constructor(root: HTMLElement, events: TopbarEvents) {
    this.events = events;
    const bar = document.createElement('div');
    bar.className = 'topbar';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = t('appName');
    const brandSep = document.createElement('span');
    brandSep.className = 'crumb-sep';
    brandSep.textContent = '/';
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'crumbs';
    this.unsortedEl = document.createElement('button');
    this.unsortedEl.type = 'button';
    this.unsortedEl.className = 'unsorted-chip';
    const unsIc = document.createElement('span');
    unsIc.className = 'unsorted-ic';
    unsIc.innerHTML = ICONS.inbox;
    this.unsortedEl.append(unsIc, document.createElement('span'));
    haspopup(this.unsortedEl, 'dialog');
    this.unsortedEl.addEventListener('click', () => this.events.onUnsorted());
    this.dueEl = document.createElement('button');
    this.dueEl.type = 'button';
    this.dueEl.className = 'due-chip';
    this.dueEl.style.display = 'none';
    const dueIc = document.createElement('span');
    dueIc.className = 'unsorted-ic';
    dueIc.innerHTML = ICONS.txDue;
    this.dueEl.append(dueIc, document.createElement('span'));
    haspopup(this.dueEl, 'dialog');
    this.dueEl.addEventListener('click', () => this.events.onDue());
    this.chipEl = document.createElement('span');
    this.chipEl.className = 'save-chip';
    this.chipEl.textContent = t('saved');
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'view-btn';
    exportBtn.textContent = t('exportMenu');
    haspopup(exportBtn, 'menu');
    exportBtn.addEventListener('click', () => this.events.onExport(exportBtn));
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'view-btn';
    viewBtn.textContent = t('viewMenu');
    haspopup(viewBtn, 'menu');
    viewBtn.addEventListener('click', () => this.events.onView(viewBtn));
    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'view-btn gear-btn';
    helpBtn.innerHTML = ICONS.help;
    tip(helpBtn, t('helpTitle'));
    haspopup(helpBtn, 'menu');
    helpBtn.addEventListener('click', () => this.events.onHelp(helpBtn));
    const agentBtn = document.createElement('button');
    agentBtn.type = 'button';
    agentBtn.className = 'view-btn gear-btn';
    agentBtn.innerHTML = ICONS.bot;
    tip(agentBtn, t('setAgent'));
    haspopup(agentBtn, 'dialog');
    agentBtn.addEventListener('click', () => this.events.onAgent(agentBtn));
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'view-btn gear-btn';
    gear.innerHTML = ICONS.gear;
    tip(gear, t('settingsTitle'));
    haspopup(gear, 'dialog');
    gear.addEventListener('click', () => this.events.onSettings(gear));
    // Phone shell: the five trailing controls collapse into one
    // overflow button; .more-btn stays hidden at desktop widths.
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'view-btn gear-btn more-btn';
    moreBtn.innerHTML = ICONS.more;
    tip(moreBtn, t('moreMenu'));
    haspopup(moreBtn, 'menu');
    moreBtn.addEventListener('click', () => this.events.onMore(moreBtn));
    bar.append(brand, brandSep, this.titleEl, this.unsortedEl, this.dueEl, exportBtn, viewBtn, helpBtn, agentBtn, gear, moreBtn);

    const zoom = document.createElement('div');
    zoom.className = 'zoombar';
    this.undoBtn = document.createElement('button');
    this.undoBtn.className = 'zb-ur';
    this.undoBtn.innerHTML = ICONS.undo;
    tip(this.undoBtn, t('drawUndo'));
    this.undoBtn.addEventListener('click', events.onUndo);
    this.redoBtn = document.createElement('button');
    this.redoBtn.className = 'zb-ur';
    this.redoBtn.innerHTML = ICONS.redo;
    tip(this.redoBtn, t('drawRedo'));
    this.redoBtn.addEventListener('click', events.onRedo);
    zoom.append(this.undoBtn, this.redoBtn);
    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = '\u2212';
    tip(out, t('zoomOut'));
    out.addEventListener('click', events.onZoomOut);
    this.zoomEl = document.createElement('button');
    this.zoomEl.type = 'button';
    this.zoomEl.className = 'zoom-pct';
    tip(this.zoomEl, t('zoomReset'));
    this.zoomEl.addEventListener('click', () => events.onZoomReset());
    const inBtn = document.createElement('button');
    inBtn.type = 'button';
    inBtn.textContent = '+';
    tip(inBtn, t('zoomIn'));
    inBtn.addEventListener('click', events.onZoomIn);
    const fit = document.createElement('button');
    fit.type = 'button';
    fit.textContent = t('zoomFit');
    tip(fit, t('fitBoard'));
    fit.addEventListener('click', events.onFit);
    zoom.append(out, this.zoomEl, inBtn, fit);

    root.append(bar, zoom, this.chipEl);
    this.setUndoArrows(false, false, false);
  }

  // Pref-driven undo/redo arrows beside the zoom controls.
  setUndoArrows(show: boolean, canUndo: boolean, canRedo: boolean) {
    this.undoBtn.style.display = show ? '' : 'none';
    this.redoBtn.style.display = show ? '' : 'none';
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  setCrumbs(crumbs: Crumb[]) {
    const sig = crumbs.map((c) => `${c.id}|${c.title.length}|${c.title}|${c.icon ?? ''}`).join(';');
    if (sig === this.crumbsSig) return;
    this.crumbsSig = sig;
    this.titleEl.textContent = '';
    crumbs.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        this.titleEl.appendChild(sep);
      }
      const el = document.createElement('span');
      const last = i === crumbs.length - 1;
      el.className = last ? 'crumb cur' : 'crumb';
      if (c.icon !== undefined) {
        const ic = document.createElement('span');
        ic.className = 'crumb-ic';
        mountBoardIcon(ic, c.icon, c.title);
        ic.title = t('toolIcon');        ic.setAttribute('role', 'button');
        ic.setAttribute('aria-label', t('toolIcon'));
        ic.addEventListener('click', (e) => {
          e.stopPropagation();
          this.events.onCrumbIcon(c.id, ic);
        });
        el.appendChild(ic);
      }
      const txt = document.createElement('span');
      txt.textContent = c.title;
      if (last) {
        txt.addEventListener('click', () => this.events.onCrumbBoards?.(c.id, el));
        // Double-click the current board's name renames it inline; the
        // single click still opens the boards panel.
        txt.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          if (!this.events.onCrumbRename) return;
          const input = document.createElement('input');
          input.className = 'crumb-rename';
          input.value = c.title;
          txt.replaceWith(input);
          input.focus();
          input.select();
          let done = false;
          const finish = (commit: boolean) => {
            if (done) return;
            done = true;
            const v = input.value.trim();
            if (commit && v && v !== c.title) {
              this.events.onCrumbRename!(c.id, v);
              return; // the store change re-renders the crumbs
            }
            input.replaceWith(txt);
          };
          input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') finish(true);
            if (ev.key === 'Escape') finish(false);
          });
          input.addEventListener('blur', () => finish(input.isConnected));
          input.addEventListener('click', (ev) => ev.stopPropagation());
        });
      }
      el.appendChild(txt);
      if (!last) el.addEventListener('click', () => this.events.onNavigate(c.id));
      this.titleEl.appendChild(el);
    });
  }

  setUnsorted(n: number) {
    if (n === this.lastUnsorted) return;
    this.lastUnsorted = n;
    this.unsortedEl.lastElementChild!.textContent = `${n} ${t('unsortedTitle')}`;
  }

  private lastDue = 0;

  // Due chip: hidden while nothing is overdue or due today.
  setDue(n: number) {
    if (n === this.lastDue) return;
    this.lastDue = n;
    this.dueEl.style.display = n ? '' : 'none';
    this.dueEl.lastElementChild!.textContent = `${n} ${t('dueTitle')}`;
  }

  // Save chip pops bottom-left while a save runs, flashes 'Saved' and
  // fades back out shortly after.
  setSaveState(state: 'saving' | 'saved') {
    this.chipEl.textContent = state === 'saving' ? t('saving') : t('saved');
    this.chipEl.classList.toggle('saving', state === 'saving');
    this.chipEl.classList.add('show');
    if (this.savedTimer !== null) window.clearTimeout(this.savedTimer);
    this.savedTimer = null;
    if (state === 'saved') {
      this.savedTimer = window.setTimeout(() => {
        this.chipEl.classList.remove('show');
        this.savedTimer = null;
      }, 1600);
    }
  }

  setZoom(z: number) {
    const s = `${Math.round(z * 100)}%`;
    if (this.zoomEl.textContent !== s) this.zoomEl.textContent = s;
  }
}
