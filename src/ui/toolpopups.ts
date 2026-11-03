import type { ID, Label, PresentOpts } from '../state/schema';
import { t } from '../strings';
import { ICONS } from './icons';
import { closeToolPopup, openToolPopup, type ToolPopup } from './popup';
import { HIGHLIGHTS, TEXT_COLORS, type BlockStyle } from './richtext';

const CARD_COLORS = [
  '#fdebee',
  '#fdf2e0',
  '#fef6d0',
  '#e9f5ec',
  '#e8f0fe',
  '#f3eafd',
  '#dff1ef',
  '#efefe9',
];

export const LABEL_COLORS = [
  '#d6508f',
  '#e8734a',
  '#d9a62e',
  '#5f9e5f',
  '#3d84e0',
  '#8a5fd6',
  '#38a3a5',
  '#8d8d7a',
];

const EMOJI_GROUPS: { name: string; items: { e: string; k: string }[] }[] = [
  {
    name: 'Reactions',
    items: [
      { e: '👍', k: 'thumbs up yes like approve' },
      { e: '👎', k: 'thumbs down no dislike' },
      { e: '❤️', k: 'heart love' },
      { e: '🎉', k: 'party celebrate congrats tada' },
      { e: '🔥', k: 'fire hot lit' },
      { e: '👀', k: 'eyes look see watch' },
      { e: '✅', k: 'check done tick' },
      { e: '⭐', k: 'star favorite' },
      { e: '💡', k: 'idea bulb light' },
      { e: '🙌', k: 'hands raised praise hooray' },
      { e: '👏', k: 'clap applause' },
      { e: '💯', k: 'hundred perfect score' },
    ],
  },
  {
    name: 'Faces',
    items: [
      { e: '😄', k: 'smile happy grin' },
      { e: '😂', k: 'laugh joy funny' },
      { e: '😊', k: 'smile blush pleased' },
      { e: '😍', k: 'love heart eyes' },
      { e: '🤔', k: 'think hmm question' },
      { e: '😮', k: 'wow surprised mouth' },
      { e: '😢', k: 'sad cry tear' },
      { e: '😅', k: 'sweat nervous laugh' },
      { e: '🙃', k: 'upside down silly' },
      { e: '😴', k: 'sleep tired zzz' },
      { e: '🤯', k: 'mind blown explode' },
      { e: '😎', k: 'cool sunglasses' },
    ],
  },
  {
    name: 'Things',
    items: [
      { e: '🚀', k: 'rocket launch ship' },
      { e: '🎯', k: 'target goal dart' },
      { e: '📌', k: 'pin pushpin' },
      { e: '📎', k: 'paperclip attach' },
      { e: '⏰', k: 'alarm clock time deadline' },
      { e: '🐛', k: 'bug issue' },
      { e: '🧪', k: 'test experiment beaker' },
      { e: '🎨', k: 'art palette design' },
      { e: '🗺️', k: 'map world' },
      { e: '🏆', k: 'trophy win award' },
      { e: '⚠️', k: 'warning alert' },
      { e: '❓', k: 'question help' },
    ],
  },
  {
    name: 'Nature',
    items: [
      { e: '🌱', k: 'plant seed grow sprout' },
      { e: '🌲', k: 'tree evergreen forest' },
      { e: '🌵', k: 'cactus desert' },
      { e: '🌊', k: 'wave ocean water' },
      { e: '☀️', k: 'sun sunny day' },
      { e: '🌙', k: 'moon night' },
      { e: '⛰️', k: 'mountain peak' },
      { e: '🐈', k: 'cat' },
      { e: '🐕', k: 'dog' },
      { e: '🦊', k: 'fox' },
      { e: '🍄', k: 'mushroom' },
      { e: '🌸', k: 'flower blossom cherry' },
    ],
  },
];

// Emojis that accept a Fitzpatrick skin-tone modifier.
const TONEABLE = new Set(['👍', '👎', '🙌', '👏']);
const TONES = ['', '🏻', '🏼', '🏽', '🏾', '🏿'];

function baseEmoji(e: string): string {
  for (const m of TONES.slice(1)) {
    if (e.endsWith(m)) return e.slice(0, -m.length);
  }
  return e;
}

