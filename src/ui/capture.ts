import { t } from '../strings';
import { openToolPopup, type ToolPopup } from './popup';

// Quick-capture popup: a small text surface that files the text as a
// note into the current board's Unsorted inbox. Cmd+Enter commits.
export function openCapturePopup(anchor: HTMLElement, onAdd: (text: string) => void): ToolPopup {
  const node = document.createElement('div');
  node.className = 'qc-body';
  const area = document.createElement('textarea');
  area.name = 'quick-capture';
  area.className = 'qc-input';
  area.placeholder = t('qcPh');
  area.rows = 3;
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'qc-add';
  add.textContent = t('qcAdd');
  node.append(area, add);
  const pop = openToolPopup(anchor, node);

  const commit = () => {
    const text = area.value.trim();
    if (!text) return;
    onAdd(text);
    pop.close();
  };
  add.addEventListener('click', commit);
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      pop.close();
    }
  });
  area.focus();
  return pop;
}
