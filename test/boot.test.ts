// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createBoard, createNote, createTodo, emptyDoc } from '../src/state/schema';
import { Store } from '../src/state/store';
import { LocalStorageAdapter } from '../src/persist/local';

// Mount the real App against happy-dom. Canvas contexts are no-op
// proxies (the DOM card layer is what we assert on), media queries all
// answer false, and timers drive the queued render path.
const ctx2d: CanvasRenderingContext2D = new Proxy(
  {},
  {
    get: (t, p: string) => (p in t ? (t as Record<string, unknown>)[p] : () => ctx2d),
    set: (t, p: string, v) => {
      (t as Record<string, unknown>)[p] = v;
      return true;
    },
  },
) as CanvasRenderingContext2D;

(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx2d;

vi.stubGlobal('matchMedia', (q: string) => ({
  media: q,
  matches: false,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
}));

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

if (!('animate' in Element.prototype)) {
  (Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    cancel() {},
    addEventListener() {},
    removeEventListener() {},
  });
}

class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
vi.stubGlobal('localStorage', new MemStorage());

describe('app smoke', () => {
  it('mounts, renders cards, and unwires undo cleanly', async () => {
    const { App } = await import('../src/app');
    const doc = emptyDoc();
    doc.boards.home = createBoard({ id: 'home', title: 'Home' });
    const store = new Store(doc);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = new App(root, store, new LocalStorageAdapter());
    app.openBoard('home');
    app.render();
    expect(app.boardId).toBe('home');
    expect(app.docEl.querySelectorAll('.card')).toHaveLength(0);
    expect(root.querySelector('.board-empty')).not.toBeNull();

    const note = createNote(doc, 'home', 0, 0, 'hello smoke');
    const todo = createTodo(doc, 'home', 300, 0);
    store.dispatch({ type: 'element.create', el: note });
    store.dispatch({ type: 'element.create', el: todo });
    app.render();
    expect(app.docEl.querySelectorAll('.card')).toHaveLength(2);
    expect(app.docEl.textContent).toContain('hello smoke');
    // The empty-board hint hides once real cards exist.
    expect((root.querySelector('.board-empty') as HTMLElement).style.display).toBe('none');

    store.undo();
    expect(doc.elements[todo.id]).toBeUndefined();
    expect(doc.elements[note.id]).toBeTruthy();

    app.selectOnly(note.id);
    expect(app.sel.has(note.id)).toBe(true);
  });
});
