import { describe, expect, it } from 'vitest';
import { dueToFire } from '../src/app/reminders';
import { shouldNag } from '../src/app/syncdir';
import { createBoard, createTodo, emptyDoc } from '../src/state/schema';

describe('due reminders and backup nudge', () => {
  it('dueToFire respects +9h day-only rule, dedup, and trash exclusion', () => {
    const doc = emptyDoc();
    const b = createBoard({ id: 'b1', title: 'Main' });
    doc.boards[b.id] = b;

    const midnight = new Date(2026, 5, 10, 0, 0).getTime();
    const nineAm = midnight + 9 * 3600000;
    const timedAt = new Date(2026, 5, 10, 8, 0).getTime();

    const todo = createTodo(doc, b.id, 0, 0);
    todo.content = {
      todo: {
        title: '',
        showTitle: false,
        items: [
          { id: 'dayOnly', text: 'Day task', done: false, dueAt: midnight },
          { id: 'timed', text: 'Morning call', done: false, dueAt: timedAt, dueTime: true },
          { id: 'doneItem', text: 'Done task', done: true, dueAt: timedAt, dueTime: true },
        ],
      },
    };
    doc.elements[todo.id] = todo;

    const trashed = createTodo(doc, b.id, 0, 0);
    trashed.content = {
      todo: {
        title: '',
        showTitle: false,
        items: [{ id: 'trashedItem', text: 'In trash', done: false, dueAt: timedAt, dueTime: true }],
      },
    };
    doc.trash[trashed.id] = { el: trashed, deletedAt: timedAt };

    const fired = new Set<string>();

    // At 8:30am: timed item fires, day-only item waits for 9:00am, trashed/done ignored.
    const batch1 = dueToFire(doc, fired, timedAt + 1800000);
    expect(batch1.map((d) => d.itemId)).toEqual(['timed']);

    // Re-running at 8:30am does not re-fire the timed item.
    expect(dueToFire(doc, fired, timedAt + 1800000)).toEqual([]);

    // At 9:00am: day-only item fires.
    const batch2 = dueToFire(doc, fired, nineAm);
    expect(batch2.map((d) => d.itemId)).toEqual(['dayOnly']);
  });

  it('shouldNag gates on folder handle, element presence, export age, and snooze age', () => {
    const day = 86400000;
    const now = 100 * day;

    expect(shouldNag(now, undefined, undefined, false, true)).toBe(true);
    expect(shouldNag(now, undefined, undefined, true, true)).toBe(false);
    expect(shouldNag(now, undefined, undefined, false, false)).toBe(false);
    expect(shouldNag(now, now - 5 * day, undefined, false, true)).toBe(false);
    expect(shouldNag(now, now - 15 * day, now - 3 * day, false, true)).toBe(false);
    expect(shouldNag(now, now - 15 * day, now - 8 * day, false, true)).toBe(true);
  });
});
