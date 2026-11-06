import { getBox, hasBox, isEnvelope } from './crypto';
import type { PersistedWorkspace } from './storage';

export class LockedError extends Error {
  constructor() {
    super('workspace is locked');
  }
}

export function locked(raw: string | null | undefined): boolean {
  return !!raw && isEnvelope(raw) && !hasBox();
}

export async function pack(w: PersistedWorkspace): Promise<string> {
  const json = JSON.stringify(w);
  const box = getBox();
  return box ? box.seal(json) : json;
}

export async function unpack(
  raw: string,
  parse?: (s: string) => Promise<unknown> | unknown,
): Promise<PersistedWorkspace | null> {
  let json = raw;
  if (isEnvelope(raw)) {
    const box = getBox();
    if (!box) throw new LockedError();
    json = await box.open(raw);
  }
  const w = (parse ? await parse(json) : JSON.parse(json)) as PersistedWorkspace;
  // Anything that is not a well-shaped v1 workspace is corrupt data:
  // the adapters quarantine null results rather than letting boot
  // seed over them. A doc without boards/elements records would crash
  // boot before its error handlers register, and an unknown version
  // must not be reseeded silently either.
  if (!w || typeof w !== 'object' || w.version !== 1) return null;
  const rec = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!rec(w.doc) || !rec(w.doc.boards) || !rec(w.doc.elements)) return null;
  return w;
}
