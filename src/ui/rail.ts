import type { Element, ElementType, EmbedKind } from '../state/schema';
import { documentDoc } from '../state/schema';
import { t } from '../strings';
import { ICONS } from './icons';
import { dragGhost } from './util';

export type ToolId =
  | 'color'
  | 'labels'
  | 'reactions'
  | 'comment'
  | 'title'
  | 'icon'
  | 'more'
  | 'align'
  | 'distribute'
  | 'line-start'
  | 'line-end'
  | 'line-label'
  | 'line-dashed'
  | 'line-weight'
  | 'show-value'
  | 'to-board'
  | 'preview'
  | 'link-info'
  | 'rename'
  | 'caption'
  | 'tx-style'
  | 'tx-bold'
  | 'tx-italic'
  | 'tx-strike'
  | 'tx-bullet'
  | 'tx-numbered'
  | 'tx-center'
  | 'tx-link'
  | 'tx-code'
  | 'tx-underline'
  | 'due'
  | 'assign'
  | 'card-view'
  | 'draw-on'
  | 'img-edit'
  | 'img-bg'
  | 'cell-type'
  | 'cell-color'
  | 'cell-formula'
  | 'cell-align'
  | 'cell-addcol'
  | 'cell-addrow';

interface RailEvents {
  onDrop: (type: ElementType, at: { clientX: number; clientY: number } | null, kind?: EmbedKind) => void;
  onDropHint: (ev: PointerEvent | null, type: ElementType) => void;
  onTool: (id: ToolId, anchor: HTMLElement) => void;
  onTrash: () => void;
  onBoardColor: (hex: string) => void;
  onAddImage: () => void;
  onUpload: () => void;
  onDraw: () => void;
  onCapture: (anchor: HTMLElement) => void;
}

interface RailItem {
  type: ElementType;
  label: string;
  icon: string;
  kind?: EmbedKind;
}

interface CreateItem extends RailItem {
  // Customization key: the embed kinds get their own entries.
  key: string;
}

// Every create type in default palette order. All of them render and
// the rail scrolls when they overflow; prefs reorder and hide entries
// from this list.
export const CREATE_ITEMS: CreateItem[] = [
  { key: 'note', type: 'note', label: t('railNote'), icon: ICONS.note },
  { key: 'todo', type: 'todo', label: t('railTodo'), icon: ICONS.todo },
  { key: 'heading', type: 'heading', label: t('railHeading'), icon: ICONS.heading },
  { key: 'line', type: 'line', label: t('railLine'), icon: ICONS.line },
  { key: 'table', type: 'table', label: t('railTable'), icon: ICONS.table },
  { key: 'column', type: 'column', label: t('railColumn'), icon: ICONS.column },
  { key: 'document', type: 'document', label: t('railDocument'), icon: ICONS.document },
  { key: 'sketch', type: 'sketch', label: t('railSketch'), icon: ICONS.sketch },
  { key: 'swatch', type: 'swatch', label: t('railColor'), icon: ICONS.swatch },
  { key: 'comment', type: 'comment', label: t('railComment'), icon: ICONS.comment },
  { key: 'board', type: 'board', label: t('railBoard'), icon: ICONS.board },
  { key: 'link', type: 'link', label: t('railLink'), icon: ICONS.link },
  { key: 'embed:audio', type: 'embed', kind: 'audio', label: t('railAudio'), icon: ICONS.audio },
  { key: 'embed:map', type: 'embed', kind: 'map', label: t('railMap'), icon: ICONS.map },
  { key: 'embed:video', type: 'embed', kind: 'video', label: t('railVideo'), icon: ICONS.video },
];

// Ordered, visible palette items: prefs order wins, unknown keys drop,
// missing keys append, hidden keys leave the palette entirely.
function paletteItems(order: string[] | undefined, hidden: string[] | undefined): CreateItem[] {
  const byKey = new Map(CREATE_ITEMS.map((i) => [i.key, i]));
  const hide = new Set(hidden ?? []);
  const seen = new Set<string>();
  const out: CreateItem[] = [];
  for (const key of order ?? []) {
    const it = byKey.get(key);
    if (it && !seen.has(key)) {
      seen.add(key);
      if (!hide.has(key)) out.push(it);
    }
  }
  for (const it of CREATE_ITEMS) {
    if (!seen.has(it.key)) {
      seen.add(it.key);
      if (!hide.has(it.key)) out.push(it);
    }
  }
  return out;
}

