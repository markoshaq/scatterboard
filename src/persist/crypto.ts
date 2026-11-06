import { kvDel, kvGet, kvPut } from './kv';

export const DEFAULT_PBKDF2_ITERS = 600000;
const VERIFY_PLAIN = 'scatterboard-ok';
const META_KEY = 'enc:meta';

export interface EnvelopeJson {
  enc: 1;
  v: 1;
  iv: string;
  ct: string;
}

export interface SealedBlob {
  enc: 1;
  v: 1;
  iv: string;
  ct: string;
  type: string;
}

export interface EncMeta {
  salt: string;
  iters: number;
  verify: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isEnvelope(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s.startsWith('{') || !s.includes('"enc"')) return false;
  try {
    const o = JSON.parse(s) as Partial<EnvelopeJson>;
    return o !== null && typeof o === 'object' && o.enc === 1 && o.v === 1 && typeof o.iv === 'string' && typeof o.ct === 'string';
  } catch {
    return false;
  }
}

export function isSealedBlob(v: unknown): v is SealedBlob {
  if (!v || typeof v !== 'object' || v instanceof Blob) return false;
  const o = v as Partial<SealedBlob>;
  return o.enc === 1 && o.v === 1 && typeof o.iv === 'string' && typeof o.ct === 'string';
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iters = DEFAULT_PBKDF2_ITERS,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export class CryptoBox {
  constructor(private readonly key: CryptoKey) {}

  async seal(text: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const pt = new TextEncoder().encode(text);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, pt);
    const env: EnvelopeJson = {
      enc: 1,
      v: 1,
      iv: bytesToB64(iv),
      ct: bytesToB64(new Uint8Array(ct)),
    };
    return JSON.stringify(env);
  }

  async open(raw: string): Promise<string> {
    const env = JSON.parse(raw) as EnvelopeJson;
    if (!env || env.enc !== 1 || env.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
      throw new Error('bad envelope');
    }
    const iv = b64ToBytes(env.iv);
    const ct = b64ToBytes(env.ct);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, ct);
    return new TextDecoder().decode(pt);
  }

  async sealBytes(data: ArrayBuffer, type = 'application/octet-stream'): Promise<SealedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, data);
    return {
      enc: 1,
      v: 1,
      iv: bytesToB64(iv),
      ct: bytesToB64(new Uint8Array(ct)),
      type,
    };
  }

  async openBytes(sealed: SealedBlob): Promise<{ bytes: ArrayBuffer; type: string }> {
    const iv = b64ToBytes(sealed.iv);
    const ct = b64ToBytes(sealed.ct);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, ct);
    return { bytes, type: sealed.type || 'application/octet-stream' };
  }
}

let activeBox: CryptoBox | null = null;

export function setBox(box: CryptoBox | null): void {
  activeBox = box;
}

export function getBox(): CryptoBox | null {
  return activeBox;
}

export function hasBox(): boolean {
  return activeBox !== null;
}

export async function setupPassphrase(
  passphrase: string,
  iters = DEFAULT_PBKDF2_ITERS,
): Promise<{ box: CryptoBox; meta: EncMeta }> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const key = await deriveKey(passphrase, salt, iters);
  const box = new CryptoBox(key);
  const verify = await box.seal(VERIFY_PLAIN);
  return {
    box,
    meta: {
      salt: bytesToB64(salt),
      iters,
      verify,
    },
  };
}

export async function verifyPassphrase(passphrase: string, meta: EncMeta): Promise<CryptoBox | null> {
  try {
    const salt = b64ToBytes(meta.salt);
    const key = await deriveKey(passphrase, salt, meta.iters);
    const box = new CryptoBox(key);
    const plain = await box.open(meta.verify);
    return plain === VERIFY_PLAIN ? box : null;
  } catch {
    return null;
  }
}

export async function loadEncMeta(): Promise<EncMeta | null> {
  const m = await kvGet<EncMeta>(META_KEY).catch(() => undefined);
  if (!m || typeof m.salt !== 'string' || typeof m.iters !== 'number' || typeof m.verify !== 'string') {
    return null;
  }
  return m;
}

export function saveEncMeta(meta: EncMeta): Promise<void> {
  return kvPut(META_KEY, meta);
}

export function clearEncMeta(): Promise<void> {
  return kvDel(META_KEY);
}

export async function unlockWithPassphrase(passphrase: string, meta?: EncMeta | null): Promise<CryptoBox | null> {
  const m = meta ?? (await loadEncMeta());
  if (!m) return null;
  return verifyPassphrase(passphrase, m);
}
