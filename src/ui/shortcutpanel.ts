import { t } from '../strings';
import { ICONS } from './icons';
import { popDismiss, pushDismiss } from './popup';

const ROWS: [string, string][] = [
  ['/', 'Keyboard shortcuts'],
  ['Double-click', 'New note'],
  ['Cmd+Return', 'New note below (while editing)'],
  ['Space+drag', 'Pan'],
  ['Cmd+wheel', 'Zoom'],
  ['Cmd+F', 'Search'],
  ['Delete', 'Delete selection'],
  ['Opt+`', 'Send to Unsorted'],
  ['Arrows', 'Nudge (Shift for 10px)'],
  ['I', 'Colour eyedropper'],
  ['Cmd+Z / Cmd+Shift+Z', 'Undo / redo'],
  ['Cmd+A', 'Select all'],
  ['Esc', 'Deselect'],
  ['Cmd+D', 'Duplicate (or Opt+drag)'],
  ['Cmd+X / Cmd+C / Cmd+V', 'Cut / copy / paste'],
  ['Cmd+Opt+V', 'Paste styles'],
  ['Cmd+Shift+Down / Up', 'Send to back / bring to front'],
  ['Cmd+[ / Cmd+]', 'Back / forward'],
  ['Cmd+double-click', 'Open board in new tab'],
  ['Cmd+U', 'Go to parent board'],
  ['Z', 'Scale to fit'],
  ['Cmd+= / Cmd+- / Cmd+0', 'Zoom in / out / 100%'],
  ['Cmd+Opt+P', 'Presentation mode'],
  ['Cmd+Shift+D', 'Dark mode'],
  ['Cmd+Shift+< / >', 'Interface scale'],
  ['Opt+Return', 'To-do title (while editing)'],
  ['Cmd+Shift+1', 'To-do due date (while editing)'],
  ['Cmd+B / Cmd+I / Cmd+U', 'Bold / italic / underline'],
  ['Cmd+Shift+X', 'Strikethrough'],
  ['Cmd+K', 'Link'],
  ['Cmd+J', 'Highlight'],
  ['Cmd+Shift+1 / 2 / 0 / 9', 'Large heading / heading / normal / small'],
  ['Cmd+>', 'Code block'],
  ['Cmd+"', 'Quote block'],
  ['Cmd+Shift+6', 'Callout'],
  ['Cmd+\\', 'Center text'],
  ['Cmd+Shift+U / Cmd+Shift+O', 'Bullet / numbered list'],
  ['Tab / Shift+Tab', 'Indent / outdent in lists'],
  ['Opt+Up / Opt+Down', 'Table: row above / below'],
  ['Opt+Left / Opt+Right', 'Table: column left / right'],
  ['Shift+D', 'Draw on the board'],
  ['V / E / C / X', 'Draw: select / eraser / colour / previous colour'],
  ['1-4', 'Draw: pen size'],
  ['Esc / Cmd+S', 'Draw: save and exit'],
];

export function openShortcutsPanel(): { close(): void } {
  const scrim = document.createElement('div');
  scrim.className = 'short-scrim';
  const box = document.createElement('div');
  box.className = 'short-box';
  const head = document.createElement('div');
  head.className = 'short-head';
  head.textContent = t('shortcutsTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sp-close';
  closeBtn.innerHTML = ICONS.close;
  head.appendChild(closeBtn);
  const list = document.createElement('div');
  list.className = 'short-list';
  for (const [keys, label] of ROWS) {
    const row = document.createElement('div');
    row.className = 'short-row';
    const k = document.createElement('span');
    k.className = 'short-keys';
    k.textContent = keys;
    const d = document.createElement('span');
    d.className = 'short-desc';
    d.textContent = label;
    row.append(k, d);
    list.appendChild(row);
  }
  box.append(head, list);
  scrim.appendChild(box);

  const handle = {
    close() {
      popDismiss(handle);
      scrim.remove();
    },
  };
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) handle.close();
  });
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  closeBtn.addEventListener('click', handle.close);
  document.body.appendChild(scrim);
  pushDismiss(handle);
  return handle;
}
