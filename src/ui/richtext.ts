// Rich-text ops over a single contenteditable surface. execCommand does the
// heavy lifting for marks, lists and formatBlock; block styles that need a
// class (small, callout, checkbox), inline code, palette colour clearing and
// markdown autoformat are hand-rolled.

export type BlockStyle = 'h2' | 'h3' | 'p' | 'small' | 'code' | 'callout' | 'quote';

export const TEXT_COLORS: (string | null)[] = [null, '#3d84e0', '#5f9e5f', '#e8734a', '#d6504a', '#8d8d7a'];
export const HIGHLIGHTS: (string | null)[] = [null, '#f2d15c', '#b7d8f5', '#cde3a1', '#f3b8cd', '#d5d8da'];

let lastHighlight = HIGHLIGHTS[1]!;

const BLOCK_TAG: Record<BlockStyle, string> = {
  h2: 'h2',
  h3: 'h3',
  p: 'p',
  small: 'p',
  code: 'pre',
  callout: 'div',
  quote: 'blockquote',
};

const CLASS_STYLE: Partial<Record<BlockStyle, string>> = { small: 'tx-sm', callout: 'tx-co' };

const BLOCK_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'DIV', 'PRE', 'BLOCKQUOTE',
  'UL', 'OL', 'LI', 'HR', 'TABLE', 'SECTION',
]);

let cssReady = false;
function ensureCssMode() {
  if (cssReady) return;
  cssReady = true;
  try {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('defaultParagraphSeparator', false, 'p');
  } catch {
    /* older engines: ignore */
  }
}

function touched(root: HTMLElement) {
  root.dispatchEvent(new Event('input', { bubbles: true }));
}

const PLAIN_EMPTY = new Set(['P', 'DIV', 'BR']);

// True when the surface is blank text-wise AND holds only plain empty
// blocks: a styled-but-empty block (h2, centered p, tx-check) survives.
export function isBlankSurface(root: HTMLElement): boolean {
  if (root.innerText.trim() !== '') return false;
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (!PLAIN_EMPTY.has(el.tagName)) return false;
    if (el.className || el.getAttribute('style')) return false;
  }
  return true;
}

function inRoot(root: HTMLElement, node: Node | null): node is Node {
  return !!node && (node === root || root.contains(node));
}

// A non-collapsed selection that lives inside the editing surface.
export function selectionInRoot(root: HTMLElement): boolean {
  const s = getSelection();
  return (
    !!s &&
    s.rangeCount > 0 &&
    !s.isCollapsed &&
    s.toString().length > 0 &&
    inRoot(root, s.anchorNode) &&
    inRoot(root, s.focusNode)
  );
}

export function selectionRange(root: HTMLElement): Range | null {
  const s = getSelection();
  if (!s?.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0);
  return inRoot(root, r.commonAncestorContainer) ? r.cloneRange() : null;
}

// Top-level block (direct child of root) or list item containing the node.
// When the caret sits at (root, offset), resolve to the child before it.
function blockOf(root: HTMLElement, node: Node | null, offset?: number): HTMLElement | null {
  if (node === root && offset !== undefined) {
    node = root.childNodes[Math.max(0, offset - 1)] ?? root.lastChild;
  }
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el && el !== root) {
    if (el.tagName === 'LI' || el.parentElement === root) return el;
    el = el.parentElement;
  }
  return null;
}

function selectedBlocks(root: HTMLElement): HTMLElement[] {
  const s = getSelection();
  if (!s?.rangeCount) return [];
  const range = s.getRangeAt(0);
  const out = new Set<HTMLElement>();
  const add = (n: Node | null, offset?: number) => {
    const b = blockOf(root, n, offset);
    if (b) out.add(b);
  };
  add(range.startContainer, range.startOffset);
  add(range.endContainer, range.endOffset);
  // A multi-block selection only names its endpoints: scan the range so
  // blocks sandwiched between them get styled/centered too.
  if (!range.collapsed) {
    for (const el of root.children) {
      if (range.intersectsNode(el)) add(el);
    }
  }
  return [...out];
}

