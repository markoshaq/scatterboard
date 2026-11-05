import type { Board, DocumentDoc, Element, ID } from '../state/schema';
import { wordCount } from '../state/schema';
import { t, wordsText } from '../strings';
import { ICONS } from '../ui/icons';
import {
  openMenuPopup,
  openLinkPopup,
  openReactionsPopup,
  openTextStylePopup,
} from '../ui/toolpopups';
import {
  applyBlockStyle,
  applyHighlight,
  applyLink,
  applyTextColor,
  blockStyleAt,
  ensureBlockChildren,
  execMark,
  inListContext,
  isBlankSurface,
  richKeydown,
  selectionInRoot,
  selectionRange,
  toggleCenter,
  toggleInlineCode,
  toggleList,
} from '../ui/richtext';
import { indentList } from '../ui/richtext';
import { downloadTextFile } from '../draw/strokes';
import { slugFileName } from '../export/download';
import { htmlToMarkdown, htmlToWordDoc, plainTextOf } from './export';
import { openScrim, type EditorScrim } from './shell';
import { tip } from '../ui/tip';

interface DocEditorCtx {
  boards(): Board[];
  boardUrl(id: ID): string;
  // Current document content: each patch swaps the element object, so
  // the mount-time reference goes stale.
  doc(): DocumentDoc | null;
  // Live-commit a document content patch; the caller wraps the whole
  // session in one undo group.
  patch(doc: DocumentDoc): void;
  // Pin a comment thread to the document card.
  comment(anchor: HTMLElement): void;
  // Leave the editor (history.back()).
  exit(): void;
}

