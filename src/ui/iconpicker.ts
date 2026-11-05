import { t } from '../strings';
import { haspopup, openToolPopup, type ToolPopup } from './popup';
import { letterIcons, recommendedIcons, searchIcons } from './boardicons';

interface IconPickerApi {
  title(): string;
  onPick(icon: string | undefined): void;
  onUpload(): void;
}

// Board icon picker (verified structure): search over our icon set,
// Recommended from title words, Letters & numbers, Upload an image.
export function openIconPicker(anchor: HTMLElement | DOMRect, api: IconPickerApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'bip-body';

  const input = document.createElement('input');
  input.name = 'icon-search';
  input.type = 'text';
  input.className = 'bip-search';
  input.placeholder = t('iconSearchPh');
  node.appendChild(input);

  const list = document.createElement('div');
  list.className = 'bip-list';
  node.appendChild(list);

  const foot = document.createElement('div');
  foot.className = 'bip-foot';
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'pop-row';
  const upLab = document.createElement('span');
  upLab.className = 'pop-label';
  upLab.textContent = t('iconUpload');
  upload.appendChild(upLab);
  upload.addEventListener('click', () => {
    // onUpload is synchronous (opens a file picker): the picker's job
    // is done once it fires, so close instead of leaving a stale grid.
    api.onUpload();
    pop.close();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'pop-row';
  const clLab = document.createElement('span');
  clLab.className = 'pop-label';
  clLab.textContent = t('iconClear');
  clear.appendChild(clLab);
  clear.addEventListener('click', () => api.onPick(undefined));
  foot.append(upload, clear);
  node.appendChild(foot);

  function iconBtn(iconId: string, svg: string): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bip-ic';
    b.innerHTML = svg;
    b.title = iconId;    b.setAttribute('aria-label', iconId);
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', () => api.onPick(`g:${iconId}`));
    return b;
  }

  function charBtn(text: string): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bip-ic bip-mono';
    b.textContent = text;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', () => api.onPick(`c:${text}`));
    return b;
  }

  function section(label: string): { head: HTMLElement; grid: HTMLElement } {
    const head = document.createElement('div');
    head.className = 'bip-group';
    head.textContent = label;
    head.id = `bip-g-${label.replace(/\W+/g, '-')}`;
    const grid = document.createElement('div');
    grid.className = 'bip-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-labelledby', head.id);
    list.append(head, grid);
    return { head, grid };
  }

  function render() {
    list.textContent = '';
    const q = input.value.trim();
    if (q) {
      const { grid } = section(t('iconResults'));
      for (const ic of searchIcons(q)) grid.appendChild(iconBtn(ic.id, ic.svg));
      if (!grid.children.length) grid.appendChild(Object.assign(document.createElement('div'), { className: 'bip-empty', textContent: t('iconNone') }));
      return;
    }
    const rec = recommendedIcons(api.title());
    if (rec.length) {
      const { grid } = section(t('iconRecommended'));
      for (const ic of rec) grid.appendChild(iconBtn(ic.id, ic.svg));
    }
    const letters = section(t('iconLetters'));
    for (const c of letterIcons(api.title())) letters.grid.appendChild(charBtn(c));
    const all = section(t('iconAll'));
    for (const ic of searchIcons('')) all.grid.appendChild(iconBtn(ic.id, ic.svg));
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => e.stopPropagation());
  render();
  haspopup(anchor, 'dialog');
  const pop = openToolPopup(anchor, node);
  input.focus();
  return pop;
}
