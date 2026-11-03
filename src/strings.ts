import type { Lang } from './persist/storage';

const en = {
  appName: 'Scatterboard',
  homeTitle: 'Welcome',
  saving: 'Saving...',
  saved: 'Saved',
  persistDegraded: 'Storage degraded: saving to browser backup storage',
  notePlaceholder: 'Start typing...',
  headingPlaceholder: 'Start typing...',
  gridOn: 'Grid on',
  gridOff: 'Grid off',
  zoomFit: 'Fit',
  untitled: 'Untitled board',
  railNote: 'Note',
  railColumn: 'Column',
  railBoard: 'Board',
  railTodo: 'To-do',
  railHeading: 'Heading',
  railColor: 'Color',
  railLine: 'Line',
  addTitle: 'Add a title',
  todoItemPlaceholder: 'List item',
  captionPlaceholder: 'Add a caption',
  lineLabelPlaceholder: 'Label',
  setDueDate: 'Set due date',
  addDueTime: 'Add due time',
  clear: 'Clear',
  railComment: 'Comment',
  toolColor: 'Color',
  toolLabels: 'Labels',
  toolReactions: 'Reactions',
  toolComment: 'Comment',
  toolTitle: 'Title',
  toolMore: 'More',
  toolAlign: 'Align',
  toolDistribute: 'Distribute',
  toolTrash: 'Trash',
  lineStart: 'Start',
  lineEnd: 'End',
  lineLabel: 'Label',
  lineDashed: 'Dashed',
  lineWeight: 'Weight',
  weightThin: 'Thin',
  weightMedium: 'Medium',
  weightThick: 'Thick',
  showValue: 'Show value',
  toBoard: 'To board',
  lockPosition: 'Lock Position',
  bringToFront: 'Bring to Front',
  sendToBack: 'Send to Back',
  connectLines: 'Connect with Lines',
  alignLeft: 'Left',
  alignCenterH: 'Center horizontally',
  alignRight: 'Right',
  alignTop: 'Top',
  alignMiddleV: 'Middle vertically',
  alignBottom: 'Bottom',
  distH: 'Horizontally',
  distV: 'Vertically',
  colorDefault: 'Default',
  colorCustom: 'Custom',
  deleteLabel: 'Delete label',
  noLabels: 'No labels on this board yet',
  labelNamePh: 'New label name',
  commentPh: 'Write a comment...',
  send: 'Send',
  editLabel: 'Edit',
  edited: 'edited',
  detachComment: 'Move to canvas',
  unsortedTitle: 'Unsorted',
  sendToUnsorted: 'Send to Unsorted',
  unsortedHelp: 'A place to put things while you decide where they should go',
  unsortedEmpty: 'Nothing filed here',
  trashTitle: 'Trash',
  emptyTrash: 'Empty trash',
  trashEmpty: 'Your trash is empty',
  today: 'Today',
  yesterday: 'Yesterday',
  searchTitle: 'Search',
  searchPh: 'Search this board...',
  searchEmpty: 'No matches',
  matchCount: '{n} matches',
  matchOne: '1 match',
  projectsTitle: 'Projects',
  projectNew: 'New project',
  projectUntitled: 'Untitled project',
  projectsFilterPh: 'Filter projects...',
  boardsOne: '1 board',
  boardsMany: '{n} boards',
  boardRename: 'Rename',
  boardDelete: 'Delete',
  boardDeleteQ: 'Delete "{name}"?',
  boardDeleted: 'Deleted {name}',
  expandRow: 'Expand',
  collapseRow: 'Collapse',
  shortcutsTitle: 'Keyboard shortcuts',
  toolTextStyle: 'Text style',
  toolBold: 'Bold',
  toolItalic: 'Italic',
  toolStrike: 'Strike­through',
  toolBullet: 'Bullet list',
  toolNumbered: 'Numbered list',
  toolCenter: 'Center text',
  toolLink: 'Link',
  toolInlineCode: 'Inline code',
  toolUnderline: 'Underline',
  toolDueDate: 'Due date',
  toolAssign: 'Assign',
  styleLarge: 'Large heading',
  styleHeading: 'Heading',
  styleNormal: 'Normal text',
  styleSmall: 'Small text',
  styleCode: 'Code block',
  styleCallout: 'Callout',
  styleQuote: 'Quote block',
  textColor: 'Color',
  textHighlight: 'Highlight',
  linkPh: 'Enter a URL...',
  assigneeYou: 'You',
  boardColor: 'Board color',
  railLink: 'Link',
  railAudio: 'Audio',
  railMap: 'Map',
  railVideo: 'Video',
  railImage: 'Image',
  railFile: 'File',
  railEmbed: 'Embed',
  addImage: 'Add image',
  uploadFile: 'Upload',
  toolPreview: 'Preview',
  toolLinkInfo: 'Link info',
  toolRename: 'Rename',
  toolCaption: 'Caption',
  pasteLinkPh: 'Paste a link',
  pasteAudioPh: 'Paste a link from Spotify or SoundCloud',
  pasteMapPh: 'Paste a link from Google Maps',
  pasteVideoPh: 'Paste a link from YouTube or Vimeo',
  copyLink: 'Copy Link Address',
  copyUrl: 'Copy',
  downloadOriginal: 'Download Original Image',
  replaceImage: 'Replace Image',
  cropToGrid: 'Crop Image to Fit Dot Grid',
  toolDrawOn: 'Draw on',
  toolImgEdit: 'Edit',
  toolImgBg: 'Background',
  imModeDraw: 'Draw on',
  imModeEdit: 'Edit',
  imModeBg: 'Background',
  imCrop: 'Crop',
  imRotLeft: 'Rotate left',
  imFlipH: 'Flip horizontal',
  imFlipV: 'Flip vertical',
  imRemoveBg: 'Remove background',
  imLoading: 'Loading image...',
  downloadFile: 'Download',
  noPreview: 'No preview',
  imageMissing: 'Image unavailable',
  railDocument: 'Document',
  railSketch: 'Sketch',
  railAnnotation: 'Annotation',
  railDraw: 'Draw',
  toolCardView: 'Card view',
  convertToDocument: 'Convert to Document',
  convertToNote: 'Convert to Note',
  convertToSketch: 'Convert to Sketch Card',
  downloadSvg: 'Download SVG',
  docUntitled: 'Untitled document',
  docTitlePh: 'Title',
  exportAs: 'Export',
  exportMarkdown: 'Markdown',
  exportPlain: 'Plain text',
  insertTool: 'Insert',
  insertEmoji: 'Emoji',
  insertDivider: 'Divider line',
  insertBoardLink: 'Link to board',
  toolIndent: 'Indent',
  toolUnindent: 'Unindent',
  drawPen: 'Pen',
  drawSelect: 'Selection',
  drawEraser: 'Eraser',
  drawColor: 'Colour',
  drawWeight: 'Line weight',
  drawUndo: 'Undo',
  drawRedo: 'Redo',
  drawCancel: 'Cancel',
  drawDiscard: 'Discard',
  drawSave: 'Save',
  sketchEmptyPh: 'Double-click to draw',
  railTable: 'Table',
  toolCellType: 'Cell type',
  toolCellColor: 'Cell color',
  toolFormula: 'Formula',
  toolCellAlign: 'Alignment',
  toolAddColumn: 'Add column',
  toolAddRow: 'Add row',
  cellAuto: 'Auto',
  cellNumber: 'Number',
  cellCurrency: 'Currency',
  cellPercent: 'Percentage',
  cellText: 'Text',
  cellDatetime: 'Date & Time',
  cellCheckbox: 'Checkbox',
  addRowAbove: 'Add Row Above',
  addRowBelow: 'Add Row Below',
  addColLeft: 'Add Column Left',
  addColRight: 'Add Column Right',
  clearCell: 'Clear Cell',
  deleteRow: 'Delete Row',
  deleteCol: 'Delete Column',
  alignCenter: 'Center',
  alignMiddle: 'Middle',
  alignHGroup: 'Horizontal',
  alignVGroup: 'Vertical',
  viewMenu: 'View',
  stopPresenting: 'Stop presenting (Esc)',
  focusSelected: 'Focus on selected cards',
  hideComments: 'Hide comments',
  preventEditing: 'Prevent editing',
  exportMenu: 'Export',
  exImgHead: 'Board layout',
  exPng: 'Board as PNG',
  exPdfStd: 'Board as PDF (standard)',
  exPdfHi: 'Board as PDF (high quality)',
  exDocHead: 'Document',
  exWord: 'Word (.doc)',
  exMd: 'Markdown (.md)',
  exTxt: 'Plain text (.txt)',
  exSubs: 'Include sub-boards',
  exDataHead: 'Files',
  exFiles: 'Download all files',
  exJson: 'Board as JSON',
  exImport: 'Import board (.json)',
  exFail: 'Export did not finish',
  exImportFail: 'That file is not a Scatterboard export',
  toolIcon: 'Icon',
  iconSearchPh: 'Search icons...',
  iconRecommended: 'Recommended',
  iconLetters: 'Letters & numbers',
  iconAll: 'Icons',
  iconResults: 'Results',
  iconNone: 'No matches',
  iconUpload: 'Upload an image',
  iconClear: 'Use default icon',
  emptyBoard: 'Empty board',
  templatesHead: 'Templates',
  myTemplates: 'Your templates',
  renameTemplate: 'Rename',
  deleteTemplate: 'Delete template',
  convertToTemplate: 'Convert to Template',
  tplSaved: 'Saved as a template',
  openNewTab: 'Open in New Tab',
  copyLinkBoard: 'Copy Link to Board',
  createShortcut: 'Create Shortcut',
  settingsTitle: 'Settings',
  setTheme: 'Theme',
  setSystem: 'System',
  setLight: 'Light',
  setDark: 'Dark',
  setScale: 'Interface scale',
  scaleSmaller: 'Smaller',
  scaleDefault: 'Default',
  scaleLarger: 'Larger',
  setStorage: 'Storage',
  storageLoading: 'Checking...',
  storageLine: '{doc} board data, {media} media',
  welcomeHead: 'Welcome to Scatterboard',
  welcomeNote1: 'Double-click anywhere to drop a note',
  welcomeNote2: 'Drag cards in from the left rail',
  welcomeNote3: 'Hold Space and drag to pan. Press / for every shortcut',
  welcomeBoard: 'A board inside a board',
  welcomeChild1: 'Boards nest as deep as you need',
  welcomeChild2: 'Use the crumbs up top to find your way back',
  welcomeToast: 'Tip: press / anytime to see every shortcut',
  setLanguage: 'Language',
  setAuto: 'Automatic',
  setFormat: 'Formatting',
  setBrowserLang: 'Use browser language',
  setCurrency: 'Currency',
  setCanvas: 'Canvas',
  setNoOverlap: 'Prevent card overlap',
  setInk: 'Ink pen effect',
  setUndoArrows: 'Undo and redo arrows',
  setGuides: 'Alignment guides',
  guideFull: 'Full',
  guideFaint: 'Faint',
  guideHidden: 'Hidden',
  setToolbar: 'Toolbar palette',
  toolbarReset: 'Reset order',
  toolHide: 'Hide from palette',
  toolShow: 'Show in palette',
  setTemplates: 'Manage templates',
  setReset: 'Reset everything',
  resetAllQ: 'Reset everything? All boards and settings will be deleted.',
  resetAllAct: 'Reset',
  setOnline: 'Online extras',
  setUnfurl: 'Enrich link cards',
  setAbout: 'About',
  aboutSource: 'Source code (GitHub)',
  helpTitle: 'Help',
  helpIssue: 'Report an issue',
  railCapture: 'Quick capture',
  qcTitle: 'Quick capture',
  qcPh: 'Write it down...',
  qcAdd: 'Add to Unsorted',
  qcSaved: 'Saved to Unsorted',
  syncAsk: 'Keep this copy in sync?',
  syncKeep: 'Keep in sync',
  unlinkCopy: 'Unlink this copy',
  docOffer: 'Long note. Turn it into a document?',
  docOfferBtn: 'Convert',
  todoTitleOffer: 'Add a title to this list?',
  todoTitleBtn: 'Add title',
  reactSearchPh: 'Search emoji...',
  reactTone: 'Skin tone',
  openFile: 'Open',
  recentHead: 'Recently viewed',
  sortLabel: 'Sort',
  sortViewed: 'Last viewed',
  sortModified: 'Last modified',
  sortRelevance: 'Relevance',
  embedOffline: 'Offline',
  dueRel: 'Due {rel}',
  dueDate: 'Due {date}',
  justNow: 'just now',
  cardsOne: '1 card',
  cardsMany: '{n} cards',
  docsOne: '1 document',
  docsMany: '{n} documents',
  wordsOne: '1 word',
  wordsMany: '{n} words',
  scNewNote: 'New note',
  scNewNoteBelow: 'New note below (while editing)',
  scPan: 'Pan',
  scZoom: 'Zoom',
  scSearch: 'Search',
  scDelete: 'Delete selection',
  scUnsorted: 'Send to Unsorted',
  scNudge: 'Nudge (Shift for 10px)',
  scEyedropper: 'Colour eyedropper',
  scUndoRedo: 'Undo / redo',
  scSelectAll: 'Select all',
  scDeselect: 'Deselect',
  scDuplicate: 'Duplicate (or Opt+drag)',
  scCutCopyPaste: 'Cut / copy / paste',
  scPasteStyles: 'Paste styles',
  scReorderZ: 'Send to back / bring to front',
  scBackFwd: 'Back / forward',
  scBoardNewTab: 'Open board in new tab',
  scParentBoard: 'Go to parent board',
  scFit: 'Scale to fit',
  scZoomInOut: 'Zoom in / out / 100%',
  scPresent: 'Presentation mode',
  scDark: 'Dark mode',
  scUiScale: 'Interface scale',
  scTodoTitle: 'To-do title (while editing)',
  scTodoDue: 'To-do due date (while editing)',
  scBoldItalic: 'Bold / italic / underline',
  scStrike: 'Strikethrough',
  scLink: 'Link',
  scHighlight: 'Highlight',
  scHeadings: 'Large heading / heading / normal / small',
  scCodeBlock: 'Code block',
  scQuote: 'Quote block',
  scCallout: 'Callout',
  scCenter: 'Center text',
  scLists: 'Bullet / numbered list',
  scListIndent: 'Indent / outdent in lists',
  scTableRows: 'Table: row above / below',
  scTableCols: 'Table: column left / right',
  scDraw: 'Draw on the board',
  scDrawTools: 'Draw: select / eraser / colour / previous colour',
  scDrawSizes: 'Draw: pen size',
  scDrawExit: 'Draw: save and exit',
};

