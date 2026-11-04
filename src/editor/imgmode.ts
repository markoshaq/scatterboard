export type ImgMode = 'draw' | 'edit' | 'bg';

// Route params: ?editing-drawing, ?editing,
// ?editing-background. A bare #/e/<id> on an image opens Edit.
export function imgModeFromHash(): ImgMode {
  const q = location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(q);
  if (params.has('editing-drawing')) return 'draw';
  if (params.has('editing-background')) return 'bg';
  return 'edit';
}

export function imgModeParam(m: ImgMode): string {
  return m === 'draw' ? '?editing-drawing' : m === 'bg' ? '?editing-background' : '?editing';
}
