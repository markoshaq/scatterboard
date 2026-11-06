// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageAdapter, migrateStorageKeys } from '../src/persist/local';
import type { PersistedWorkspace } from '../src/persist/storage';
import { createBoard, emptyDoc } from '../src/state/schema';

// The env exposes a bare localStorage object with no Storage methods;
// back it with a Map instead.
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

const mem = new MemStorage();
vi.stubGlobal('localStorage', mem);

function workspace(): PersistedWorkspace {
  const doc = emptyDoc();
  doc.boards.home = createBoard({ id: 'home', title: 'Home' });
  return { version: 1, doc, savedAt: 123 };
}

beforeEach(() => mem.clear());

describe('migrateStorageKeys', () => {
  it('copies planboard:* keys forward and removes the old names', () => {
    localStorage.setItem('planboard:v1', '{"version":1}');
    localStorage.setItem('planboard:last-board', 'b1');
    localStorage.setItem('planboard:lang', 'de');
    localStorage.setItem('planboard:theme', 'dark');
    localStorage.setItem('planboard:pos:b1', '{"x":1,"y":2,"z":3}');
    localStorage.setItem('planboard:pos:b2', '{"x":4,"y":5,"z":6}');
    migrateStorageKeys();
    expect(localStorage.getItem('scatterboard:v1')).toBe('{"version":1}');
    expect(localStorage.getItem('scatterboard:last-board')).toBe('b1');
    expect(localStorage.getItem('scatterboard:lang')).toBe('de');
    expect(localStorage.getItem('scatterboard:theme')).toBe('dark');
    expect(localStorage.getItem('scatterboard:pos:b1')).toBe('{"x":1,"y":2,"z":3}');
    expect(localStorage.getItem('scatterboard:pos:b2')).toBe('{"x":4,"y":5,"z":6}');
    for (const k of ['v1', 'last-board', 'lang', 'theme', 'pos:b1', 'pos:b2']) {
      expect(localStorage.getItem(`planboard:${k}`)).toBeNull();
    }
  });

  it('keeps an already-set scatterboard:* value over the old key', () => {
    localStorage.setItem('planboard:v1', 'old-doc');
    localStorage.setItem('scatterboard:v1', 'new-doc');
    localStorage.setItem('planboard:pos:b1', 'old-pos');
    localStorage.setItem('scatterboard:pos:b1', 'new-pos');
    migrateStorageKeys();
    expect(localStorage.getItem('scatterboard:v1')).toBe('new-doc');
    expect(localStorage.getItem('scatterboard:pos:b1')).toBe('new-pos');
    // The old keys are dropped either way: they must not migrate twice.
    expect(localStorage.getItem('planboard:v1')).toBeNull();
    expect(localStorage.getItem('planboard:pos:b1')).toBeNull();
  });

  it('leaves unrelated keys alone', () => {
    localStorage.setItem('other-app:data', 'x');
    migrateStorageKeys();
    expect(localStorage.getItem('other-app:data')).toBe('x');
  });
});

describe('LocalStorageAdapter', () => {
  it('round-trips a workspace through save/load', async () => {
    const a = new LocalStorageAdapter();
    const w = workspace();
    await a.save(w);
    expect(await a.load()).toEqual(w);
  });

  it('returns null on a missing or corrupt doc', async () => {
    const a = new LocalStorageAdapter();
    expect(await a.load()).toBeNull();
    localStorage.setItem('scatterboard:v1', '{nope');
    expect(await a.load()).toBeNull();
  });

  it('quarantines a parseable but malformed workspace', async () => {
    const a = new LocalStorageAdapter();
    localStorage.setItem('scatterboard:v1', '{"version":1,"doc":{}}');
    expect(await a.load()).toBeNull();
    expect(a.corrupt()).toBe('{"version":1,"doc":{}}');
    expect(localStorage.getItem('scatterboard:v1')).toBeNull();
    expect(localStorage.getItem('scatterboard:v1.corrupt')).toBe('{"version":1,"doc":{}}');
  });

  it('quarantines an unknown workspace version instead of reseeding', async () => {
    const a = new LocalStorageAdapter();
    const raw = JSON.stringify({ version: 2, doc: { boards: {}, elements: {} }, savedAt: 1 });
    localStorage.setItem('scatterboard:v1', raw);
    expect(await a.load()).toBeNull();
    expect(a.corrupt()).toBe(raw);
    expect(localStorage.getItem('scatterboard:v1.corrupt')).toBe(raw);
  });

  it('overlays saveBoardPos rows onto the loaded doc', async () => {
    const a = new LocalStorageAdapter();
    const w = workspace();
    w.doc.boards.home!.position = { x: 0, y: 0, z: 1 };
    await a.save(w);
    a.saveBoardPos('home', { x: 10, y: 20, z: 2 });
    a.saveBoardPos('ghost', { x: 1, y: 1, z: 1 });
    const loaded = await a.load();
    // Newest row wins over the serialized doc value.
    expect(loaded!.doc.boards.home!.position).toEqual({ x: 10, y: 20, z: 2 });
    // A pos row for a board the doc no longer has is ignored.
    expect(loaded!.doc.boards.ghost).toBeUndefined();
  });

  it('ignores a corrupt pos row', async () => {
    const a = new LocalStorageAdapter();
    const w = workspace();
    w.doc.boards.home!.position = { x: 0, y: 0, z: 1 };
    await a.save(w);
    localStorage.setItem('scatterboard:pos:home', '{bad');
    const loaded = await a.load();
    expect(loaded!.doc.boards.home!.position).toEqual({ x: 0, y: 0, z: 1 });
  });
});
