// Minimal single-page PDF writer: one JPEG image filling a page sized
// to the raster's aspect. PDF points are 1/72in; page size arrives in pt.

const enc = new TextEncoder();

export function jpegToPdf(jpeg: Uint8Array, imgW: number, imgH: number, pageW: number, pageH: number): Blob {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (s: string | Uint8Array) => {
    const b = typeof s === 'string' ? enc.encode(s) : s;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const content = `q\n${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = pos;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}endstream\n`);

  const xref = pos;
  const count = 6;
  push(`xref\n0 ${count}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n < count; n++) {
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
