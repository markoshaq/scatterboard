import type { Doc } from '../state/schema';
import { blobRefsInDoc } from './blobs';
import { kvDel, kvGet, kvKeys, kvPut } from './kv';
import type { PersistedWorkspace, Prefs } from './storage';

// Named workspace snapshots: full doc JSON kept outside the live doc so
// taking one never bloats the store. Restoring writes the snapshot
// through the normal adapter save and reloads.
export interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: number;
  // Automatic snapshots (the daily boot one) prune before named ones.
  auto: boolean;
  // Blob refs the snapshot still points at; the boot orphan purge must
  // not reclaim media a restore would need.
  refs: string[];
}

interface SnapshotEntry extends SnapshotMeta {
  json: string;
}

const PREFIX = 'snap:';
const MAX_SNAPSHOTS = 15;

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const out: SnapshotMeta[] = [];
  for (const key of await kvKeys(PREFIX)) {
    const e = await kvGet<SnapshotEntry>(key).catch(() => undefined);
    if (e) out.push({ id: e.id, name: e.name, createdAt: e.createdAt, auto: e.auto, refs: e.refs });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createSnapshot(doc: Doc, prefs: Prefs, name: string, auto: boolean): Promise<SnapshotMeta> {
  const w: PersistedWorkspace = { version: 1, doc, savedAt: Date.now(), prefs };
  const meta: SnapshotMeta = {
    id: `s${w.savedAt.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: w.savedAt,
    auto,
    refs: [...blobRefsInDoc(doc)],
  };
  await kvPut(`${PREFIX}${meta.id}`, { ...meta, json: JSON.stringify(w) });
  await pruneSnapshots();
  return meta;
}

export async function readSnapshot(id: string): Promise<PersistedWorkspace | null> {
  const e = await kvGet<SnapshotEntry>(`${PREFIX}${id}`).catch(() => undefined);
  if (!e?.json) return null;
  try {
    const w = JSON.parse(e.json) as PersistedWorkspace;
    return w && typeof w === 'object' && w.doc && typeof w.doc === 'object' && w.doc.boards ? w : null;
  } catch {
    return null;
  }
}

export function deleteSnapshot(id: string): Promise<void> {
  return kvDel(`${PREFIX}${id}`);
}

// Every blob ref any snapshot still needs; boot feeds it to the orphan
// purge so restoring a snapshot never meets reclaimed media.
export async function snapshotBlobRefs(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const s of await listSnapshots()) for (const r of s.refs) out.add(r);
  return out;
}

async function pruneSnapshots(): Promise<void> {
  const list = await listSnapshots();
  const overflow = list.length - MAX_SNAPSHOTS;
  if (overflow <= 0) return;
  const oldestFirst = (a: SnapshotMeta, b: SnapshotMeta) => a.createdAt - b.createdAt;
  const autos = list.filter((s) => s.auto).sort(oldestFirst);
  const drop = autos.slice(0, overflow);
  if (drop.length < overflow) {
    const named = list.filter((s) => !s.auto).sort(oldestFirst);
    drop.push(...named.slice(0, overflow - drop.length));
  }
  for (const s of drop) await deleteSnapshot(s.id);
}