const TOOL_DEFS: Record<ToolId, { label: string; icon: string }> = {
  color: { label: t('toolColor'), icon: ICONS.color },
  labels: { label: t('toolLabels'), icon: ICONS.labels },
  reactions: { label: t('toolReactions'), icon: ICONS.reactions },
  comment: { label: t('toolComment'), icon: ICONS.comment },
  title: { label: t('toolTitle'), icon: ICONS.title },
  icon: { label: t('toolIcon'), icon: ICONS.icon },
  more: { label: t('toolMore'), icon: ICONS.more },
  align: { label: t('toolAlign'), icon: ICONS.align },
  distribute: { label: t('toolDistribute'), icon: ICONS.distribute },
  'line-start': { label: t('lineStart'), icon: ICONS.lineStart },
  'line-end': { label: t('lineEnd'), icon: ICONS.lineEnd },
  'line-label': { label: t('lineLabel'), icon: ICONS.labels },
  'line-dashed': { label: t('lineDashed'), icon: ICONS.dashed },
  'line-weight': { label: t('lineWeight'), icon: ICONS.weight },
  'show-value': { label: t('showValue'), icon: ICONS.showValue },
  'to-board': { label: t('toBoard'), icon: ICONS.toBoard },
  preview: { label: t('toolPreview'), icon: ICONS.showValue },
  'link-info': { label: t('toolLinkInfo'), icon: ICONS.info },
  rename: { label: t('toolRename'), icon: ICONS.title },
  caption: { label: t('toolCaption'), icon: ICONS.caption },
  'tx-style': { label: t('toolTextStyle'), icon: ICONS.txStyle },
  'tx-bold': { label: t('toolBold'), icon: ICONS.txBold },
  'tx-italic': { label: t('toolItalic'), icon: ICONS.txItalic },
  'tx-strike': { label: t('toolStrike'), icon: ICONS.txStrike },
  'tx-bullet': { label: t('toolBullet'), icon: ICONS.txBullet },
  'tx-numbered': { label: t('toolNumbered'), icon: ICONS.txNumbered },
  'tx-center': { label: t('toolCenter'), icon: ICONS.txCenter },
  'tx-link': { label: t('toolLink'), icon: ICONS.txLink },
  'tx-code': { label: t('toolInlineCode'), icon: ICONS.txCode },
  'tx-underline': { label: t('toolUnderline'), icon: ICONS.txUnderline },
  due: { label: t('toolDueDate'), icon: ICONS.txDue },
  assign: { label: t('toolAssign'), icon: ICONS.txAssign },
  'card-view': { label: t('toolCardView'), icon: ICONS.cardView },
  'draw-on': { label: t('toolDrawOn'), icon: ICONS.draw },
  'img-edit': { label: t('toolImgEdit'), icon: ICONS.crop },
  'img-bg': { label: t('toolImgBg'), icon: ICONS.matte },
  'cell-type': { label: t('toolCellType'), icon: ICONS.cellType },
  'cell-color': { label: t('toolCellColor'), icon: ICONS.color },
  'cell-formula': { label: t('toolFormula'), icon: ICONS.formula },
  'cell-align': { label: t('toolCellAlign'), icon: ICONS.txCenter },
  'cell-addcol': { label: t('toolAddColumn'), icon: ICONS.addCol },
  'cell-addrow': { label: t('toolAddRow'), icon: ICONS.addRow },
};

const UNIVERSAL: ToolId[] = ['color', 'labels', 'title', 'comment', 'reactions'];

const SINGLE_TOOLS: Record<ElementType, ToolId[]> = {
  note: [...UNIVERSAL, 'more'],
  todo: [...UNIVERSAL, 'more'],
  heading: [...UNIVERSAL, 'more'],
  board: ['color', 'icon', 'labels', 'reactions', 'comment', 'title', 'more'],
  swatch: [...UNIVERSAL, 'show-value', 'more'],
  column: [...UNIVERSAL, 'to-board', 'more'],
  comment: ['color', 'more'],
  line: ['color', 'line-start', 'line-end', 'line-label', 'line-dashed', 'line-weight', 'more'],
  link: [],
  embed: [],
  image: ['color', 'labels', 'reactions', 'comment', 'draw-on', 'img-edit', 'img-bg', 'caption', 'more'],
  file: ['color', 'more'],
  document: [],
  sketch: ['color', 'labels', 'reactions', 'comment', 'more'],
  annotation: ['more'],
  table: [...UNIVERSAL, 'caption', 'more'],
};

function linkUrl(el: Element): string {
  const c = el.content;
  if ('link' in c) return c.link.url;
  if ('embed' in c) return c.embed.url;
  return '';
}

// Link-family rail: Preview + Link info appear once a URL is set;
// Rename + Caption ride along from empty.
function linkFamilyTools(el: Element): ToolId[] {
  const tools: ToolId[] = ['color', 'labels', 'reactions', 'comment'];
  if (linkUrl(el)) tools.push('preview', 'link-info');
  tools.push('rename', 'caption', 'more');
  return tools;
}

