import type { ID } from '../state/schema';
import { t } from '../strings';
import { mountBoardIcon } from './boardicons';
import { ICONS } from './icons';

interface TopbarEvents {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  onNavigate: (id: ID) => void;
  onUnsorted: () => void;
  onView: (anchor: HTMLElement) => void;
  onExport: (anchor: HTMLElement) => void;
  onSettings: (anchor: HTMLElement) => void;
  onCrumbIcon: (id: ID, anchor: HTMLElement) => void;
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
  private zoomEl: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private events: TopbarEvents;

  constructor(root: HTMLElement, events: TopbarEvents) {
    this.events = events;
    const bar = document.createElement('div');
    bar.className = 'topbar';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = t('appName');
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'crumbs';
    this.unsortedEl = document.createElement('button');
    this.unsortedEl.type = 'button';
    this.unsortedEl.className = 'unsorted-chip';
    this.unsortedEl.addEventListener('click', () => this.events.onUnsorted());
    this.chipEl = document.createElement('span');
    this.chipEl.className = 'save-chip';
    this.chipEl.textContent = t('saved');
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'view-btn';
    exportBtn.textContent = t('exportMenu');
    exportBtn.addEventListener('click', () => this.events.onExport(exportBtn));
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'view-btn';
    viewBtn.textContent = t('viewMenu');
    viewBtn.addEventListener('click', () => this.events.onView(viewBtn));
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'view-btn gear-btn';
    gear.innerHTML = ICONS.gear;
    gear.title = t('settingsTitle');
    gear.addEventListener('click', () => this.events.onSettings(gear));
    bar.append(brand, this.titleEl, this.unsortedEl, this.chipEl, exportBtn, viewBtn, gear);

    const zoom = document.createElement('div');
    zoom.className = 'zoombar';
    this.undoBtn = document.createElement('button');
    this.undoBtn.className = 'zb-ur';
    this.undoBtn.innerHTML = ICONS.undo;
    this.undoBtn.title = t('drawUndo');
    this.undoBtn.addEventListener('click', events.onUndo);
    this.redoBtn = document.createElement('button');
    this.redoBtn.className = 'zb-ur';
    this.redoBtn.innerHTML = ICONS.redo;
    this.redoBtn.title = t('drawRedo');
    this.redoBtn.addEventListener('click', events.onRedo);
    zoom.append(this.undoBtn, this.redoBtn);
    const out = document.createElement('button');
    out.textContent = '\u2212';
    out.addEventListener('click', events.onZoomOut);
    this.zoomEl = document.createElement('button');
    this.zoomEl.className = 'zoom-pct';
    this.zoomEl.addEventListener('click', events.onReset);
    const inBtn = document.createElement('button');
    inBtn.textContent = '+';
    inBtn.addEventListener('click', events.onZoomIn);
    const fit = document.createElement('button');
    fit.textContent = t('zoomFit');
    fit.addEventListener('click', events.onFit);
    zoom.append(out, this.zoomEl, inBtn, fit);

    root.append(bar, zoom);
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
        ic.title = t('toolIcon');
        ic.addEventListener('click', (e) => {
          e.stopPropagation();
          this.events.onCrumbIcon(c.id, ic);
        });
        el.appendChild(ic);
      }
      const txt = document.createElement('span');
      txt.textContent = c.title;
      el.appendChild(txt);
      if (!last) el.addEventListener('click', () => this.events.onNavigate(c.id));
      this.titleEl.appendChild(el);
    });
  }

  setUnsorted(n: number) {
    this.unsortedEl.textContent = `${n} ${t('unsortedTitle')}`;
  }

  setSaveState(state: 'saving' | 'saved') {
    this.chipEl.textContent = state === 'saving' ? t('saving') : t('saved');
    this.chipEl.classList.toggle('saving', state === 'saving');
  }

  setZoom(z: number) {
    this.zoomEl.textContent = `${Math.round(z * 100)}%`;
  }
}
