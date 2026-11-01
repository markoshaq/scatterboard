import type { Element } from './schema';

// Internal clipboard: element snapshots in memory, copied across boards.
// Separate from the OS clipboard so paste is always our own JSON.
let buf: Element[] | null = null;

export function setClipboard(els: Element[]) {
  buf = structuredClone(els);
}

export function getClipboard(): Element[] | null {
  return buf ? structuredClone(buf) : null;
}
