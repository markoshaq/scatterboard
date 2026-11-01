// Minimal ZIP writer, store-only (no compression): local file headers,
// central directory, EOCD. Enough for 'Download all files'.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

function cat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function zipStore(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const now = new Date();
  const dostime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosdate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = cat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // utf-8 names
      u16(0), // stored
      u16(dostime),
      u16(dosdate),
      u32(crc),
      u32(size),
      u32(size),
      u16(name.length),
      u16(0),
      name,
    ]);
    chunks.push(local, e.data);
    central.push(
      cat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20),
        u16(0x0800),
        u16(0),
        u16(dostime),
        u16(dosdate),
        u32(crc),
        u32(size),
        u32(size),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(off),
        name,
      ]),
    );
    off += local.length + size;
  }
  const cd = cat(central);
  const eocd = cat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(off),
    u16(0),
  ]);
  return new Blob([...chunks, cd, eocd] as BlobPart[], { type: 'application/zip' });
}
