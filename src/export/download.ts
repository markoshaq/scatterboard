// Blob download companion to strokes.ts downloadTextFile.
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Duplicate filenames in a zip get ' 2', ' 3', ... before the extension.
export function dedupFileName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const cand = `${stem} ${i}${ext}`;
    if (!used.has(cand)) {
      used.add(cand);
      return cand;
    }
  }
}

// File base name from a board title: 'Sprint Plan!' -> 'sprint-plan'.
export function slugFileName(title: string, fallback = 'board'): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}
