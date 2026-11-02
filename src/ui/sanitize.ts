// Whitelist HTML scrubber for imported board data. Richtext fields
// (note/heading/document/table-cell html) render via innerHTML, so a
// crafted .json import could otherwise smuggle scriptable markup.
// Anything the editor can't produce is stripped; unknown-but-inert
// wrappers are unwrapped so their text survives.

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre',
  's', 'section', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);

const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'title',
  'head', 'template', 'noscript', 'svg', 'math', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'audio', 'video', 'img', 'picture',
  'source', 'canvas',
]);

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,]+%?\)|[a-z]+)$/i;
const SAFE_ALIGN = /^(left|right|center|justify|start|end)$/i;
const SAFE_URL = /^(https?:|mailto:|#|\/)/i;

function cleanStyle(value: string): string {
  const kept: string[] = [];
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if ((prop === 'color' || prop === 'background-color') && SAFE_COLOR.test(val)) {
      kept.push(`${prop}: ${val}`);
    } else if (prop === 'text-align' && SAFE_ALIGN.test(val)) {
      kept.push(`${prop}: ${val}`);
    }
  }
  return kept.join('; ');
}

function clean(el: globalThis.Element) {
  const tag = el.tagName.toLowerCase();
  if (DROP_TAGS.has(tag)) {
    el.remove();
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    el.replaceWith(...[...el.childNodes]);
    return;
  }
  for (const attr of [...el.attributes]) {
    const n = attr.name;
    if (n === 'class') {
      const kept = [...el.classList].filter((c) => /^tx-[\w-]+$/.test(c));
      if (kept.length) el.setAttribute('class', kept.join(' '));
      else el.removeAttribute('class');
      continue;
    }
    if (n === 'style') {
      const s = cleanStyle(attr.value);
      if (s) el.setAttribute('style', s);
      else el.removeAttribute('style');
      continue;
    }
    if (n === 'href' && tag === 'a' && SAFE_URL.test(attr.value.trim())) continue;
    el.removeAttribute(n);
  }
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  for (const el of [...root.querySelectorAll('*')]) clean(el);
  return root.innerHTML;
}
