import { relTime, t } from '../strings';
import { fmtDate } from '../locale';
import { ICONS } from './icons';
import { openPanel, panelEmpty, panelRow, type PanelHandle } from './panel';
import type { SnapshotMeta } from '../persist/snapshots';

interface SnapApi {
  list(): Promise<SnapshotMeta[]>;
  onNew(): Promise<void>;
  onRestore(id: string): void;
  onDelete(id: string): void;
}

// Version history: named workspace snapshots with restore and delete.
// Entries are stored outside the doc (persist/snapshots.ts).
export function openSnapshotsPanel(api: SnapApi): PanelHandle {
  const handle = openPanel({
    title: t('snapTitle'),
    helper: t('snapHelp'),
    actionLabel: t('snapNew'),
    onAction: () => {
      void api.onNew().then(render);
    },
  });
  const body = handle.body;

  const render = async () => {
    const list = await api.list();
    if (!handle.node.isConnected) return;
    body.textContent = '';
    if (!list.length) {
      body.appendChild(panelEmpty(t('snapEmpty')));
      return;
    }
    for (const s of list) {
      const label = s.auto ? `${s.name} · ${fmtDate(s.createdAt)}` : s.name || fmtDate(s.createdAt);
      const row = panelRow(ICONS.snap, label, relTime(s.createdAt));
      row.classList.add('sp-hit');
      row.addEventListener('click', () => api.onRestore(s.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sp-row-del';
      del.innerHTML = ICONS.trash;
      del.title = t('snapDelete');
      del.setAttribute('aria-label', t('snapDelete'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        api.onDelete(s.id);
        void render();
      });
      row.appendChild(del);
      body.appendChild(row);
    }
  };

  void render();
  return handle;
}
