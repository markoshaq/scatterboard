import type { Template } from '../state/schema';
import { t } from '../strings';
import { ICONS } from './icons';
import { openToolPopup, type ToolPopup } from './popup';

interface NewBoardApi {
  builtins(): Template[];
  customs(): Template[];
  onPick(template: Template | null): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
}

// New-board picker: Empty board, preset templates, and the user's own
// saved templates (rename inline, delete per row).
export function openNewBoardPicker(anchor: HTMLElement | DOMRect, api: NewBoardApi): ToolPopup {
  const node = document.createElement('div');
  node.className = 'nbp-body';

  const pop = openToolPopup(anchor, node);

  const row = (icon: string, label: string, onPick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pop-row';
    const ic = document.createElement('span');
    ic.className = 'pop-icon';
    ic.innerHTML = icon;
    const lab = document.createElement('span');
    lab.className = 'pop-label';
    lab.textContent = label;
    b.append(ic, lab);
    b.addEventListener('click', () => {
      pop.close();
      onPick();
    });
    return b;
  };

  function render() {
    node.textContent = '';
    node.appendChild(row(ICONS.board, t('emptyBoard'), () => api.onPick(null)));
    const customs = api.customs();
    const head = document.createElement('div');
    head.className = 'ts-head';
    head.textContent = t('templatesHead');
    node.appendChild(head);
    for (const tp of api.builtins()) {
      node.appendChild(row(ICONS.board, tp.name, () => api.onPick(tp)));
    }
    if (customs.length) {
      const my = document.createElement('div');
      my.className = 'ts-head';
      my.textContent = t('myTemplates');
      node.appendChild(my);
      for (const tp of customs) {
        const wrap = document.createElement('div');
        wrap.className = 'nbp-row';
        const pick = row(ICONS.board, '', () => api.onPick(tp));
        const name = pick.querySelector('.pop-label')!;
        name.textContent = tp.name;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'nbp-mini';
        edit.innerHTML = ICONS.draw;
        edit.title = t('renameTemplate');        edit.setAttribute('aria-label', t('renameTemplate'));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'nbp-mini';
        del.innerHTML = ICONS.close;
        del.title = t('deleteTemplate');        del.setAttribute('aria-label', t('deleteTemplate'));
        edit.addEventListener('click', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.name = 'template-rename';
          input.className = 'nbp-rename';
          input.value = tp.name;
          pick.replaceWith(input);
          input.focus();
          input.select();
          const commit = () => {
            const v = input.value.trim();
            if (v && v !== tp.name) api.onRename(tp.id, v);
            else render();
          };
          input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') render();
          });
          // Popup close detaches the input before blur: cancel, don't
          // commit the half-typed name.
          input.addEventListener('blur', () => {
            if (input.isConnected) commit();
          });
        });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          api.onDelete(tp.id);
          render();
        });
        wrap.append(pick, edit, del);
        node.appendChild(wrap);
      }
    }
  }

  render();
  return pop;
}
