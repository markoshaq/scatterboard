import { uid, type RecurRule, type TodoItem } from './schema';

function stepOnce(ts: number, rule: RecurRule): number {
  const d = new Date(ts);
  const n = Number.isFinite(rule.n) ? Math.max(1, Math.floor(rule.n)) : 1;
  const h = d.getHours();
  const min = d.getMinutes();
  const s = d.getSeconds();
  const ms = d.getMilliseconds();
  switch (rule.f) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, min, s, ms).getTime();
    case 'week':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7, h, min, s, ms).getTime();
    case 'month': {
      const total = d.getFullYear() * 12 + d.getMonth() + n;
      const y = Math.floor(total / 12);
      const m = total % 12;
      const maxDay = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(d.getDate(), maxDay), h, min, s, ms).getTime();
    }
    case 'year': {
      const y = d.getFullYear() + n;
      const m = d.getMonth();
      const maxDay = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(d.getDate(), maxDay), h, min, s, ms).getTime();
    }
    default:
      // Persisted docs are not re-validated on load; an unrecognized
      // frequency degrades to a daily step rather than a dead item.
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, min, s, ms).getTime();
  }
}

export function nextOccurrence(dueAt: number, rule: RecurRule, now = Date.now()): number {
  let next = stepOnce(dueAt, rule);
  // A corrupt rule or dueAt can overflow the Date range or demand an
  // absurd step count; a NaN would poison every due sort it touches, so
  // an uncomputable next falls back to the current dueAt.
  for (let i = 0; i < 500_000 && next <= now && Number.isFinite(next); i++) {
    next = stepOnce(next, rule);
  }
  return Number.isFinite(next) && next > now ? next : dueAt;
}

export function doneWithRecur(items: TodoItem[], iid: string, now = Date.now()): TodoItem[] {
  const idx = items.findIndex((i) => i.id === iid);
  if (idx < 0) return items;
  const item = items[idx]!;
  if (item.done) {
    return items.map((i, k) => (k === idx ? { ...i, done: false } : i));
  }
  const out = items.map((i, k) => (k === idx ? { ...i, done: true } : i));
  if (item.recur && item.dueAt !== undefined) {
    // A check -> uncheck -> re-check cycle must not stack successors:
    // while a spawn of this item survives anywhere in the list, the
    // series already continues.
    if (items.some((i) => i.spawned === item.id)) return out;
    const next: TodoItem = {
      id: uid(),
      text: item.text,
      done: false,
      dueAt: nextOccurrence(item.dueAt, item.recur, now),
      ...(item.dueTime ? { dueTime: true } : {}),
      ...(item.assignee ? { assignee: item.assignee } : {}),
      ...(item.reactions ? { reactions: [...item.reactions] } : {}),
      recur: { ...item.recur },
      spawned: item.id,
    };
    out.splice(idx + 1, 0, next);
  }
  return out;
}