export type StringKey = keyof typeof en;

// Non-English tables lazy-load through loadLang() so the main chunk
// only pays for English. t() falls back to en for missing tables/keys.
const TABLES: Partial<Record<Lang, Partial<Record<StringKey, string>>>> = { en };

const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Partial<Record<StringKey, string>> }>> = {
  de: () => import('./lang/de'),
  es: () => import('./lang/es'),
  fr: () => import('./lang/fr'),
  pt: () => import('./lang/pt'),
};

export async function loadLang(l: Lang) {
  if (l === 'en' || TABLES[l]) return;
  try {
    TABLES[l] = (await LOADERS[l]()).default;
  } catch {
    // Offline-first: a missing chunk falls back to English strings.
  }
}

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'pt', label: 'Português' },
];

const LANG_TAGS: Record<Lang, string> = { en: 'en', de: 'de', es: 'es', fr: 'fr', pt: 'pt' };

export function bootLang(): Lang {
  try {
    // scatterboard:lang mirrors prefs.lang so the active language is
    // readable before module-level label tables are captured, even
    // when the workspace lives in sqlite rather than localStorage.
    // The pre-rename planboard:* keys are still read once and moved
    // forward for users upgrading before boot() runs the key rename.
    const oldLang = localStorage.getItem('planboard:lang');
    if (oldLang !== null) {
      if (localStorage.getItem('scatterboard:lang') === null) localStorage.setItem('scatterboard:lang', oldLang);
      localStorage.removeItem('planboard:lang');
    }
    const direct = localStorage.getItem('scatterboard:lang');
    const l =
      direct ??
      (() => {
        const raw = localStorage.getItem('scatterboard:v1') ?? localStorage.getItem('planboard:v1');
        return raw ? (JSON.parse(raw) as { prefs?: { lang?: Lang } }).prefs?.lang : undefined;
      })();
    if (l && l in LANG_TAGS) return l as Lang;
  } catch {
    // Fall through to browser detection.
  }
  // No saved choice: take the first supported tag from the browser's
  // language list ('fr-CA' -> 'fr').
  const navs =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  for (const tag of navs) {
    const base = (tag ?? '').split('-')[0]!.toLowerCase();
    if (base in LANG_TAGS) return base as Lang;
  }
  return 'en';
}

