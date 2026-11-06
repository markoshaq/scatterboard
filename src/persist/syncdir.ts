import type { Doc } from '../state/schema';
import { blobRefsInDoc, getBlob, putBlob } from './blobs';
import { getBox, isEnvelope, type SealedBlob } from './crypto';
import { kvDel, kvGet, kvPut } from './kv';
import type { Prefs } from './storage';

// Folder backup over the File System Access API: the user points at a
// folder (a synced one, e.g. iCloud or Dropbox, doubles as device
// sync) and every save mirrors workspace.json plus a media/ folder of
// the doc's blobs into it. Chrome-family only; elsewhere the settings
// row degrades to a hint.
const HANDLE_KEY = 'syncdir';
const DOC_FILE = 'workspace.json';
const MEDIA_DIR = 'media';
const MEDIA_INDEX = 'index.json';
const KIND = 'scatterboard-workspace';

interface DirPickerWindow {
  showDirectoryPicker?(opts?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

interface FsPerm {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface BackupPayload {
  kind: string;
  version: number;
  savedAt: number;
  doc: Doc;
  prefs?: Prefs;
}

export function syncDirSupported(): boolean {
  return typeof (window as DirPickerWindow).showDirectoryPicker === 'function';
}

export async function pickSyncDir(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as DirPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ id: 'scatterboard-backup', mode: 'readwrite' });
  } catch {
    // User cancelled the picker.
    return null;
  }
}

export async function loadSyncDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!syncDirSupported()) return null;
  const h = await kvGet<FileSystemDirectoryHandle>(HANDLE_KEY).catch(() => undefined);
  return h ?? null;
}

export function saveSyncDirHandle(h: FileSystemDirectoryHandle): Promise<void> {
  return kvPut(HANDLE_KEY, h);
}

export function forgetSyncDir(): Promise<void> {
  return kvDel(HANDLE_KEY);
}

export async function dirPermission(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await (h as FileSystemDirectoryHandle & FsPerm).queryPermission?.({ mode: 'readwrite' })) ?? 'denied';
}

export async function requestDirPermission(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await (h as FileSystemDirectoryHandle & FsPerm).requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: string | Blob): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

export function parseBackup(text: string): BackupPayload | null {
  try {
    const w = JSON.parse(text) as BackupPayload;
    return w && w.kind === KIND && w.doc && typeof w.doc === 'object' && w.doc.boards ? w : null;
  } catch {
    return null;
  }
}

export async function readBackup(dir: FileSystemDirectoryHandle): Promise<BackupPayload | 'locked' | null> {
  try {
    const fh = await dir.getFileHandle(DOC_FILE);
    const f = await fh.getFile();
    const text = await f.text();
    if (isEnvelope(text)) {
      const box = getBox();
      if (!box) return 'locked';
      return parseBackup(await box.open(text));
    }
    return parseBackup(text);
  } catch {
    return null;
  }
}

type MediaEntry = string | { type: string; enc?: 1 };

// Media files are named by blobRef (ids are content-stable per upload)
// with a small index.json mapping ref to mime type for the restore.
async function mediaTypes(media: FileSystemDirectoryHandle): Promise<Record<string, MediaEntry>> {
  try {
    const fh = await media.getFileHandle(MEDIA_INDEX);
    const m = JSON.parse(await (await fh.getFile()).text()) as Record<string, MediaEntry>;
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

export async function writeBackup(
  dir: FileSystemDirectoryHandle,
  doc: Doc,
  prefs: Prefs,
  mirrored: Set<string>,
): Promise<void> {
  const w: BackupPayload = { kind: KIND, version: 1, savedAt: Date.now(), doc, prefs };
  const box = getBox();
  const raw = JSON.stringify(w);
  await writeFile(dir, DOC_FILE, box ? await box.seal(raw) : raw);
  const media = await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
  const types = await mediaTypes(media);
  let typesDirty = false;
  const live = new Set(blobRefsInDoc(doc));
  for (const ref of live) {
    const blob = mirrored.has(ref) ? (types[ref] === undefined ? await getBlob(ref).catch(() => undefined) : undefined) : await getBlob(ref).catch(() => undefined);
    if (mirrored.has(ref)) {
      // A file mirrored without an index entry (primeMirrored marks
      // every listing) restores as octet-stream: repair its type.
      if (types[ref] === undefined && blob) {
        types[ref] = box ? { type: blob.type, enc: 1 } : blob.type;
        typesDirty = true;
      }
      continue;
    }
    if (!blob) continue;
    if (box) {
      const sealed = await box.sealBytes(await blob.arrayBuffer(), blob.type);
      await writeFile(media, ref, JSON.stringify(sealed));
      types[ref] = { type: blob.type, enc: 1 };
    } else {
      await writeFile(media, ref, blob);
      types[ref] = blob.type;
    }
    typesDirty = true;
    mirrored.add(ref);
  }
  // Dead blobs leave the mirror: an entry deleted from the doc would
  // otherwise stay in the backup forever.
  for await (const name of (media as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys()) {
    if (name === MEDIA_INDEX || live.has(name)) continue;
    try {
      await media.removeEntry(name);
      mirrored.delete(name);
      if (types[name] !== undefined) {
        delete types[name];
        typesDirty = true;
      }
    } catch {
      /* a locked or raced file is retried next save */
    }
  }
  if (typesDirty) await writeFile(media, MEDIA_INDEX, JSON.stringify(types));
}

// After a restore, pull any blob the local IndexedDB lacks out of the
// backup folder. Missing files just leave the card's placeholder.
export async function restoreMedia(dir: FileSystemDirectoryHandle, doc: Doc): Promise<void> {
  let media: FileSystemDirectoryHandle;
  try {
    media = await dir.getDirectoryHandle(MEDIA_DIR);
  } catch {
    return;
  }
  const types = await mediaTypes(media);
  const box = getBox();
  for (const ref of blobRefsInDoc(doc)) {
    const have = await getBlob(ref).catch(() => undefined);
    if (have) continue;
    try {
      const fh = await media.getFileHandle(ref);
      const f = await fh.getFile();
      const entry = types[ref];
      const isEnc = typeof entry === 'object' && entry !== null && entry.enc === 1;
      const mime = (typeof entry === 'string' ? entry : entry?.type) || f.type || 'application/octet-stream';
      if (isEnc) {
        if (!box) continue;
        const sealed = JSON.parse(await f.text()) as SealedBlob;
        const { bytes, type } = await box.openBytes(sealed);
        await putBlob(ref, new Blob([bytes], { type: type || mime }));
      } else {
        await putBlob(ref, new Blob([await f.arrayBuffer()], { type: mime }));
      }
    } catch {
      /* missing media file: placeholder renders */
    }
  }
}