export function openColorPopup(anchor: HTMLElement, onPick: (color: string | undefined) => void): ToolPopup {
  const node = document.createElement('div');
  node.className = 'cp-body';
  const grid = document.createElement('div');
  grid.className = 'cp-grid';
  for (const c of CARD_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cp-swatch';
    b.style.background = c;
    b.title = c;    b.setAttribute('aria-label', c);
    b.addEventListener('click', () => onPick(c));
    grid.appendChild(b);
  }
  const custom = document.createElement('label');
  custom.className = 'cp-swatch cp-custom';
  custom.title = t('colorCustom');  custom.setAttribute('aria-label', t('colorCustom'));
  const well = document.createElement('input');
  well.type = 'color';
  well.name = 'custom-color';
  well.value = '#fdf2e0';
  well.addEventListener('input', () => onPick(well.value));
  custom.appendChild(well);
  grid.appendChild(custom);
  const def = document.createElement('button');
  def.type = 'button';
  def.className = 'pop-row';
  def.textContent = t('colorDefault');
  def.addEventListener('click', () => onPick(undefined));
  node.append(grid, def);
  return openToolPopup(anchor, node);
}

interface LabelsApi {
  labels(): Label[];
  applied(id: ID): 'all' | 'some' | 'none';
  onToggle(id: ID): void;
  onCreate(name: string): void;
  onDelete(id: ID): void;
}

export function openLabelsPopup(anchor: HTMLElement, api: LabelsApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'lp-body';
  const list = document.createElement('div');
  list.className = 'lp-list';

  function renderList() {
    list.textContent = '';
    for (const label of api.labels()) {
      const row = document.createElement('label');
      row.className = 'lp-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.name = 'label-toggle';
      const state = api.applied(label.id);
      box.checked = state === 'all';
      box.indeterminate = state === 'some';
      box.addEventListener('change', () => {
        api.onToggle(label.id);
        renderList();
      });
      const dot = document.createElement('span');
      dot.className = 'lp-dot';
      dot.style.background = label.color;
      const name = document.createElement('span');
      name.className = 'lp-name';
      name.textContent = label.name;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'lp-del';
      del.innerHTML = ICONS.close;
      del.title = t('deleteLabel');      del.setAttribute('aria-label', t('deleteLabel'));
      del.addEventListener('click', (e) => {
        e.preventDefault();
        api.onDelete(label.id);
        renderList();
      });
      row.append(box, dot, name, del);
      list.appendChild(row);
    }
    if (!api.labels().length) {
      const empty = document.createElement('div');
      empty.className = 'lp-empty';
      empty.textContent = t('noLabels');
      list.appendChild(empty);
    }
  }

  const add = document.createElement('div');
  add.className = 'lp-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'new-label';
  input.placeholder = t('labelNamePh');
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) {
      api.onCreate(input.value.trim());
      input.value = '';
      renderList();
    }
  });
  add.appendChild(input);
  node.append(list, add);
  renderList();
  return openToolPopup(anchor, node);
}

export function openReactionsPopup(
  anchor: HTMLElement | DOMRect,
  active: () => Set<string>,
  onToggle: (emoji: string) => void,
): ToolPopup {
  const node = document.createElement('div');
  node.className = 'rp-body';

  const search = document.createElement('input');
  search.type = 'text';
  search.name = 'reaction-search';
  search.className = 'rp-search';
  search.placeholder = t('reactSearchPh');
  const toneRow = document.createElement('div');
  toneRow.className = 'rp-tones';
  const list = document.createElement('div');
  list.className = 'rp-list';
  node.append(search, toneRow, list);

  let tone = '';

  function render() {
    list.textContent = '';
    const act = active();
    const bases = new Set([...act].map(baseEmoji));
    const q = search.value.trim().toLowerCase();
    for (const g of EMOJI_GROUPS) {
      const items = g.items.filter((it) => !q || it.k.includes(q) || it.e.includes(q));
      if (!items.length) continue;
      const head = document.createElement('div');
      head.className = 'rp-group';
      head.textContent = g.name;
      const grid = document.createElement('div');
      grid.className = 'rp-grid';
      for (const it of items) {
        const shown = tone && TONEABLE.has(it.e) ? it.e + tone : it.e;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rp-emoji';
        b.textContent = shown;
        b.classList.toggle('on', act.has(shown) || bases.has(it.e));
        b.addEventListener('click', () => {
          onToggle(shown);
          render();
        });
        grid.appendChild(b);
      }
      list.append(head, grid);
    }
    if (!list.children.length) {
      const none = document.createElement('div');
      none.className = 'rp-group';
      none.textContent = t('iconNone');
      list.appendChild(none);
    }
  }

  TONES.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rp-tone';
    b.textContent = m ? `👋${m}` : '👋';
    b.title = t('reactTone');    b.setAttribute('aria-label', t('reactTone'));
    b.classList.toggle('on', m === tone);
    b.addEventListener('click', () => {
      tone = m;
      toneRow.querySelectorAll('.rp-tone').forEach((x) => {
        x.classList.remove('on');
      });
      b.classList.add('on');
      render();
    });
    toneRow.appendChild(b);
  });

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeToolPopup();
  });
  render();
  const pop = openToolPopup(anchor, node);
  if (!(anchor instanceof DOMRect)) search.focus();
  return pop;
}

