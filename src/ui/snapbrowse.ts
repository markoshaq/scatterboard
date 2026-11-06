import type { Action } from '../state/actions';
import { remapElements } from '../state/clone';
import type { Board, Doc, Element, ID } from '../state/schema';
import { exportBoard, importActions, parseBoardExport } from '../export/boardio';
import { BoardIndex } from '../cards/boardindex';
import { cardsCount, t } from '../strings';
import { mountBoardIcon } from './boardicons';
import { ICONS, typeIcon } from './icons';
import { openPanel, panelEmpty, panelRow, type PanelHandle } from './panel';

export function restoreSnapshotBoardActions(
  liveDoc: Doc,
  snapDoc: Doc,
  rootId: ID,
  hostBoardId: ID,
): { actions: Action[]; boardId: ID } | null {
  const json = exportBoard(snapDoc, rootId);
  if (!json) return null;
  const data = parseBoardExport(json);
  if (!data) return null;
  return importActions(liveDoc, data, hostBoardId);
}

export function restoreSnapshotCardActions(
  liveDoc: Doc,
  el: Element,
  hostBoardId: ID,
): { actions: Action[]; id: ID } | null {
  if (!liveDoc.boards[hostBoardId]) return null;
  let spot = { x: 80, y: 80 };
  const host = Object.values(liveDoc.elements).filter((e) => e.boardId === hostBoardId && e.parentId === null);
  if (host.length) {
    spot = { x: Math.min(...host.map((e) => e.x)), y: Math.max(...host.map((e) => e.y)) + 200 };
  }
  const dx = Math.round(spot.x - el.x);
  const dy = Math.round(spot.y - el.y);
  const { clones } = remapElements(liveDoc, [el], () => hostBoardId, dx, dy);
  const clone = clones[0]!;
  delete clone.syncGroup;
  return { actions: [{ type: 'element.create', el: clone }], id: clone.id };
}

export interface SnapBrowseOpts {
  doc: Doc;
  snippetFor(el: Element): string;
  onRestoreBoard(boardId: ID): void;
  onRestoreCard(el: Element): void;
}

export function openSnapBrowsePanel(opts: SnapBrowseOpts): PanelHandle {
  const idx = new BoardIndex();
  idx.ensure(opts.doc, null, 0);
  let activeBoard: ID | null = null;

  const handle = openPanel({
    title: t('snapBrowse'),
  });
  const body = handle.body;
  const titleEl = handle.node.querySelector<HTMLElement>('.sp-title');

  const sortedBoards = (): Board[] =>
    Object.values(opts.doc.boards).sort((a, b) => a.createdAt - b.createdAt);

  const renderBoards = () => {
    activeBoard = null;
    if (titleEl) titleEl.textContent = t('snapBrowse');
    body.textContent = '';
    const boards = sortedBoards();
    if (!boards.length) {
      body.appendChild(panelEmpty(t('snapEmpty')));
      return;
    }
    for (const b of boards) {
      const count = idx.canvasCounts.get(b.id) ?? 0;
      const row = panelRow(ICONS.board, b.title || t('untitled'), cardsCount(count));
      row.classList.add('sp-hit');
      const ic = row.querySelector<HTMLElement>('.sp-ricon');
      if (ic && b.icon) {
        ic.textContent = '';
        mountBoardIcon(ic, b.icon, b.title);
      }
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'sp-action';
      restoreBtn.textContent = t('snapRestoreBoard');
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handle.close();
        opts.onRestoreBoard(b.id);
      });
      row.appendChild(restoreBtn);
      row.addEventListener('click', () => renderCards(b.id));
      body.appendChild(row);
    }
  };

  const renderCards = (boardId: ID) => {
    activeBoard = boardId;
    const board = opts.doc.boards[boardId];
    if (titleEl) titleEl.textContent = board?.title || t('untitled');
    body.textContent = '';

    const back = panelRow(ICONS.board, t('snapBack'));
    back.classList.add('sp-hit');
    back.addEventListener('click', () => renderBoards());
    body.appendChild(back);

    const els = Object.values(opts.doc.elements)
      .filter((e) => e.boardId === boardId && e.type !== 'line' && e.type !== 'board')
      .sort((a, b) => a.z - b.z);
    if (!els.length) {
      body.appendChild(panelEmpty(t('emptyBoard')));
      return;
    }
    for (const el of els) {
      const row = panelRow(typeIcon(el.type), opts.snippetFor(el).slice(0, 60).replace(/[�-�]$/, ''));
      row.classList.add('sp-hit');
      row.addEventListener('click', () => {
        if (activeBoard !== boardId) return;
        handle.close();
        opts.onRestoreCard(el);
      });
      body.appendChild(row);
    }
  };

  renderBoards();
  return handle;
}
