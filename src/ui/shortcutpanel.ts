import { t, type StringKey } from '../strings';
import { ICONS } from './icons';
import { cycleKeys, focusBack, outro, popDismiss, pushDismiss } from './popup';

// The shortcuts accept metaKey or ctrlKey; the labels name the
// platform's actual modifier.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const kbd = (s: string) => (MAC ? s : s.replace(/\bCmd\b/g, 'Ctrl').replace(/\bOpt\b/g, 'Alt'));

const SECTIONS: [StringKey, [string, StringKey][]][] = [
  ['setCanvas', [
    ['/', 'shortcutsTitle'],
    ['Space+drag', 'scPan'],
    ['Cmd+wheel', 'scZoom'],
    ['Cmd+F', 'scSearch'],
    ['Opt+`', 'scUnsorted'],
    ['Z', 'scFit'],
    ['Cmd+= / Cmd+- / Cmd+0', 'scZoomInOut'],
    ['Cmd+[ / Cmd+]', 'scBackFwd'],
    ['Cmd+double-click', 'scBoardNewTab'],
    ['Cmd+U', 'scParentBoard'],
    ['Shift+D', 'scDraw'],
    ['V / E / C / X', 'scDrawTools'],
    ['1-4', 'scDrawSizes'],
    ['Esc / Cmd+S', 'scDrawExit'],
  ]],
  ['scGrpCards', [
    ['Double-click', 'scNewNote'],
    ['Cmd+Return', 'scNewNoteBelow'],
    ['Delete', 'scDelete'],
    ['Arrows', 'scNudge'],
    ['I', 'scEyedropper'],
    ['Cmd+Z / Cmd+Shift+Z', 'scUndoRedo'],
    ['Cmd+A', 'scSelectAll'],
    ['Esc', 'scDeselect'],
    ['Cmd+D', 'scDuplicate'],
    ['Cmd+X / Cmd+C / Cmd+V', 'scCutCopyPaste'],
    ['Cmd+Opt+V', 'scPasteStyles'],
    ['Cmd+Shift+Down / Up', 'scReorderZ'],
    ['Opt+Return', 'scTodoTitle'],
    ['Cmd+Shift+1', 'scTodoDue'],
  ]],
  ['scGrpEditing', [
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
  ]],
  ['scGrpView', [
    ['Cmd+Shift+D', 'scDark'],
    ['Cmd+Shift+< / >', 'scUiScale'],
  ]],
  ['scGrpPresent', [
    ['Cmd+Opt+P', 'scPresent'],
  ]],
];

export function openShortcutsPanel(): { close(): void } {
  const scrim = document.createElement('div');
  scrim.className = 'short-scrim';
  const box = document.createElement('div');
  box.className = 'short-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', t('shortcutsTitle'));
  const head = document.createElement('div');
  head.className = 'short-head';
  head.textContent = t('shortcutsTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sp-close';
  closeBtn.innerHTML = ICONS.close;
  closeBtn.setAttribute('aria-label', t('close'));
  head.appendChild(closeBtn);
  const list = document.createElement('div');
  list.className = 'short-list';
  for (const [groupKey, rows] of SECTIONS) {
    const gh = document.createElement('div');
    gh.className = 'short-group';
    gh.textContent = t(groupKey);
    list.appendChild(gh);
    for (const [keys, label] of rows) {
      const row = document.createElement('div');
      row.className = 'short-row';
      const k = document.createElement('span');
      k.className = 'short-keys';
      kbd(keys).split(' / ').forEach((part, i) => {
        if (i) k.append(' / ');
        const kb = document.createElement('kbd');
        kb.textContent = part;
        k.appendChild(kb);
      });
      const d = document.createElement('span');
      d.className = 'short-desc';
      d.textContent = t(label);
      row.append(k, d);
      list.appendChild(row);
    }
  }
  box.append(head, list);
  scrim.appendChild(box);

  const opener = document.activeElement as HTMLElement | null;
  const handle = {
    close() {
      popDismiss(handle);
      focusBack(scrim, opener);
      outro(scrim);
    },
  };
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) handle.close();
  });
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  box.addEventListener('keydown', (e) => cycleKeys(e, box));
  closeBtn.addEventListener('click', handle.close);
  document.body.appendChild(scrim);
  pushDismiss(handle);
  closeBtn.focus();
  return handle;
}
