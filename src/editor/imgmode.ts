export type ImgMode = 'draw' | 'edit' | 'bg';

// Route params: ?editing-drawing, ?editing,
// ?editing-background. A bare #/e/<id> on an image opens Edit.
export function imgModeFromHash(): ImgMode {
  const q = location.hash.split('?')[1] ?? '';
  if (q.includes('editing-drawing')) return 'draw';
  if (q.includes('editing-background')) return 'bg';
  return 'edit';
}

export function imgModeParam(m: ImgMode): string {
  return m === 'draw' ? '?editing-drawing' : m === 'bg' ? '?editing-background' : '?editing';
}