export interface MenuItem {
  label: string;
  icon?: string;
  checked?: boolean;
  hint?: string;
  onPick(): void;
}

export function openMenuPopup(anchor: HTMLElement, items: MenuItem[], keepSelection = false): ToolPopup {
  const node = document.createElement('div');
  node.className = 'menu-body';
  if (keepSelection) node.addEventListener('pointerdown', (e) => e.preventDefault());
  const pop = openToolPopup(anchor, node);
  for (const item of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pop-row';
    if (item.icon) {
      const ic = document.createElement('span');
      ic.className = 'pop-icon';
      ic.innerHTML = item.icon;
      row.appendChild(ic);
    }
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = item.label;
    row.appendChild(lab);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'pop-hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    if (item.checked) {
      const ck = document.createElement('span');
      ck.className = 'pop-check';
      ck.innerHTML = ICONS.check;
      row.appendChild(ck);
    }
    row.addEventListener('click', () => {
      pop.close();
      item.onPick();
    });
    node.appendChild(row);
  }
  return pop;
}

interface TextStyleApi {
  current(): BlockStyle | null;
  onStyle(s: BlockStyle): void;
  onColor(c: string | null): void;
  onHighlight(c: string | null): void;
}

const STYLE_ROWS: [BlockStyle, string][] = [
  ['h2', t('styleLarge')],
  ['h3', t('styleHeading')],
  ['p', t('styleNormal')],
  ['small', t('styleSmall')],
  ['code', t('styleCode')],
  ['callout', t('styleCallout')],
  ['quote', t('styleQuote')],
];

function swatchRow(colors: (string | null)[], onPick: (c: string | null) => void): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'ts-swatches';
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cp-swatch';
    if (c === null) b.classList.add('cp-none');
    else b.style.background = c;
    b.title = c ?? t('colorDefault');    b.setAttribute('aria-label', c ?? t('colorDefault'));
    b.addEventListener('click', () => onPick(c));
    grid.appendChild(b);
  }
  return grid;
}

// Edit-rail text style popup: block style rows + colour and highlight rows.
export function openTextStylePopup(anchor: HTMLElement, api: TextStyleApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'ts-body';
  // Keep the editing surface's selection while swatches/rows are clicked.
  node.addEventListener('pointerdown', (e) => e.preventDefault());
  const pop = openToolPopup(anchor, node);
  const cur = api.current();
  for (const [style, label] of STYLE_ROWS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pop-row';
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = label;
    row.appendChild(lab);
    if (cur === style) {
      const ck = document.createElement('span');
      ck.className = 'pop-check';
      ck.innerHTML = ICONS.check;
      row.appendChild(ck);
    }
    row.addEventListener('click', () => {
      api.onStyle(style);
      pop.close();
    });
    node.appendChild(row);
  }
  const colorHead = document.createElement('div');
  colorHead.className = 'ts-head';
  colorHead.textContent = t('textColor');
  const hlHead = document.createElement('div');
  hlHead.className = 'ts-head';
  hlHead.textContent = t('textHighlight');
  node.append(colorHead, swatchRow(TEXT_COLORS, api.onColor), hlHead, swatchRow(HIGHLIGHTS, api.onHighlight));
  return pop;
}

interface CellAlignApi {
  h: string | undefined;
  v: string | undefined;
  onH(h: 'left' | 'center' | 'right'): void;
  onV(v: 'top' | 'middle' | 'bottom'): void;
}

// Table cell alignment: two groups, horizontal then vertical.
export function openCellAlignPopup(anchor: HTMLElement, api: CellAlignApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'menu-body';
  const pop = openToolPopup(anchor, node);
  const group = (label: string, rows: [string, string, () => void][]) => {
    const head = document.createElement('div');
    head.className = 'ts-head';
    head.textContent = label;
    node.appendChild(head);
    for (const [text, cur, pick] of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pop-row';
      const lab = document.createElement('span');
      lab.className = 'pop-label';
      lab.textContent = text;
      row.appendChild(lab);
      if (cur) {
        const ck = document.createElement('span');
        ck.className = 'pop-check';
        ck.innerHTML = ICONS.check;
        row.appendChild(ck);
      }
      row.addEventListener('click', () => {
        pop.close();
        pick();
      });
      node.appendChild(row);
    }
  };
  const h = api.h ?? 'left';
  const v = api.v ?? 'top';
  group(t('alignHGroup'), [
    [t('alignLeft'), h === 'left' ? 'x' : '', () => api.onH('left')],
    [t('alignCenter'), h === 'center' ? 'x' : '', () => api.onH('center')],
    [t('alignRight'), h === 'right' ? 'x' : '', () => api.onH('right')],
  ]);
  group(t('alignVGroup'), [
    [t('alignTop'), v === 'top' ? 'x' : '', () => api.onV('top')],
    [t('alignMiddle'), v === 'middle' ? 'x' : '', () => api.onV('middle')],
    [t('alignBottom'), v === 'bottom' ? 'x' : '', () => api.onV('bottom')],
  ]);
  return pop;
}

