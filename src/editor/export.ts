// Document export: the editing surface DOM -> Markdown or plain text.
// PDF and Word are deferred to the board-export session.

const SKIP = new Set(['SCRIPT', 'STYLE']);
// Tags that are block-level when nested: inside a container each one
// keeps its own line instead of merging with siblings.
const BLOCKS = new Set([
  'P', 'DIV', 'LI', 'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'HR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

// Literal text escapes the chars markdown would reparse (*, `, [, ],
// #, >, ~, angle brackets) plus list markers at a line start, so the
// export round-trips instead of changing meaning.
function escMd(s: string): string {
  return s
    .replace(/([\\`*_[\]<>#~])/g, '\\$1')
    .replace(/(^|\n)([-+]|\d{1,9}[.)])(?= )/g, '$1\\$2');
}

function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escMd(node.textContent ?? '');
  if (!(node instanceof HTMLElement)) return '';
  const inner = () => [...node.childNodes].map(inlineMd).join('');
  switch (node.tagName) {
    case 'B':
    case 'STRONG':
      return `**${inner()}**`;
    case 'I':
    case 'EM':
      return `*${inner()}*`;
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return `~~${inner()}~~`;
    case 'U':
      return inner();
    case 'CODE': {
      const text = node.textContent ?? '';
      // A backtick inside the code needs a wider fence; a leading or
      // trailing backtick also needs a pad space inside the fence.
      const fence = text.includes('`') ? '``' : '`';
      const pad = /^`|`$/.test(text) ? ' ' : '';
      return `${fence}${pad}${text}${pad}${fence}`;
    }
    case 'A': {
      // Parens and backslashes in the destination break the link.
      const href = (node.getAttribute('href') ?? '').replace(/([\\()])/g, '\\$1');
      return href ? `[${inner()}](${href})` : inner();
    }
    case 'BR':
      return '\n';
    default:
      return SKIP.has(node.tagName) ? '' : inner();
  }
}

// Inner content of a block: inline runs concatenate; nested block
// children map through blockMd on their own line.
function innerMd(el: HTMLElement, depth: number, skip?: (n: HTMLElement) => boolean): string {
  return [...el.childNodes]
    .filter((n) => !(n instanceof HTMLElement && skip?.(n)))
    .map((n) => (n instanceof HTMLElement && BLOCKS.has(n.tagName) ? `\n${blockMd(n, depth)}` : inlineMd(n)))
    .join('')
    .trim();
}

function blockMd(el: HTMLElement, depth: number): string {
  const pad = '  '.repeat(depth);
  const inner = () => innerMd(el, depth);
  switch (el.tagName) {
    case 'H1':
      return `# ${inner()}`;
    case 'H2':
      return `## ${inner()}`;
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return `### ${inner()}`;
    case 'PRE': {
      const text = el.textContent ?? '';
      const fence = text.includes('```') ? '````' : '```';
      return `${fence}\n${text}\n${fence}`;
    }
    case 'BLOCKQUOTE':
      return inner()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'HR':
      return '---';
    case 'UL':
    case 'OL': {
      const items = [...el.children].filter((c): c is HTMLElement => c.tagName === 'LI');
      return items
        .map((li, i) => {
          const marker = el.tagName === 'UL' ? '-' : `${i + 1}.`;
          const subs = [...li.children]
            .filter((c): c is HTMLElement => c.tagName === 'UL' || c.tagName === 'OL')
            .map((c) => blockMd(c, depth + 1));
          const head = innerMd(li, depth + 1, (n) => n.tagName === 'UL' || n.tagName === 'OL').replace(
            /\n/g,
            `\n${pad}  `,
          );
          return [`${pad}${marker} ${head}`, ...subs].filter(Boolean).join('\n');
        })
        .join('\n');
    }
    default:
      return inner();
  }
}

export function htmlToMarkdown(root: HTMLElement, title = ''): string {
  // childNodes, not children: a bare text node at root still exports.
  const blocks = [...root.childNodes]
    .map((n) => (n instanceof HTMLElement ? blockMd(n, 0) : escMd(n.textContent ?? '')))
    .filter((s) => s.trim() !== '');
  const head = title.trim() ? `# ${title.trim()}\n\n` : '';
  return `${head}${blocks.join('\n\n')}\n`;
}

export function plainTextOf(root: HTMLElement, title = ''): string {
  const head = title.trim() ? `${title.trim()}\n\n` : '';
  return head + root.innerText.replace(/\n$/, '');
}

// An html file saved with a .doc extension; Word and Pages open it.
export function htmlToWordDoc(title: string, bodyHtml: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n` +
    `<style>body{font-family:sans-serif;font-size:11pt}h1{font-size:20pt}</style>\n</head>\n<body>\n` +
    `${bodyHtml}\n</body>\n</html>\n`
  );
}
