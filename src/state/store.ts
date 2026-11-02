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
      this.absorbUndo(this.group, inverse);
      this.absorbRedo(this.group, a);
      this.future = [];
    } else if (inverse.length) {
      this.past.push({ undo: inverse, redo: flatten(a) });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    this.emit(change);
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

  endGroup(label?: string) {
    if (!this.group) {
      this.groupDepth = 0;
      return;
    }
    if (--this.groupDepth > 0) return;
    const g = this.group;
    this.group = null;
    if (!g.redo.length) return;
    this.past.push({ undo: g.undo, redo: g.redo, ...(label !== undefined ? { label } : {}) });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
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
    for (const a of entry.undo) applyAction(this.doc, a, change);
    this.future.push(entry);
    this.emit(change);
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return;
    const change: Change = emptyChange();
    for (const a of entry.redo) applyAction(this.doc, a, change);
    this.past.push(entry);
    this.emit(change);
  }
}
