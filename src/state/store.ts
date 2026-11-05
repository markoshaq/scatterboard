import { applyAction, coalesceKey, emptyChange, mergePatch, type Action, type Change } from './actions';
import type { Doc } from './schema';

interface HistoryEntry {
  undo: Action[];
  redo: Action[];
  label?: string;
}

interface Group {
  undo: Action[];
  undoIdx: Map<string, number>;
  redo: Action[];
  redoIdx: Map<string, number>;
}

const HISTORY_LIMIT = 200;

function flatten(a: Action): Action[] {
  return a.type === 'batch' ? a.actions.flatMap(flatten) : [a];
}

function anyChange(c: Change): boolean {
  return (
    c.elements.size > 0 ||
    c.boards.size > 0 ||
    c.deleted.size > 0 ||
    c.labels.size > 0 ||
    c.trash.size > 0 ||
    c.templates.size > 0
  );
}

export class Store {
  doc: Doc;
  // Bumped on every emit so caches keyed on doc contents can lazily
  // invalidate (BoardIndex, per-render rect caches).
  rev = 0;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private group: Group | null = null;
  private groupDepth = 0;
  private changeListeners = new Set<(c: Change) => void>();

  constructor(doc: Doc) {
    this.doc = doc;
  }

  onChange(fn: (c: Change) => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private emit(c: Change) {
    this.rev++;
    for (const fn of this.changeListeners) fn(c);
  }

  private run(a: Action): { inverse: Action[]; change: Change } {
    const change: Change = emptyChange();
    const inv = applyAction(this.doc, a, change);
    return { inverse: flatten(inv), change };
  }

  dispatch(a: Action) {
    const { inverse, change } = this.run(a);
    if (this.group) {
      // A no-op apply (a delete whose target is already gone) joins
      // neither the group's undo record nor its redo leaves, and the
      // redo stack survives it.
      if (inverse.length || anyChange(change)) {
        this.absorbUndo(this.group, inverse);
        this.absorbRedo(this.group, a);
        this.future = [];
      }
    } else if (inverse.length) {
      this.past.push({ undo: inverse, redo: flatten(a) });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    // A no-op apply (patch on a missing element) produces an empty
    // change: no rev bump, no save mark, no render.
    if (anyChange(change)) this.emit(change);
  }

  private absorbUndo(g: Group, inverse: Action[]) {
    const kept: Action[] = [];
    for (const inv of inverse) {
      const key = coalesceKey(inv);
      const idx = key !== null ? g.undoIdx.get(key) : undefined;
      if (key !== null && idx !== undefined) {
        g.undo[idx] = mergePatch(inv, g.undo[idx]!);
      } else {
        kept.push(inv);
      }
    }
    g.undo = [...kept, ...g.undo];
    for (const [k, i] of g.undoIdx) g.undoIdx.set(k, i + kept.length);
    kept.forEach((inv, i) => {
      const k = coalesceKey(inv);
      if (k !== null && !g.undoIdx.has(k)) g.undoIdx.set(k, i);
    });
  }

  private absorbRedo(g: Group, a: Action) {
    for (const leaf of flatten(a)) {
      const key = coalesceKey(leaf);
      const idx = key !== null ? g.redoIdx.get(key) : undefined;
      if (key !== null && idx !== undefined) {
        g.redo[idx] = mergePatch(g.redo[idx]!, leaf);
      } else {
        if (key !== null) g.redoIdx.set(key, g.redo.length);
        g.redo.push(leaf);
      }
    }
  }

  // Nested begins join the outer group instead of discarding it.
  beginGroup() {
    this.groupDepth++;
    this.group ??= { undo: [], undoIdx: new Map(), redo: [], redoIdx: new Map() };
  }

  // Returns whether the group landed a history entry: callers rolling
  // a group back must not undo when nothing was pushed.
  endGroup(label?: string): boolean {
    if (!this.group) {
      this.groupDepth = 0;
      return false;
    }
    if (--this.groupDepth > 0) return false;
    const g = this.group;
    this.group = null;
    if (!g.redo.length) return false;
    this.past.push({ undo: g.undo, redo: g.redo, ...(label !== undefined ? { label } : {}) });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    return true;
  }

  // Drop the redo stack without dispatching: the agent abort path uses
  // it so an undone partial batch can never replay.
  clearFuture() {
    this.future = [];
  }

  get inGroup() {
    return this.group !== null;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return;
    const change: Change = emptyChange();
    change.replay = true;
    for (const a of entry.undo) applyAction(this.doc, a, change);
    // Push AFTER emit: listeners may flush an open edit group during the
    // emit (endEdit -> endGroup -> future = []), which would wipe the
    // redo entry we just queued.
    this.emit(change);
    this.future.push(entry);
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return;
    const change: Change = emptyChange();
    change.replay = true;
    for (const a of entry.redo) applyAction(this.doc, a, change);
    this.emit(change);
    this.past.push(entry);
  }
}