// Wrap stray inline/text children in <p> so every line lives in a block.
export function ensureBlockChildren(root: HTMLElement) {
  ensureCssMode();
  const kids = [...root.childNodes];
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const p = document.createElement('p');
    root.insertBefore(p, run[0]!);
    for (const n of run) p.appendChild(n);
    run = [];
  };
  for (const n of kids) {
    if (n instanceof HTMLElement && BLOCK_TAGS.has(n.tagName)) {
      flush();
      continue;
    }
    // Whitespace-only and &nbsp;-only text nodes are empty too: left
    // alone they'd wrap into stray empty <p>s below.
    if (n.nodeType === Node.TEXT_NODE && !n.textContent?.replace(/\u00a0/g, ' ').trim()) {
      n.remove();
      continue;
    }
    run.push(n);
  }
  flush();
}

export function applyBlockStyle(root: HTMLElement, style: BlockStyle) {
  ensureCssMode();
  document.execCommand('formatBlock', false, `<${BLOCK_TAG[style]}>`);
  for (const b of selectedBlocks(root)) {
    b.classList.remove('tx-sm', 'tx-co', 'tx-check');
    const cls = CLASS_STYLE[style];
    if (cls) b.classList.add(cls);
  }
  touched(root);
}

export function blockStyleAt(root: HTMLElement): BlockStyle | null {
  const s = getSelection();
  if (!s?.rangeCount) return null;
  const b = blockOf(root, s.anchorNode, s.anchorOffset);
  if (!b) return null;
  if (b.classList.contains('tx-co')) return 'callout';
  if (b.classList.contains('tx-sm')) return 'small';
  switch (b.tagName) {
    case 'H2':
      return 'h2';
    case 'H3':
      return 'h3';
    case 'PRE':
      return 'code';
    case 'BLOCKQUOTE':
      return 'quote';
    default:
      return 'p';
  }
}

export function execMark(root: HTMLElement, cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') {
  ensureCssMode();
  document.execCommand(cmd);
  touched(root);
}

export function toggleList(root: HTMLElement, kind: 'ul' | 'ol') {
  ensureCssMode();
  document.execCommand(kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  touched(root);
}

export function toggleCenter(root: HTMLElement) {
  const blocks = selectedBlocks(root);
  if (!blocks.length) return;
  const on = !blocks.every((b) => b.style.textAlign === 'center');
  for (const b of blocks) b.style.textAlign = on ? 'center' : '';
  touched(root);
}

function unwrap(el: Element) {
  const p = el.parentNode;
  if (!p) return;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  p.removeChild(el);
  if (p instanceof HTMLElement) p.normalize();
}

function closestWithin(root: HTMLElement, node: Node | null, tag: string): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el && el !== root) {
    if (el.tagName === tag) return el;
    el = el.parentElement;
  }
  return null;
}

export function toggleInlineCode(root: HTMLElement) {
  const s = getSelection();
  if (!s?.rangeCount) return;
  const range = s.getRangeAt(0);
  const code =
    closestWithin(root, range.startContainer, 'CODE') ?? closestWithin(root, range.endContainer, 'CODE');
  if (code) {
    unwrap(code);
    touched(root);
    return;
  }
  if (range.collapsed) return;
  const frag = range.extractContents();
  const el = document.createElement('code');
  el.className = 'tx-ic';
  el.appendChild(frag);
  range.insertNode(el);
  s.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(el);
  s.addRange(r);
  touched(root);
}

// Strip one inline style property from every styled element the selection
// touches; unwrap emptied span/font wrappers.
function clearInlineProp(root: HTMLElement, prop: 'color' | 'backgroundColor') {
  const s = getSelection();
  if (!s?.rangeCount) return;
  const range = s.getRangeAt(0);
  for (const el of [...root.querySelectorAll<HTMLElement>('[style]')]) {
    if (!range.intersectsNode(el)) continue;
    el.style[prop] = '';
    if (!el.getAttribute('style') && (el.tagName === 'SPAN' || el.tagName === 'FONT')) unwrap(el);
  }
  root.normalize();
}

export function applyTextColor(root: HTMLElement, color: string | null) {
  ensureCssMode();
  if (color === null) clearInlineProp(root, 'color');
  else document.execCommand('foreColor', false, color);
  touched(root);
}

export function applyHighlight(root: HTMLElement, color: string | null) {
  ensureCssMode();
  if (color === null) clearInlineProp(root, 'backgroundColor');
  else {
    lastHighlight = color;
    document.execCommand('hiliteColor', false, color);
  }
  touched(root);
}

// Only browser-safe schemes ever become anchors: the popup input lands
// here raw, and the html is later rendered back through innerHTML.
function safeHref(url: string): string | null {
  const v = url.trim();
  if (!v) return null;
  const href = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) ? v : `https://${v}`;
  try {
    const p = new URL(href).protocol;
    return p === 'http:' || p === 'https:' || p === 'mailto:' ? href : null;
  } catch {
    return null;
  }
}

