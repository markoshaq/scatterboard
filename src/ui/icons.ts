const S = (inner: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  note: S(
    `<rect x="3.5" y="2.5" width="13" height="15" rx="2.5"/><path d="M6.5 6.5h7M6.5 10h7M6.5 13.5h4.5"/>`,
  ),
  column: S(
    `<rect x="3" y="2.5" width="14" height="15" rx="2.5"/><rect x="6" y="6" width="8" height="3" rx="1" fill="currentColor" stroke="none"/><rect x="6" y="11" width="8" height="3" rx="1" fill="currentColor" stroke="none"/>`,
  ),
  board: S(
    `<rect x="2.5" y="2.5" width="15" height="15" rx="3"/><rect x="6.5" y="6.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.55"/>`,
  ),
  todo: S(`<path d="M3.5 6.5 5 8l2.7-2.8"/><path d="M11 6h5.5"/><path d="M3.5 13.5 5 15l2.7-2.8"/><path d="M11 13h5.5"/>`),
  heading: S(`<path d="M5.5 4v12M14.5 4v12M5.5 10h9"/>`),
  swatch: S(
    `<rect x="4" y="4" width="12" height="12" rx="3.5" fill="currentColor" stroke="none" opacity="0.85"/><rect x="4" y="4" width="12" height="12" rx="3.5" opacity="0.4"/>`,
  ),
  line: S(
    `<path d="M6.5 13.5 13 7"/><circle cx="5" cy="15" r="1.8" fill="currentColor" stroke="none"/><path d="M15.6 4.4 12 5.6l2.6 2.6z" fill="currentColor" stroke="none"/>`,
  ),
  comment: S(
    `<path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.6 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z"/><circle cx="7" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="9" r="1" fill="currentColor" stroke="none"/>`,
  ),
  color: S(
    `<path d="M10 3s4.5 5.2 4.5 8.5a4.5 4.5 0 0 1-9 0C5.5 8.2 10 3 10 3z"/>`,
  ),
  labels: S(
    `<path d="M3.5 3.5h5.2l7.3 7.3a1.8 1.8 0 0 1 0 2.5l-2.7 2.7a1.8 1.8 0 0 1-2.5 0L3.5 8.7z"/><circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none"/>`,
  ),
  reactions: S(
    `<circle cx="10" cy="10" r="7.2"/><path d="M7 11.6c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5"/><circle cx="7.4" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8" r=".9" fill="currentColor" stroke="none"/>`,
  ),
  title: S(`<path d="M5 5.5V4h10v1.5M10 4v12M7.5 16h5"/>`),
  more: S(
    `<circle cx="5" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.4" fill="currentColor" stroke="none"/>`,
  ),
  align: S(`<path d="M4 3v14"/><rect x="7" y="5" width="9" height="3.4" rx="1"/><rect x="7" y="11.6" width="5.5" height="3.4" rx="1"/>`),
  distribute: S(
    `<rect x="2.5" y="6" width="3" height="8" rx="1"/><rect x="8.5" y="6" width="3" height="8" rx="1"/><rect x="14.5" y="6" width="3" height="8" rx="1"/>`,
  ),
  trash: S(
    `<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10.2A1.5 1.5 0 0 0 8.2 17.6h3.6a1.5 1.5 0 0 0 1.5-1.4L14 6"/><path d="M8.5 9v5M11.5 9v5"/>`,
  ),
  lineStart: S(`<path d="M14 13.5 7.5 7"/><circle cx="5" cy="4.8" r="1.8" fill="currentColor" stroke="none"/>`),
  lineEnd: S(
    `<path d="M6 6.5 12.5 13"/><path d="M15.8 15.2 14.6 12l-2.9 1.2z" fill="currentColor" stroke="none"/>`,
  ),
  dashed: S(`<path d="M3 10h3M8.5 10h3M14 10h3"/>`),
  weight: S(`<path d="M4 6.5h12" stroke-width="1"/><path d="M4 10h12" stroke-width="2"/><path d="M4 14h12" stroke-width="3.5"/>`),
  showValue: S(
    `<path d="M2.5 10s2.8-4.6 7.5-4.6S17.5 10 17.5 10 14.7 14.6 10 14.6 2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.2"/>`,
  ),
  toBoard: S(
    `<rect x="3" y="2.5" width="14" height="15" rx="2.5"/><path d="M7 10h6M10.5 7.5 13 10l-2.5 2.5"/>`,
  ),
  search: S(`<circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3.5 3.5"/>`),
  close: S(`<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>`),
  check: S(`<path d="m4.5 10.5 3.5 3.5 7.5-8"/>`),
  inbox: S(
    `<path d="M3.5 11.5 5.5 4.5h9l2 7"/><path d="M3.5 11.5h4l1 2h3l1-2h4v4a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15.5z"/>`,
  ),
  txStyle: S(`<path d="M4 5h12M4 10h12M4 15h7"/>`),
  txBold: S(`<path d="M6.5 4.5h4a2.6 2.6 0 0 1 0 5.2h-4z"/><path d="M6.5 9.7h5a2.7 2.7 0 0 1 0 5.4h-5z"/><path d="M6.5 4.5v10.6"/>`),
  txItalic: S(`<path d="M8.5 4.5h5M6.5 15.5h5M11.5 4.5l-3 11"/>`),
  txStrike: S(
    `<path d="M13 6c-.5-1-1.8-1.6-3.2-1.6-1.9 0-3.2.9-3.2 2.3 0 3.3 6.8 1.7 6.8 5 0 1.5-1.4 2.5-3.4 2.5-1.5 0-2.8-.7-3.3-1.8"/><path d="M4.5 10h11"/>`,
  ),
  txUnderline: S(`<path d="M6.5 4v5a3.5 3.5 0 0 0 7 0V4"/><path d="M5 16h10"/>`),
  txBullet: S(
    `<circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="14" r="1.2" fill="currentColor" stroke="none"/><path d="M9.5 6h7M9.5 14h7"/>`,
  ),
  txNumbered: S(
    `<path d="M4.4 5.2 5.6 4.4v4.4M4.4 8.8h2.4"/><path d="M4.4 13.2c.4-.6 1.1-1 1.9-1 .9 0 1.6.5 1.6 1.2 0 1.5-3.5 1.9-3.5 3.4h4"/><path d="M11 6h5.5M11 15h5.5"/>`,
  ),
  txCenter: S(`<path d="M4 5h12M6.5 10h7M4 15h12"/>`),
  txLink: S(
    `<path d="M8.5 11.5l3-3"/><path d="M9.7 7.3 11 6a2.5 2.5 0 0 1 3.5 3.5l-1.3 1.3"/><path d="M10.3 12.7 9 14a2.5 2.5 0 0 1-3.5-3.5l1.3-1.3"/>`,
  ),
  txCode: S(`<path d="M7.5 6 4.5 10l3 4M12.5 6l3 4-3 4"/>`),
  txDue: S(`<rect x="3.5" y="4" width="13" height="12.5" rx="2"/><path d="M3.5 8h13M7 2.5v3M13 2.5v3"/>`),
  txAssign: S(`<circle cx="10" cy="6.5" r="2.8"/><path d="M4.5 16.5c.7-3 2.8-4.5 5.5-4.5s4.8 1.5 5.5 4.5"/>`),
  link: S(
    `<path d="M8.5 11.5l3-3"/><path d="M9.7 7.3 11 6a2.5 2.5 0 0 1 3.5 3.5l-1.3 1.3"/><path d="M10.3 12.7 9 14a2.5 2.5 0 0 1-3.5-3.5l1.3-1.3"/>`,
  ),
  embed: S(`<rect x="3" y="4.5" width="14" height="11" rx="2.5"/><path d="M8.5 7.8v4.4l4-2.2z" fill="currentColor" stroke="none"/>`),
  video: S(`<rect x="3" y="4.5" width="14" height="11" rx="2.5"/><path d="M8.5 7.8v4.4l4-2.2z" fill="currentColor" stroke="none"/>`),
  audio: S(`<path d="M7 14.5V5.8l7-1.8v8.2"/><circle cx="5.5" cy="14.5" r="2"/><circle cx="12.5" cy="12.2" r="2"/>`),
  map: S(
    `<path d="M10 17s5-5.2 5-8.7a5 5 0 0 0-10 0C5 11.8 10 17 10 17z"/><circle cx="10" cy="8.2" r="1.8"/>`,
  ),
  image: S(
    `<rect x="3" y="3.5" width="14" height="13" rx="2.5"/><circle cx="7.5" cy="8" r="1.4"/><path d="M4 14.5l4-4 3 3 3-3.5 3 3.5"/>`,
  ),
  file: S(
    `<path d="M5.5 2.5h6L15 6v11.5h-9.5z"/><path d="M11 2.5V6.5h4"/>`,
  ),
  upload: S(`<path d="M10 13V5M6.5 8.5 10 5l3.5 3.5"/><path d="M4 15.5h12"/>`),
  play: S(`<path d="M7 5.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>`),
  info: S(`<circle cx="10" cy="10" r="7"/><path d="M10 9.5v4"/><circle cx="10" cy="6.5" r="1" fill="currentColor" stroke="none"/>`),
  caption: S(`<path d="M4 6h12M4 10h12M4 14h7"/>`),
  download: S(`<path d="M10 4v8M6.5 8.5 10 12l3.5-3.5"/><path d="M4 15.5h12"/>`),
  document: S(
    `<path d="M5.5 2.5h6L15 6v11.5h-9.5z"/><path d="M11 2.5V6.5h4"/><path d="M7.5 9.5h5M7.5 12.5h5"/>`,
  ),
  sketch: S(
    `<path d="M3.5 15.5c3-1 3.5-4.5 3-7S8 4.5 11 4.5s5 2 4.5 4.5S12.5 14 10 13.5 8 10.5 10 9"/>`,
  ),
  annotation: S(
    `<path d="M3 12.5c2.5-4.5 5.5-4.5 7-2s4 2.5 6.5-1"/><path d="m14.5 3.5 2 2-5.5 5.5-2.5.5.5-2.5z"/>`,
  ),
  draw: S(
    `<path d="M13.6 3.4a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.2 14.8l-4 1 1-4z"/><path d="m12 5.5 2.5 2.5"/>`,
  ),
  pen: S(
    `<path d="M13.6 3.4a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.2 14.8l-4 1 1-4z"/><path d="m12 5.5 2.5 2.5"/>`,
  ),
  selTool: S(`<path d="M5.5 3.5 16 10.2l-5.8 1-2.4 4.9z"/>`),
  eraser: S(
    `<path d="M7.5 16.5h9"/><path d="M4.6 10.9 11 4.5a1.4 1.4 0 0 1 2 0l2.4 2.5a1.4 1.4 0 0 1 0 2l-6.4 6.4H6.5l-1.9-2a1.4 1.4 0 0 1 0-2z"/>`,
  ),
  undo: S(`<path d="M4 8h7.5a4 4 0 0 1 0 8H8"/><path d="M7 4.5 3.5 8 7 11.5"/>`),
  redo: S(`<path d="M16 8H8.5a4 4 0 0 0 0 8H12"/><path d="m13 4.5 3.5 3.5-3.5 3.5"/>`),
  table: S(
    `<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M3 8h14M3 12.4h14M10 3.5v13"/>`,
  ),
  cellType: S(
    `<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M7.5 8h5M10 8v5"/>`,
  ),
  formula: S(`<path d="M12.8 4.2c-3.2.2-4.2 1.8-4.7 4.3L6.7 16"/><path d="M5.5 9.5h6"/>`),
  addCol: S(`<rect x="3" y="4" width="8.5" height="12" rx="2"/><path d="M15.7 7.5v5M13.2 10h5"/>`),
  addRow: S(`<rect x="3" y="7.5" width="14" height="8.5" rx="2"/><path d="M10 3v5M7.5 5.5h5"/>`),
  cardView: S(
    `<rect x="2.5" y="4" width="6.5" height="12" rx="1.5"/><rect x="11" y="4" width="6.5" height="8" rx="1.5"/>`,
  ),
  insert: S(`<path d="M10 4v12M4 10h12"/>`),
  indent: S(
    `<path d="M8.5 5h8M8.5 10h8M8.5 15h8"/><path d="M3 8.5 5.5 10 3 11.5z" fill="currentColor" stroke="none"/>`,
  ),
  unindent: S(
    `<path d="M8.5 5h8M8.5 10h8M8.5 15h8"/><path d="M5.5 8.5 3 10l2.5 1.5z" fill="currentColor" stroke="none"/>`,
  ),
  export: S(`<path d="M10 12V4M6.5 7.5 10 4l3.5 3.5"/><path d="M4 15.5h12"/>`),
  crop: S(`<path d="M6.5 2.5V14h11"/><path d="M2.5 6.5H14v11"/>`),
  rotLeft: S(
    `<path d="M2.5 10a7.5 7.5 0 1 0 7.5-7.5 8.3 8.3 0 0 0-5.6 2.3L2.5 6.7"/><path d="M2.5 2.5v4.2h4.2"/>`,
  ),
  flipH: S(
    `<path d="M10 3v14"/><path d="M7.5 6 4 9.5 7.5 13z" fill="currentColor" stroke="none"/><path d="M12.5 6 16 9.5l-3.5 3.5z" fill="currentColor" stroke="none"/>`,
  ),
  flipV: S(
    `<path d="M3 10h14"/><path d="M6.5 7.5 10 4l3.5 3.5z" fill="currentColor" stroke="none"/><path d="M6.5 12.5 10 16l3.5-3.5z" fill="currentColor" stroke="none"/>`,
  ),
  icon: S(
    `<rect x="3.5" y="3.5" width="13" height="13" rx="3"/><path d="m10 6.8 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z"/>`,
  ),
  gear: S(
    `<circle cx="10" cy="10" r="2.6"/><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4"/>`,
  ),
  matte: S(
    `<rect x="6.5" y="6.5" width="10" height="10" rx="2" fill="currentColor" stroke="none" opacity="0.3"/><rect x="3.5" y="3.5" width="10" height="10" rx="2"/>`,
  ),
};

export function typeIcon(type: string): string {
  return (ICONS as Record<string, string>)[type] ?? ICONS.note;
}