// Document rail differs per displayMode (verified): icon mode is a
// trimmed set; detail adds labels/reactions/comment/caption and the
// Convert to Note item lives in More.
function documentTools(el: Element): ToolId[] {
  if (documentDoc(el)?.displayMode === 'detail') {
    return ['color', 'labels', 'reactions', 'comment', 'card-view', 'rename', 'caption', 'more'];
  }
  return ['color', 'card-view', 'rename', 'more'];
}

function singleTools(el: Element): ToolId[] {
  if (el.type === 'link' || el.type === 'embed') return linkFamilyTools(el);
  if (el.type === 'document') return documentTools(el);
  return SINGLE_TOOLS[el.type];
}

// Per-type edit-mode rails. The pinned Trash button below counts as the
// trailing rail item in edit mode; it deletes the edited card.
const EDIT_TOOLS: Partial<Record<ElementType, ToolId[]>> = {
  note: ['tx-style', 'tx-bold', 'tx-italic', 'tx-strike', 'tx-bullet', 'tx-numbered', 'tx-center', 'tx-link', 'comment', 'more'],
  heading: ['tx-style', 'tx-bold', 'tx-italic', 'tx-strike', 'tx-link', 'more'],
  todo: ['color', 'title', 'reactions', 'due', 'assign', 'labels'],
  // Cell rail (verified): applies to the focused cell. Shows only while
  // a cell is focused; the app reports null for field edits.
  table: ['tx-style', 'cell-type', 'cell-color', 'cell-formula', 'cell-align', 'cell-addcol', 'cell-addrow', 'more'],
};

export function editRailType(type: ElementType): boolean {
  return EDIT_TOOLS[type] !== undefined;
}

function toolsFor(sel: Element[]): ToolId[] {
  if (sel.length === 1) return singleTools(sel[0]!);
  const tools: ToolId[] = ['color', 'align'];
  if (sel.filter((e) => e.type !== 'line' && e.parentId === null).length >= 3) tools.push('distribute');
  tools.push('more');
  return tools;
}

// The rail signature must change whenever the rendered tool set could
// change; for link/embed the URL-set state flips Preview/Link info and
// for document the displayMode swaps the whole tool set.
function sigFor(sel: Element[]): string {
  if (sel.length !== 1) return '';
  const el = sel[0]!;
  if (el.type === 'link' || el.type === 'embed') return linkUrl(el) ? ':u' : ':e';
  if (el.type === 'document') return documentDoc(el)?.displayMode === 'detail' ? ':d' : ':i';
  return '';
}

const DEFAULT_WELL = '#ebedee';

export class Rail {
  private itemsEl: HTMLElement;
  private well: HTMLInputElement;
  private events: RailEvents;
  private signature = '';
  private toolBtns = new Map<ToolId, HTMLButtonElement>();
  private disabled = new Set<ToolId>();
  private palette: { order?: string[] | undefined; hidden?: string[] | undefined; sig: string } = { sig: '' };

  constructor(root: HTMLElement, events: RailEvents) {
    this.events = events;
    const rail = document.createElement('div');
    rail.className = 'rail';
    this.itemsEl = document.createElement('div');
    this.itemsEl.className = 'rail-items';
    const trash = document.createElement('button');
    trash.type = 'button';
    trash.className = 'rail-item rail-trash';
    trash.innerHTML = ICONS.trash;
    const trashLab = document.createElement('span');
    trashLab.textContent = t('toolTrash');
    trash.appendChild(trashLab);
    trash.addEventListener('click', () => this.events.onTrash());
    this.well = document.createElement('input');
    this.well.name = 'board-color';
    this.well.type = 'color';
    this.well.className = 'rail-well';
    this.well.title = t('boardColor');    this.well.setAttribute('aria-label', t('boardColor'));
    this.well.value = DEFAULT_WELL;
    this.well.addEventListener('input', () => this.events.onBoardColor(this.well.value));
    // Label the well: a bare colour input reads as decoration, not as
    // the accent-colour picker for new cards.
    const wellWrap = document.createElement('div');
    wellWrap.className = 'rail-wellwrap';
    const wellLab = document.createElement('span');
    wellLab.textContent = t('boardColor');
    wellWrap.append(this.well, wellLab);
    rail.append(this.itemsEl, wellWrap);
    // The can sits outside .rail: during a card-over-trash drag it drops
    // under the lifted viewport while the rest of the rail stays on top.
    root.append(rail, trash);
    // Overflow padding clears the pinned trash, so re-check on resize.
    new ResizeObserver(() => this.syncScrolls()).observe(this.itemsEl);
    this.itemsEl.addEventListener('scroll', () => this.syncScrolls());
    this.sync([], null);
  }

  // Palette customization (order + hidden keys) from workspace prefs;
  // changing it invalidates the create-mode signature so the rail
  // rebuilds on the next sync.
  setPalette(order: string[] | undefined, hidden: string[] | undefined) {
    const sig = `${(order ?? []).join(',')}|${(hidden ?? []).join(',')}`;
    if (sig === this.palette.sig) return;
    this.palette = { order, hidden, sig };
    this.signature = '';
  }

