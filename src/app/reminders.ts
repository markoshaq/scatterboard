import type { App } from '../app';
import type { Doc } from '../state/schema';
import { t } from '../strings';
import { collectDue, type DueItem } from '../ui/duepanel';
import { hint } from '../ui/toast';

const DAY_REMINDER_HOUR = 9;
const TICK_MS = 60000;

export function dueToFire(source: DueItem[] | Doc, fired: Set<string>, now = Date.now()): DueItem[] {
  const items = Array.isArray(source) ? source : collectDue(source);
  const out: DueItem[] = [];
  for (const d of items) {
    const key = `${d.elId}:${d.itemId}:${d.dueAt}`;
    if (fired.has(key)) continue;
    // Untimed dues fire at 9am local on their day; setHours also
    // normalises legacy entries stored as 9:00 exactly.
    const fireAt = d.dueTime ? d.dueAt : new Date(d.dueAt).setHours(DAY_REMINDER_HOUR, 0, 0, 0);
    if (fireAt <= now) {
      fired.add(key);
      out.push(d);
    }
  }
  return out;
}

export class Reminders {
  private fired = new Set<string>();
  private timer: number | null = null;

  constructor(private a: App) {}

  init() {
    this.dispose();
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  dispose() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick() {
    if (this.a.prefs.reminders !== true) return;
    if (this.a.store.inGroup) return;
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('do')) return;
    const due = dueToFire(this.a.doc, this.fired, Date.now());
    if (!due.length) return;
    const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (due.length > 3) {
      const msg = t('remDueMany').replace('{n}', String(due.length));
      if (canNotify) {
        try {
          const n = new Notification(msg);
          n.onclick = () => {
            window.focus();
            this.a.panels.openDue();
          };
          return;
        } catch {
          // Fall back to in-app hint.
        }
      }
      hint(msg, undefined, () => this.a.panels.openDue());
      return;
    }
    for (const d of due) {
      const label = d.text || t('todoItemPlaceholder');
      const msg = t('remDueSingle').replace('{text}', label);
      if (canNotify) {
        try {
          const n = new Notification(msg, { body: d.boardTitle || t('untitled') });
          n.onclick = () => {
            window.focus();
            this.a.jumpToDue(d);
          };
          continue;
        } catch {
          // Fall back to in-app hint.
        }
      }
      hint(msg, undefined, () => this.a.jumpToDue(d));
    }
  }
}
