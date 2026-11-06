import { describe, expect, it } from 'vitest';
import { doneWithRecur, nextOccurrence } from '../src/state/recur';
import { saneContent, type TodoItem } from '../src/state/schema';

describe('recurring to-dos', () => {
  it('advances daily, weekly, monthly, and yearly', () => {
    const base = new Date(2026, 2, 10, 9, 30).getTime();
    const now = new Date(2026, 2, 10, 10, 0).getTime();

    expect(nextOccurrence(base, { f: 'day', n: 1 }, now)).toBe(new Date(2026, 2, 11, 9, 30).getTime());
    expect(nextOccurrence(base, { f: 'day', n: 3 }, now)).toBe(new Date(2026, 2, 13, 9, 30).getTime());
    expect(nextOccurrence(base, { f: 'week', n: 1 }, now)).toBe(new Date(2026, 2, 17, 9, 30).getTime());
    expect(nextOccurrence(base, { f: 'week', n: 2 }, now)).toBe(new Date(2026, 2, 24, 9, 30).getTime());
    expect(nextOccurrence(base, { f: 'month', n: 1 }, now)).toBe(new Date(2026, 3, 10, 9, 30).getTime());
    expect(nextOccurrence(base, { f: 'year', n: 1 }, now)).toBe(new Date(2027, 2, 10, 9, 30).getTime());
  });

  it('skips missed occurrences until strictly after now', () => {
    const dueAt = new Date(2026, 0, 1, 9, 0).getTime();
    const now = new Date(2026, 0, 4, 9, 0).getTime();
    expect(nextOccurrence(dueAt, { f: 'day', n: 1 }, now)).toBe(new Date(2026, 0, 5, 9, 0).getTime());
  });

  it('clamps month-end and leap-day dates without drift', () => {
    const jan31 = new Date(2026, 0, 31, 12, 0).getTime();
    const feb28 = new Date(2026, 1, 28, 12, 0).getTime();
    const mar28 = new Date(2026, 2, 28, 12, 0).getTime();

    const first = nextOccurrence(jan31, { f: 'month', n: 1 }, jan31);
    expect(first).toBe(feb28);
    const second = nextOccurrence(first, { f: 'month', n: 1 }, feb28);
    expect(second).toBe(mar28);

    const leap = new Date(2024, 1, 29, 8, 0).getTime();
    expect(nextOccurrence(leap, { f: 'year', n: 1 }, leap)).toBe(new Date(2025, 1, 28, 8, 0).getTime());
  });

  it('doneWithRecur completes the item and splices a successor right after it', () => {
    const dueAt = new Date(2026, 4, 1, 14, 0).getTime();
    const now = new Date(2026, 4, 1, 15, 0).getTime();
    const items: TodoItem[] = [
      { id: 'a', text: 'First', done: false },
      {
        id: 'b',
        text: 'Pay rent',
        done: false,
        dueAt,
        dueTime: true,
        assignee: 'self',
        recur: { f: 'month', n: 1 },
        reactions: ['👍'],
      },
      { id: 'c', text: 'Last', done: false },
    ];

    const out = doneWithRecur(items, 'b', now);
    expect(out).toHaveLength(4);
    expect(out[1]!.id).toBe('b');
    expect(out[1]!.done).toBe(true);
    const succ = out[2]!;
    expect(succ.id).not.toBe('b');
    expect(succ.text).toBe('Pay rent');
    expect(succ.done).toBe(false);
    expect(succ.dueAt).toBe(new Date(2026, 5, 1, 14, 0).getTime());
    expect(succ.dueTime).toBe(true);
    expect(succ.assignee).toBe('self');
    expect(succ.recur).toEqual({ f: 'month', n: 1 });
    expect(succ.reactions).toEqual(['👍']);
    expect(succ.spawned).toBe('b');
    expect(out[3]!.id).toBe('c');

    // Unchecking a completed item does not spawn another successor
    const unchecked = doneWithRecur(out, 'b', now);
    expect(unchecked).toHaveLength(4);
    expect(unchecked[1]!.done).toBe(false);

    // ...and re-checking it keeps the original spawn instead of
    // stacking a second occurrence.
    const rechecked = doneWithRecur(unchecked, 'b', now);
    expect(rechecked).toHaveLength(4);
    expect(rechecked[1]!.done).toBe(true);
    expect(rechecked.filter((i) => i.spawned === 'b')).toHaveLength(1);
  });

  it('validates recur rules in saneContent', () => {
    const valid = {
      todo: {
        title: '',
        showTitle: false,
        items: [{ id: '1', text: 'x', done: false, dueAt: 1000, recur: { f: 'week', n: 2 } }],
      },
    };
    expect(saneContent(valid, 'todo')).toBe(true);

    const badFreq = {
      todo: {
        title: '',
        showTitle: false,
        items: [{ id: '1', text: 'x', done: false, recur: { f: 'hour', n: 1 } }],
      },
    };
    expect(saneContent(badFreq, 'todo')).toBe(false);

    const badN = {
      todo: {
        title: '',
        showTitle: false,
        items: [{ id: '1', text: 'x', done: false, recur: { f: 'day', n: 0 } }],
      },
    };
    expect(saneContent(badN, 'todo')).toBe(false);
  });
});