export function applyLink(root: HTMLElement, url: string, range: Range) {
  const href = safeHref(url);
  if (!href) return;
  ensureCssMode();
  const s = getSelection()!;
  s.removeAllRanges();
  s.addRange(range);
  document.execCommand('createLink', false, href);
  // Stamp safe-open attrs on the anchor(s) createLink just made.
  for (const a of root.querySelectorAll('a')) {
    if (range.intersectsNode(a)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  }
  touched(root);
}

export function inListContext(): boolean {
  const s = getSelection();
  if (!s?.rangeCount) return false;
  const el =
    s.anchorNode instanceof HTMLElement ? s.anchorNode : s.anchorNode?.parentElement ?? null;
  return !!el?.closest('ul, ol');
}

export function indentList(root: HTMLElement, out: boolean) {
  ensureCssMode();
  document.execCommand(out ? 'outdent' : 'indent');
  touched(root);
}

const MD_TRIGGERS: Record<string, BlockStyle | 'ul' | 'ol' | 'hr'> = {
  '#': 'h2',
  '##': 'h3',
  '*': 'ul',
  '1.': 'ol',
  '>': 'quote',
  '```': 'code',
  '---': 'hr',
  '!': 'callout',
};

// Line-start markdown triggers, run on Space before the char lands.
function mdAutoformat(root: HTMLElement): boolean {
  const s = getSelection();
  if (!s?.isCollapsed || !s.rangeCount) return false;
  ensureBlockChildren(root);
  const block = blockOf(root, s.anchorNode, s.anchorOffset);
  if (!block || block.tagName === 'PRE' || block.closest('ul, ol')) return false;
  const range = s.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const marker = pre.toString();
  const action = MD_TRIGGERS[marker];
  if (!action) return false;
  pre.deleteContents();
  if (action === 'hr') {
    const hr = document.createElement('hr');
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    block.after(hr, p);
    if (!block.innerText.trim()) block.remove();
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    s.removeAllRanges();
    s.addRange(r);
  } else if (action === 'ul' || action === 'ol') {
    toggleList(root, action);
    return true;
  } else {
    applyBlockStyle(root, action);
    return true;
  }
  touched(root);
  return true;
}

interface RichKeyHandlers {
  openLink(): void;
}

// Editing-time keymap. Returns true when the key was consumed.
export function richKeydown(root: HTMLElement, e: KeyboardEvent, handlers: RichKeyHandlers): boolean {
  const meta = e.metaKey || e.ctrlKey;
  if (e.key === 'Tab' && !meta) {
    e.preventDefault();
    if (inListContext()) indentList(root, e.shiftKey);
    return true;
  }
  if (e.key === ' ' && !meta && !e.altKey) {
    if (mdAutoformat(root)) {
      e.preventDefault();
      return true;
    }
    return false;
  }
  if (!meta || e.altKey) return false;
  const done = () => {
    e.preventDefault();
    return true;
  };
  if (e.shiftKey) {
    switch (e.code) {
      case 'Digit1':
        applyBlockStyle(root, 'h2');
        return done();
      case 'Digit2':
        applyBlockStyle(root, 'h3');
        return done();
      case 'Digit0':
        applyBlockStyle(root, 'p');
        return done();
      case 'Digit9':
        applyBlockStyle(root, 'small');
        return done();
      case 'Digit6':
        applyBlockStyle(root, 'callout');
        return done();
      case 'KeyX':
        execMark(root, 'strikeThrough');
        return done();
      case 'KeyU':
        toggleList(root, 'ul');
        return done();
      case 'KeyO':
        toggleList(root, 'ol');
        return done();
      case 'Period':
        applyBlockStyle(root, 'code');
        return done();
      case 'Quote':
        applyBlockStyle(root, 'quote');
        return done();
    }
    return false;
  }
  switch (e.code) {
    case 'KeyB':
      execMark(root, 'bold');
      return done();
    case 'KeyI':
      execMark(root, 'italic');
      return done();
    case 'KeyU':
      execMark(root, 'underline');
      return done();
    case 'KeyJ':
      applyHighlight(root, lastHighlight);
      return done();
    case 'KeyK':
      handlers.openLink();
      return done();
    case 'Backslash':
      toggleCenter(root);
      return done();
  }
  return false;
}