export interface EditorHandle {
  close(): void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Document editor at #/e/<id>: editable title, single rich-text surface,
// floating tool strip, word count and doc-local export in the header.
export function openDocumentEditor(_el: Element, ctx: DocEditorCtx): EditorHandle {
  const scrim: EditorScrim = openScrim('');
  const card = document.createElement('div');
  card.className = 'ed-doc';
  const head = document.createElement('div');
  head.className = 'ed-doc-head';
  const titleEl = document.createElement('div');
  titleEl.className = 'ed-doc-title';
  titleEl.dataset.ph = t('docTitlePh');
  const meta = document.createElement('div');
  meta.className = 'ed-doc-meta';
  const words = document.createElement('span');
  words.className = 'ed-doc-words';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'ed-hbtn';
  exportBtn.innerHTML = `${ICONS.export}<span>${t('exportAs')}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ed-hbtn';
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = t('close');
  closeBtn.setAttribute('aria-label', t('close'));
  meta.append(words, exportBtn, closeBtn);
  head.append(titleEl, meta);
  const body = document.createElement('div');
  body.className = 'note-text ed-doc-body';
  body.dataset.ph = t('notePlaceholder');
  card.append(head, body);
  const tools = document.createElement('div');
  tools.className = 'ed-tools';
  scrim.node.append(card, tools);

  const content = () => ctx.doc() ?? { title: '', text: '', displayMode: 'icon' as const, caption: '' };

  const start = content();
  if (start.html !== undefined) body.innerHTML = start.html;
  else if (start.text) body.innerHTML = start.text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
  titleEl.textContent = start.title;
  body.contentEditable = 'true';
  ensureBlockChildren(body);

  const commit = () => {
    const c = content();
    const text = body.innerText.replace(/\n$/, '');
    const html = body.innerHTML;
    ctx.patch({ ...c, text, html });
    words.textContent = wordsText(wordCount(text));
  };
  words.textContent = wordsText(wordCount(body.innerText.replace(/\n$/, '')));

  body.addEventListener('input', () => {
    if (isBlankSurface(body)) body.innerHTML = '';
    commit();
  });

  body.addEventListener('keydown', (e) => {
    richKeydown(body, e, {
      openLink: () => {
        const range = selectionRange(body);
        if (range) openLinkPopup(range.getBoundingClientRect(), (url) => applyLink(body, url, range));
      },
    });
  });

  titleEl.contentEditable = 'true';
  titleEl.addEventListener('input', () => {
    const c = content();
    ctx.patch({ ...c, title: titleEl.innerText.replace(/\n/g, '') });
  });
  titleEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      body.focus();
      const sel = getSelection()!;
      sel.selectAllChildren(body);
      sel.collapseToStart();
    }
  });

  const insertNode = (node: Node) => {
    body.focus();
    const sel = getSelection()!;
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) {
      sel.selectAllChildren(body);
      sel.collapseToEnd();
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    commit();
  };

  const insertHr = () => {
    body.focus();
    const sel = getSelection()!;
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) {
      sel.selectAllChildren(body);
      sel.collapseToEnd();
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    // Block ancestor of the caret: an <hr> must sit between blocks,
    // not inside one.
    let block: Node | null = r.startContainer;
    if (block === body) block = null;
    while (block && block.parentNode !== body) block = block.parentNode;
    const hr = document.createElement('hr');
    let caret: HTMLElement;
    if (block instanceof HTMLElement) {
      // Split the block at the caret: the tail moves into a sibling
      // clone after the <hr>, the head keeps its place.
      r.setEndAfter(block);
      const tail = r.extractContents().firstChild;
      block.after(hr);
      if (tail instanceof HTMLElement && tail.textContent !== '') {
        hr.after(tail);
        caret = tail;
      } else {
        caret = document.createElement('p');
        caret.appendChild(document.createElement('br'));
        hr.after(caret);
      }
    } else {
      // Caret already at body level: inserting here lands between blocks.
      caret = document.createElement('p');
      caret.appendChild(document.createElement('br'));
      r.insertNode(hr);
      hr.after(caret);
    }
    const nr = document.createRange();
    nr.setStart(caret, 0);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    commit();
  };

  const tool = (icon: string, label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-tool';
    tip(b, label);
    b.innerHTML = icon;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => onClick(b));
    tools.appendChild(b);
    return b;
  };

  tool(ICONS.txStyle, t('toolTextStyle'), (b) =>
    openTextStylePopup(b, {
      current: () => blockStyleAt(body),
      onStyle: (s) => applyBlockStyle(body, s),
      onColor: (c) => applyTextColor(body, c),
      onHighlight: (c) => applyHighlight(body, c),
    }),
  );
  tool(ICONS.insert, t('insertTool'), (b) =>
    openMenuPopup(b, [
      {
        label: t('insertEmoji'),
        onPick: () =>
          openReactionsPopup(b, () => new Set(), (emoji) => {
            body.focus();
            document.execCommand('insertText', false, emoji);
            commit();
          }),
      },
      { label: t('insertDivider'), onPick: insertHr },
      {
        label: t('insertBoardLink'),
        onPick: () =>
          openMenuPopup(
            b,
            ctx.boards().map((bd) => ({
              label: bd.title || t('untitled'),
              onPick: () => {
                const a = document.createElement('a');
                a.href = ctx.boardUrl(bd.id);
                a.textContent = bd.title || t('untitled');
                insertNode(a);
              },
            })),
          ),
      },
    ]),
  );
  tool(ICONS.txBold, t('toolBold'), () => execMark(body, 'bold'));
  tool(ICONS.txItalic, t('toolItalic'), () => execMark(body, 'italic'));
  tool(ICONS.txBullet, t('toolBullet'), () => toggleList(body, 'ul'));
  tool(ICONS.txNumbered, t('toolNumbered'), () => toggleList(body, 'ol'));
  const indentBtn = tool(ICONS.indent, t('toolIndent'), () => indentList(body, false));
  const unindentBtn = tool(ICONS.unindent, t('toolUnindent'), () => indentList(body, true));
  const linkBtn = tool(ICONS.txLink, t('toolLink'), () => {
    const range = selectionRange(body);
    if (range) openLinkPopup(range.getBoundingClientRect(), (url) => applyLink(body, url, range));
  });
  tool(ICONS.comment, t('toolComment'), (b) => ctx.comment(b));
  tool(ICONS.more, t('toolMore'), (b) =>
    openMenuPopup(
      b,
      [
        { label: t('toolInlineCode'), onPick: () => toggleInlineCode(body) },
        { label: t('toolUnderline'), onPick: () => execMark(body, 'underline') },
        { label: t('toolStrike'), onPick: () => execMark(body, 'strikeThrough') },
        { label: t('toolCenter'), onPick: () => toggleCenter(body) },
      ],
      true,
    ),
  );

  const gate = () => {
    const list = inListContext();
    indentBtn.disabled = !list;
    unindentBtn.disabled = !list;
    linkBtn.disabled = !selectionInRoot(body);
  };
  const onSel = () => gate();
  document.addEventListener('selectionchange', onSel);
  gate();

  exportBtn.addEventListener('click', () => {
    const name = () => (content().title || t('docUntitled')).trim();
    const file = () => slugFileName(name(), 'document');
    openMenuPopup(exportBtn, [
      {
        label: t('exWord'),
        onPick: () => downloadTextFile(`${file()}.doc`, htmlToWordDoc(name(), body.innerHTML), 'application/msword'),
      },
      {
        label: t('exportMarkdown'),
        onPick: () => downloadTextFile(`${file()}.md`, htmlToMarkdown(body), 'text/markdown'),
      },
      {
        label: t('exportPlain'),
        onPick: () => downloadTextFile(`${file()}.txt`, plainTextOf(body)),
      },
    ]);
  });
  closeBtn.addEventListener('click', () => ctx.exit());

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (document.querySelector('.tool-pop')) return;
      e.preventDefault();
      e.stopPropagation();
      ctx.exit();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      ctx.exit();
    }
  };
  window.addEventListener('keydown', onKey, true);

  body.focus();
  const sel = getSelection()!;
  sel.selectAllChildren(body);
  sel.collapseToStart();

  return {
    close() {
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('keydown', onKey, true);
      scrim.close();
    },
  };
}