// Single-field hyperlink popup; Enter commits an anchor around the selection.
export function openLinkPopup(anchor: HTMLElement | DOMRect, onCommit: (url: string) => void): ToolPopup {
  const node = document.createElement('div');
  node.className = 'lk-body';
  const input = document.createElement('input');
  input.type = 'url';
  input.name = 'link-url';
  input.className = 'lk-input';
  input.placeholder = t('linkPh');
  node.appendChild(input);
  const pop = openToolPopup(anchor, node);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const v = input.value.trim();
      if (v) onCommit(v);
      pop.close();
    }
  });
  input.focus();
  return pop;
}

// Link info popup: shows the card's URL with a copy row.
export function openLinkInfoPopup(anchor: HTMLElement, url: string, onCopy: () => void): ToolPopup {
  const node = document.createElement('div');
  node.className = 'li-body';
  const text = document.createElement('div');
  text.className = 'li-url';
  text.textContent = url;
  text.title = url;  text.setAttribute('aria-label', url);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'pop-row';
  const ic = document.createElement('span');
  ic.className = 'pop-icon';
  ic.innerHTML = ICONS.txLink;
  const lab = document.createElement('span');
  lab.className = 'pop-label';
  lab.textContent = t('copyUrl');
  copy.append(ic, lab);
  copy.addEventListener('click', () => {
    onCopy();
    pop.close();
  });
  node.append(text, copy);
  const pop = openToolPopup(anchor, node);
  return pop;
}

interface ViewMenuApi {
  presentOpts(): PresentOpts;
  onToggle(key: keyof PresentOpts): void;
  grid(): boolean;
  onToggleGrid(): void;
  onPresent(): void;
}

// Topbar View menu: present entry, the per-board dot-grid toggle and
// the presentation toggles. Check rows keep the popup open and flip
// their check in place.
export function openViewMenu(anchor: HTMLElement, api: ViewMenuApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'menu-body';
  const pop = openToolPopup(anchor, node, true);

  const row = (label: string) => {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'pop-row';
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = label;
    r.appendChild(lab);
    node.appendChild(r);
    return r;
  };
  const toggleRow = (label: string, checked: () => boolean, onPick: () => void) => {
    const r = row(label);
    const ck = document.createElement('span');
    ck.className = 'pop-check';
    ck.innerHTML = ICONS.check;
    const sync = () => {
      ck.style.visibility = checked() ? 'visible' : 'hidden';
    };
    sync();
    r.appendChild(ck);
    r.addEventListener('click', () => {
      onPick();
      sync();
    });
  };

  const present = row(t('viewPresent'));
  const hint = document.createElement('span');
  hint.className = 'pop-hint';
  hint.textContent = 'Cmd+Opt+P';
  present.appendChild(hint);
  present.addEventListener('click', () => {
    pop.close();
    api.onPresent();
  });

  toggleRow(t('viewGrid'), api.grid, api.onToggleGrid);
  toggleRow(t('focusSelected'), () => !!api.presentOpts().focus, () => api.onToggle('focus'));
  toggleRow(t('hideComments'), () => !!api.presentOpts().comments, () => api.onToggle('comments'));
  toggleRow(t('preventEditing'), () => !!api.presentOpts().edit, () => api.onToggle('edit'));

  return pop;
}

export interface HelpApi {
  onShortcuts(): void;
  onAbout(anchor: HTMLElement): void;
}

// Topbar help menu: shortcuts, issue reporting and About.
export function openHelpMenu(anchor: HTMLElement, api: HelpApi): ToolPopup {
  return openMenuPopup(anchor, [
    { label: t('shortcutsTitle'), hint: '/', onPick: () => api.onShortcuts() },
    {
      label: t('helpIssue'),
      onPick: () =>
        window.open('https://github.com/markoshaq/scatterboard/issues', '_blank', 'noopener'),
    },
    { label: t('setAbout'), onPick: () => api.onAbout(anchor) },
  ]);
}