const active: Lang = bootLang();

export function lang(): Lang {
  return active;
}

function langTag(): string {
  return LANG_TAGS[active];
}

export function t(k: StringKey): string {
  return TABLES[active]?.[k] ?? en[k];
}

export function cardsCount(n: number): string {
  return n === 1 ? t('cardsOne') : t('cardsMany').replace('{n}', String(n));
}

// Column header: "3 cards, 1 document" when documents are members.
export function memberCount(cards: number, docs: number): string {
  if (!docs) return cardsCount(cards);
  const d = docs === 1 ? t('docsOne') : t('docsMany').replace('{n}', String(docs));
  return `${cardsCount(cards)}, ${d}`;
}

export function boardsCount(n: number): string {
  return n === 1 ? t('boardsOne') : t('boardsMany').replace('{n}', String(n));
}

export function wordsText(n: number): string {
  return n === 1 ? t('wordsOne') : t('wordsMany').replace('{n}', String(n));
}

export function dayNames(): string[] {
  const fmt = new Intl.DateTimeFormat(langTag(), { weekday: 'narrow' });
  // 2020-06-07 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2020, 5, 7 + i)));
}

export function monthName(m: number): string {
  return new Intl.DateTimeFormat(langTag(), { month: 'long' }).format(new Date(2020, m, 1));
}

function shortDate(ts: number): string {
  return new Intl.DateTimeFormat(langTag(), { month: 'short', day: 'numeric' }).format(new Date(ts));
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 45000) return t('justNow');
  const rtf = new Intl.RelativeTimeFormat(langTag(), { numeric: 'always' });
  const m = Math.round(diff / 60000);
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.round(h / 24);
  if (d < 7) return rtf.format(-d, 'day');
  return shortDate(ts);
}

export function relDue(ts: number): string {
  const dayMs = 86400000;
  const a = new Date(ts);
  const b = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(a) - startOf(b)) / dayMs);
  if (diff > 21 || diff < -21) return t('dueDate').replace('{date}', shortDate(ts));
  const rtf = new Intl.RelativeTimeFormat(langTag(), { numeric: 'auto' });
  return t('dueRel').replace('{rel}', rtf.format(diff, 'day'));
}