  // Re-renders only when the rail signature changes. editing is the element
  // whose edit session is open, or null.
  sync(sel: Element[], editing: Element | null) {
    const edit = editing && EDIT_TOOLS[editing.type] ? editing : null;
    const items = edit || sel.length ? null : paletteItems(this.palette.order, this.palette.hidden);
    const sig = edit
      ? `e:${edit.type}`
      : items
        ? `c${this.palette.sig}`
        : sel.length === 1
          ? `t:${sel[0]!.type}${sigFor(sel)}`
          : `m:${toolsFor(sel).join('.')}`;
    if (sig === this.signature) {
      this.syncScrolls();
      return;
    }
    this.signature = sig;
    this.itemsEl.textContent = '';
    this.toolBtns.clear();
    if (edit) {
      for (const id of EDIT_TOOLS[edit.type]!) this.itemsEl.appendChild(this.toolButton(id));
    } else if (items) {
      for (const item of items) this.itemsEl.appendChild(this.paletteButton(item));
      const div = document.createElement('div');
      div.className = 'rail-div';
      this.itemsEl.appendChild(div);
      this.itemsEl.appendChild(this.actionButton(ICONS.image, t('addImage'), () => this.events.onAddImage()));
      this.itemsEl.appendChild(this.actionButton(ICONS.upload, t('uploadFile'), () => this.events.onUpload()));
      this.itemsEl.appendChild(this.actionButton(ICONS.draw, t('railDraw'), () => this.events.onDraw()));
      this.itemsEl.appendChild(
        this.actionButton(ICONS.inbox, t('railCapture'), () => this.events.onCapture(this.itemsEl)),
      );
    } else {
      for (const id of toolsFor(sel)) this.itemsEl.appendChild(this.toolButton(id));
    }
    this.applyDisabled();
    this.syncScrolls();
  }

  // Faded edges tell the user the list scrolls: top once scrolled,
  // bottom whenever more items sit below the fold.
  private syncScrolls() {
    const el = this.itemsEl;
    el.classList.toggle('scrolled-top', el.scrollTop > 0);
    el.classList.toggle('scrolled-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }

  // Grey-out tools that need context (e.g. Link/Comment need a text
  // selection). Re-applied on every selectionchange while editing.
  setDisabled(ids: Iterable<ToolId>) {
    this.disabled = new Set(ids);
    this.applyDisabled();
  }

  private applyDisabled() {
    for (const [id, btn] of this.toolBtns) btn.disabled = this.disabled.has(id);
  }

  setBoardColor(color: string | undefined) {
    this.well.value = color ?? DEFAULT_WELL;
  }

  private paletteButton(item: RailItem): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-item';
    btn.title = item.label;    btn.setAttribute('aria-label', item.label);
    btn.innerHTML = item.icon;
    const lab = document.createElement('span');
    lab.textContent = item.label;
    btn.appendChild(lab);
    btn.addEventListener('pointerdown', (e) => {
      dragGhost(
        e,
        () => {
          const g = document.createElement('div');
          g.innerHTML = `${item.icon}<span></span>`;
          g.querySelector('span')!.textContent = item.label;
          return g;
        },
        (ev, moved) => {
          // A click (no drag) spawns the card at view center: drag is
          // not the only create gesture a first-time user will try.
          if (!moved) {
            this.events.onDrop(item.type, null, item.kind);
            return;
          }
          const over = document.elementFromPoint(ev.clientX, ev.clientY);
          if (over?.closest('.rail, .rail-trash')) return;
          this.events.onDrop(item.type, ev, item.kind);
        },
        (ev) => this.events.onDropHint(ev, item.type),
      );
    });
    // Keyboard activation arrives as a click with detail 0; pointer
    // clicks already ran through the pointerup path above.
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) this.events.onDrop(item.type, null, item.kind);
    });
    return btn;
  }

  private actionButton(icon: string, label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-item rail-tool';
    btn.title = label;    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    const lab = document.createElement('span');
    lab.textContent = label;
    btn.appendChild(lab);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private toolButton(id: ToolId): HTMLElement {
    const def = TOOL_DEFS[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-item rail-tool';
    btn.title = def.label;    btn.setAttribute('aria-label', def.label);
    btn.innerHTML = def.icon;
    const lab = document.createElement('span');
    lab.textContent = def.label;
    btn.appendChild(lab);
    // Keep the editing surface's selection alive across tool clicks.
    btn.addEventListener('pointerdown', (e) => e.preventDefault());
    btn.addEventListener('click', () => this.events.onTool(id, btn));
    this.toolBtns.set(id, btn);
    return btn;
  }
}
