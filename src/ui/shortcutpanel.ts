import { t, type StringKey } from '../strings';
import { ICONS } from './icons';
import { popDismiss, pushDismiss } from './popup';

const ROWS: [string, StringKey][] = [
  ['/', 'shortcutsTitle'],
  ['Double-click', 'scNewNote'],
  ['Cmd+Return', 'scNewNoteBelow'],
  ['Space+drag', 'scPan'],
  ['Cmd+wheel', 'scZoom'],
  ['Cmd+F', 'scSearch'],
  ['Delete', 'scDelete'],
  ['Opt+`', 'scUnsorted'],
  ['Arrows', 'scNudge'],
  ['I', 'scEyedropper'],
  ['Cmd+Z / Cmd+Shift+Z', 'scUndoRedo'],
  ['Cmd+A', 'scSelectAll'],
  ['Esc', 'scDeselect'],
  ['Cmd+D', 'scDuplicate'],
  ['Cmd+X / Cmd+C / Cmd+V', 'scCutCopyPaste'],
  ['Cmd+Opt+V', 'scPasteStyles'],
  ['Cmd+Shift+Down / Up', 'scReorderZ'],
  ['Cmd+[ / Cmd+]', 'scBackFwd'],
  ['Cmd+double-click', 'scBoardNewTab'],
  ['Cmd+U', 'scParentBoard'],
  ['Z', 'scFit'],
  ['Cmd+= / Cmd+- / Cmd+0', 'scZoomInOut'],
  ['Cmd+Opt+P', 'scPresent'],
  ['Cmd+Shift+D', 'scDark'],
  ['Cmd+Shift+< / >', 'scUiScale'],
  ['Opt+Return', 'scTodoTitle'],
  ['Cmd+Shift+1', 'scTodoDue'],
  ['Cmd+B / Cmd+I / Cmd+U', 'scBoldItalic'],
  ['Cmd+Shift+X', 'scStrike'],
  ['Cmd+K', 'scLink'],
  ['Cmd+J', 'scHighlight'],
  ['Cmd+Shift+1 / 2 / 0 / 9', 'scHeadings'],
  ['Cmd+>', 'scCodeBlock'],
  ['Cmd+"', 'scQuote'],
  ['Cmd+Shift+6', 'scCallout'],
  ['Cmd+\\', 'scCenter'],
  ['Cmd+Shift+U / Cmd+Shift+O', 'scLists'],
  ['Tab / Shift+Tab', 'scListIndent'],
  ['Opt+Up / Opt+Down', 'scTableRows'],
  ['Opt+Left / Opt+Right', 'scTableCols'],
  ['Shift+D', 'scDraw'],
  ['V / E / C / X', 'scDrawTools'],
  ['1-4', 'scDrawSizes'],
  ['Esc / Cmd+S', 'scDrawExit'],
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
    d.textContent = t(label);
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
